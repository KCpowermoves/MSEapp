import "server-only";
import { TABS, appendRow, readTab } from "@/lib/google/sheets";
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

  if (
    dispatch.travelDispatchBonus > 0 &&
    dispatch.driver &&
    isTravelTerritory(job.utilityTerritory)
  ) {
    rows.push({
      date,
      dispatchId: dispatch.dispatchId,
      techName: dispatch.driver,
      lineItem: "Travel Bonus",
      amount: dispatch.travelDispatchBonus,
      notes: `${job.utilityTerritory} territory`,
    });
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

/**
 * Sum a tech's pay attributions for a single day. Returns the total $
 * across all line items for that tech on that date.
 */
export async function payForTechOnDate(opts: {
  techName: string;
  dateIso: string; // YYYY-MM-DD
}): Promise<{ total: number; rows: AttribReadRow[] }> {
  if (!opts.techName) return { total: 0, rows: [] };
  const rows = await readTab(TABS.payAttribution);
  const filtered = rows
    .filter((r) => r[0])
    .map(rowToAttrib)
    .filter(
      (r) =>
        r.techName === opts.techName &&
        r.date === opts.dateIso &&
        Number.isFinite(r.amount)
    );
  const total = filtered.reduce((s, r) => s + r.amount, 0);
  return { total, rows: filtered };
}
