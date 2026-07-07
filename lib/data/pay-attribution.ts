import "server-only";
import { TABS, appendRow, readTab } from "@/lib/google/sheets";
import { getSheetsClient } from "@/lib/google/auth";
import { env } from "@/lib/env";
import {
  INSTALL_PAY,
  SALES_BONUS,
  SERVICE_PAY,
  crewSize,
  isTravelTerritory,
} from "@/lib/pay-rates";
import type {
  AdditionalService,
  Dispatch,
  Job,
  UnitServiced,
} from "@/lib/types";

interface AttributionInput {
  dispatch: Dispatch;
  job: Job;
  units: UnitServiced[];
  services: AdditionalService[];
}

interface AttribRow {
  date: string;
  dispatchId: string;
  techName: string;
  lineItem:
    | "Install"
    | "Sales (paid)"
    | "Sales (pending)"
    | "Service"
    | "Standalone Trip"
    | "Daily Stipend"
    | "Travel Bonus";
  amount: number;
  notes: string;
}

function buildRows(input: AttributionInput): AttribRow[] {
  const { dispatch, job, units, services } = input;
  const rows: AttribRow[] = [];
  const date = dispatch.dispatchDate;
  const techs = dispatch.techsOnSite;
  const cSize = crewSize(dispatch.crewSplit);
  if (!techs.length) return rows;

  for (const u of units) {
    const installTotal = INSTALL_PAY[u.unitType];
    const installPerTech = installTotal / cSize;
    for (const t of techs) {
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: t,
        lineItem: "Install",
        amount: installPerTech,
        notes: `Unit-${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType} (${dispatch.crewSplit})`,
      });
    }
    if (job.selfSold && job.soldBy) {
      const fullBonus = SALES_BONUS[u.unitType];
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: job.soldBy,
        lineItem: "Sales (paid)",
        amount: fullBonus * 0.5,
        notes: `Unit-${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType} on self-sold job (50% paid)`,
      });
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: job.soldBy,
        lineItem: "Sales (pending)",
        amount: fullBonus * 0.5,
        notes: `Unit-${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType} on self-sold job (50% pending utility reimbursement)`,
      });
    }
  }

  for (const s of services) {
    const perItem = SERVICE_PAY[s.serviceType] ?? 0;
    if (s.quantity > 0 && perItem > 0) {
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: s.loggedBy,
        lineItem: "Service",
        amount: perItem * s.quantity,
        notes: `${s.quantity} × ${s.serviceType}`,
      });
    }
  }

  if (dispatch.dailyDrivingStipend > 0) {
    for (const t of techs) {
      rows.push({
        date,
        dispatchId: dispatch.dispatchId,
        techName: t,
        lineItem: "Daily Stipend",
        amount: dispatch.dailyDrivingStipend,
        notes: "Photos complete on dispatch day",
      });
    }
  }

  // Travel bonus — Dispatches col F may be a single driver or a
  // comma-separated list (multi-driver projects). Split the bonus
  // evenly across however many drivers are named so two drivers on
  // a trip each take half.
  if (
    dispatch.travelDispatchBonus > 0 &&
    dispatch.driver &&
    isTravelTerritory(job.utilityTerritory)
  ) {
    const driverList = dispatch.driver
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (driverList.length > 0) {
      const perDriver = dispatch.travelDispatchBonus / driverList.length;
      for (const d of driverList) {
        rows.push({
          date,
          dispatchId: dispatch.dispatchId,
          techName: d,
          lineItem: "Travel Bonus",
          amount: perDriver,
          notes:
            driverList.length === 1
              ? `${job.utilityTerritory} territory`
              : `${job.utilityTerritory} territory (split ${driverList.length} ways)`,
        });
      }
    }
  }

  return rows;
}

export async function writeAttributions(
  input: AttributionInput
): Promise<void> {
  const rows = buildRows(input);
  let i = 1;
  for (const r of rows) {
    const id = `ATTR-${input.dispatch.dispatchId}-${String(i++).padStart(3, "0")}`;
    // USER_ENTERED so dates are stored as date serials, matching how the
    // Pay Calc filter cells (B1/D1 = TODAY()-7, TODAY()) get serialized.
    // SUMIFS then compares serial-to-serial, no string conversion drama.
    await appendRow(
      TABS.payAttribution,
      [id, r.date, r.dispatchId, r.techName, r.lineItem, r.amount, r.notes],
      "USER_ENTERED"
    );
  }
}

function techSlug(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

/**
 * Back-fill Daily Stipend attribution rows for a dispatch whose photos
 * completed AFTER submit (so submit-time attribution wrote none).
 * Idempotent — skips any tech who already has a Daily Stipend row for
 * this dispatch, using a fresh read so the check can't be fooled by
 * the 30s cache. IDs are DETERMINISTIC (`ATTR-{dispatch}-LS-{tech}`):
 * if two serverless instances race past the fresh-read check anyway,
 * they append rows with the SAME id, and listAllAttributions dedupes
 * by id — so the crew can never actually be paid twice.
 */
export async function appendLateStipendRows(opts: {
  dispatchId: string;
  dispatchDate: string;
  techsOnSite: string[];
  stipend: number;
}): Promise<number> {
  if (!opts.dispatchId || opts.stipend <= 0 || !opts.techsOnSite.length) {
    return 0;
  }
  const rows = await readTab(TABS.payAttribution, { fresh: true });
  const alreadyPaid = new Set(
    rows
      .filter((r) => r[0])
      .map(rowToAttrib)
      .filter(
        (r) =>
          r.dispatchId === opts.dispatchId && r.lineItem === "Daily Stipend"
      )
      .map((r) => r.techName)
  );
  let written = 0;
  for (const tech of opts.techsOnSite) {
    if (!tech || alreadyPaid.has(tech)) continue;
    written++;
    const id = `ATTR-${opts.dispatchId}-LS-${techSlug(tech)}`;
    await appendRow(
      TABS.payAttribution,
      [
        id,
        opts.dispatchDate,
        opts.dispatchId,
        tech,
        "Daily Stipend",
        opts.stipend,
        "Photos completed after submit (late back-fill)",
      ],
      "USER_ENTERED"
    );
  }
  return written;
}

export interface AttribReadRow {
  id: string;
  date: string;
  dispatchId: string;
  techName: string;
  lineItem: string;
  amount: number;
  notes: string;
}

/** Normalize whatever shape the Sheet returns the date column in
 *  (ISO string, US M/D/Y, or a Sheets serial number) to YYYY-MM-DD. */
function normalizeDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number") {
    const ms = (raw - 25569) * 86_400_000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? s : dt.toISOString().slice(0, 10);
}

function rowToAttrib(row: string[]): AttribReadRow {
  return {
    id: String(row[0] ?? ""),
    date: normalizeDate(row[1]),
    dispatchId: String(row[2] ?? ""),
    techName: String(row[3] ?? ""),
    lineItem: String(row[4] ?? ""),
    amount: Number(row[5] ?? 0),
    notes: String(row[6] ?? ""),
  };
}

/** All attribution rows, normalized. Used by the payroll compute
 *  engine to slice by date range across all techs in one pass.
 *  Deduped by row id (first occurrence wins): back-fill writers use
 *  deterministic ids, so even if a cross-instance race appends the
 *  same logical row twice, it can only ever be PAID once. */
export async function listAllAttributions(): Promise<AttribReadRow[]> {
  const rows = await readTab(TABS.payAttribution);
  const seen = new Set<string>();
  const out: AttribReadRow[] = [];
  for (const raw of rows) {
    if (!raw[0]) continue;
    const r = rowToAttrib(raw);
    if (!Number.isFinite(r.amount)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Sum a tech's pay attributions over an inclusive date range. Returns
 * the total $ + the matching rows so callers can break out subtotals
 * (line item count, distinct jobs, etc.). All attribution rows are
 * already split-aware — when a tech worked a 50-50 dispatch, their
 * row was written with the per-share amount at finalize time. No
 * extra splitting needed here.
 */
export async function payForTechInRange(opts: {
  techName: string;
  startIso: string; // YYYY-MM-DD inclusive
  endIso: string;   // YYYY-MM-DD inclusive
}): Promise<{ total: number; rows: AttribReadRow[] }> {
  if (!opts.techName) return { total: 0, rows: [] };
  if (!opts.startIso || !opts.endIso || opts.endIso < opts.startIso) {
    return { total: 0, rows: [] };
  }
  const all = await listAllAttributions();
  const filtered = all.filter(
    (r) =>
      r.techName === opts.techName &&
      r.date >= opts.startIso &&
      r.date <= opts.endIso
  );
  const total = filtered.reduce((s, r) => s + r.amount, 0);
  return { total, rows: filtered };
}

/**
 * Sum a tech's pay attributions for a single day. Returns the total $
 * across all line items for that tech on that date.
 */
export async function payForTechOnDate(opts: {
  techName: string;
  dateIso: string; // YYYY-MM-DD
}): Promise<{ total: number; rows: AttribReadRow[] }> {
  if (!opts.techName) return { total: 0, rows: [] };
  const all = await listAllAttributions();
  const filtered = all.filter(
    (r) => r.techName === opts.techName && r.date === opts.dateIso
  );
  const total = filtered.reduce((s, r) => s + r.amount, 0);
  return { total, rows: filtered };
}

/**
 * Delete every Pay Attribution row whose Dispatch ID (col C) matches
 * the given dispatchId. Used by unfinalizeDispatch to reverse the rows
 * written at finalize time.
 *
 * Uses batchUpdate deleteDimension requests sorted in descending row
 * order so earlier deletions don't shift the indices of later ones.
 *
 * Idempotent: if no rows match, resolves immediately without touching
 * the sheet.
 */
export async function deletePayAttributionRowsForDispatch(
  dispatchId: string
): Promise<void> {
  if (!dispatchId) return;

  // Read all rows to find which sheet rows (1-indexed) hold this
  // dispatchId. readTab returns rows starting from row 2 (A2:ZZ),
  // so row 0 in the array corresponds to sheet row 2.
  const rows = await readTab(TABS.payAttribution);
  // col C is index 2 (dispatchId)
  const sheetRowIndices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][2] ?? "") === dispatchId) {
      sheetRowIndices.push(i + 2); // +2 because readTab skips the header
    }
  }
  if (sheetRowIndices.length === 0) return;

  const sheets = getSheetsClient();
  const spreadsheetId = env.googleSheetId();

  // Get the sheetId for the Pay Attribution tab
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = (meta.data.sheets ?? []).find(
    (s) => s.properties?.title === TABS.payAttribution
  );
  if (!sheet?.properties?.sheetId) {
    throw new Error(
      `[deletePayAttributionRows] tab "${TABS.payAttribution}" not found in spreadsheet`
    );
  }
  const sheetId = sheet.properties.sheetId;

  // Sort descending so deleting a higher-index row doesn't shift
  // the indices of lower-index rows we still need to delete.
  const sorted = [...sheetRowIndices].sort((a, b) => b - a);

  const requests = sorted.map((rowNum) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: "ROWS",
        // startIndex is 0-based; row 2 in 1-indexed = index 1
        startIndex: rowNum - 1,
        endIndex: rowNum,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  // Invalidate the read cache for this tab so subsequent reads reflect
  // the deletions (the cache key used by readTab is `${tabName}!A2:ZZ`).
  const { invalidateCacheForTab } = await import("@/lib/google/sheets");
  invalidateCacheForTab(TABS.payAttribution);
}
