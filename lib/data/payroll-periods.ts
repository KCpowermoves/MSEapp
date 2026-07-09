import "server-only";
import {
  TABS,
  appendRow,
  ensureTabExists,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextPayrollPeriodId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type { PayrollPeriod, PayrollStatus } from "@/lib/types";

// Header row used by ensureTabExists() to auto-provision the tab on
// first write — mirrors scripts/init-payroll-tabs.mjs so a manual
// init isn't strictly required.
const PERIODS_HEADERS = [
  "PeriodId",
  "StartDate",
  "EndDate",
  "Status",
  "Label",
  "CreatedBy",
  "CreatedAt",
  "ApprovedBy",
  "ApprovedAt",
  "PaidBy",
  "PaidAt",
  "Note",
  "PeriodType",
];

async function ensurePeriodsTab(): Promise<void> {
  await ensureTabExists(TABS.payrollPeriods, PERIODS_HEADERS);
}

// Sheet column layout for "Payroll Periods":
// A: PeriodId | B: StartDate | C: EndDate | D: Status | E: Label
// F: CreatedBy | G: CreatedAt | H: ApprovedBy | I: ApprovedAt
// J: PaidBy | K: PaidAt | L: Note | M: PeriodType (weekly|custom)
//
// Schema-flexible reads — a missing PayrollPeriods tab returns []
// rather than throwing, so the admin UI degrades cleanly until the
// setup script is run.

function normalizeStatus(raw: unknown): PayrollStatus {
  const s = String(raw ?? "").trim();
  if (s === "Approved") return "Approved";
  if (s === "Paid") return "Paid";
  if (s === "Closed") return "Closed";
  return "Draft";
}

function normalizeIsoDate(raw: unknown): string {
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

function rowToPeriod(row: string[]): PayrollPeriod {
  return {
    periodId: String(row[0] ?? ""),
    startDate: normalizeIsoDate(row[1]),
    endDate: normalizeIsoDate(row[2]),
    status: normalizeStatus(row[3]),
    label: String(row[4] ?? ""),
    createdBy: String(row[5] ?? ""),
    createdAt: String(row[6] ?? ""),
    approvedBy: String(row[7] ?? ""),
    approvedAt: String(row[8] ?? ""),
    paidBy: String(row[9] ?? ""),
    paidAt: String(row[10] ?? ""),
    note: String(row[11] ?? ""),
    // Legacy rows have no column M — they behave as classic full-pay
    // custom periods so their historical totals never change.
    periodType: String(row[12] ?? "").trim() === "weekly" ? "weekly" : "custom",
  };
}

export async function listAllPayrollPeriods(): Promise<PayrollPeriod[]> {
  try {
    const rows = await readTab(TABS.payrollPeriods);
    return rows.filter((r) => r[0]).map(rowToPeriod);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Missing-tab failures look like "Unable to parse range:". Auto-
    // provision and retry once so the next request gets clean data.
    if (msg.includes("Unable to parse range")) {
      try {
        await ensurePeriodsTab();
        const rows = await readTab(TABS.payrollPeriods, { fresh: true });
        return rows.filter((r) => r[0]).map(rowToPeriod);
      } catch (retryErr) {
        console.warn(
          "[payroll-periods] auto-provision retry failed:",
          retryErr instanceof Error ? retryErr.message : retryErr
        );
        return [];
      }
    }
    console.warn("[payroll-periods] read failed:", msg);
    return [];
  }
}

export async function getPayrollPeriod(
  periodId: string
): Promise<PayrollPeriod | null> {
  if (!periodId) return null;
  const all = await listAllPayrollPeriods();
  return all.find((p) => p.periodId === periodId) ?? null;
}

interface CreatePeriodInput {
  startDate: string;
  endDate: string;
  label: string;
  note: string;
  createdBy: string;
  periodType?: "weekly" | "custom";
}

export async function createPayrollPeriod(
  input: CreatePeriodInput
): Promise<PayrollPeriod> {
  // Self-heal: provision the tab on first write so a fresh deploy
  // never bricks the "Create Draft period" button.
  await ensurePeriodsTab();
  const periodId = await nextPayrollPeriodId();
  const createdAt = nowIso();
  await appendRow(
    TABS.payrollPeriods,
    [
      periodId,
      input.startDate,
      input.endDate,
      "Draft",
      input.label,
      input.createdBy,
      createdAt,
      "",
      "",
      "",
      "",
      input.note,
      input.periodType ?? "custom",
    ],
    "USER_ENTERED"
  );
  return {
    periodId,
    startDate: input.startDate,
    endDate: input.endDate,
    status: "Draft",
    label: input.label,
    createdBy: input.createdBy,
    createdAt,
    approvedBy: "",
    approvedAt: "",
    paidBy: "",
    paidAt: "",
    note: input.note,
    periodType: input.periodType ?? "custom",
  };
}

// ─── Weekly (Mon–Sun) split-pay periods ──────────────────────────────

/** The Monday of the week containing `d` (UTC date math on ISO). */
export function mondayOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyMd(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Idempotently create the weekly Mon–Sun period covering `anchorIso`
 * (defaults to LAST week when called on a Monday by the cron). Returns
 * the existing period untouched when one already spans that exact
 * week. Label carries the pay-Thursday so nobody has to compute it.
 */
export async function ensureWeeklyPeriod(opts: {
  anchorIso: string; // any date inside the target week
  createdBy: string;
}): Promise<{ period: PayrollPeriod; created: boolean }> {
  const startDate = mondayOf(opts.anchorIso);
  const endDate = addDays(startDate, 6); // Sunday
  const payThursday = addDays(endDate, 4); // the following Thursday
  const existing = (await listAllPayrollPeriods()).find(
    (p) => p.startDate === startDate && p.endDate === endDate
  );
  if (existing) return { period: existing, created: false };
  const period = await createPayrollPeriod({
    startDate,
    endDate,
    label: `Week of ${prettyMd(startDate)}–${prettyMd(endDate)}`,
    note: `Pay date: Thursday ${prettyMd(payThursday)}`,
    createdBy: opts.createdBy,
    periodType: "weekly",
  });
  return { period, created: true };
}

/** Update the date range and/or label of a Draft period. Approved/Paid
 *  periods are rejected here — admin must unlock first. */
export async function updatePayrollPeriodWindow(
  periodId: string,
  patch: { startDate?: string; endDate?: string; label?: string; note?: string }
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.payrollPeriods, "A", periodId);
  if (!rowIndex) throw new Error("Payroll period not found");
  const writes: Promise<void>[] = [];
  if (patch.startDate !== undefined) {
    writes.push(
      updateCell(
        `${TABS.payrollPeriods}!B${rowIndex}`,
        patch.startDate,
        "USER_ENTERED"
      )
    );
  }
  if (patch.endDate !== undefined) {
    writes.push(
      updateCell(
        `${TABS.payrollPeriods}!C${rowIndex}`,
        patch.endDate,
        "USER_ENTERED"
      )
    );
  }
  if (patch.label !== undefined) {
    writes.push(
      updateCell(`${TABS.payrollPeriods}!E${rowIndex}`, patch.label, "RAW")
    );
  }
  if (patch.note !== undefined) {
    writes.push(
      updateCell(`${TABS.payrollPeriods}!L${rowIndex}`, patch.note, "RAW")
    );
  }
  await Promise.all(writes);
}

/** Move a period between Draft / Approved / Paid. Stamps the
 *  approver/payer and timestamp on the way. Unlocking (back to
 *  Draft) clears the prior approver. */
export async function setPayrollPeriodStatus(
  periodId: string,
  next: PayrollStatus,
  actor: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.payrollPeriods, "A", periodId);
  if (!rowIndex) throw new Error("Payroll period not found");
  const ts = nowIso();
  const writes: Promise<void>[] = [
    updateCell(`${TABS.payrollPeriods}!D${rowIndex}`, next, "RAW"),
  ];
  if (next === "Approved") {
    writes.push(
      updateCell(`${TABS.payrollPeriods}!H${rowIndex}`, actor, "RAW"),
      updateCell(`${TABS.payrollPeriods}!I${rowIndex}`, ts, "RAW")
    );
  } else if (next === "Paid") {
    writes.push(
      updateCell(`${TABS.payrollPeriods}!J${rowIndex}`, actor, "RAW"),
      updateCell(`${TABS.payrollPeriods}!K${rowIndex}`, ts, "RAW")
    );
  } else if (next === "Draft") {
    // Unlock — clear both approval AND paid stamps so a re-approval
    // is required after edits. Keeps the audit trail honest.
    writes.push(
      updateCell(`${TABS.payrollPeriods}!H${rowIndex}`, "", "RAW"),
      updateCell(`${TABS.payrollPeriods}!I${rowIndex}`, "", "RAW"),
      updateCell(`${TABS.payrollPeriods}!J${rowIndex}`, "", "RAW"),
      updateCell(`${TABS.payrollPeriods}!K${rowIndex}`, "", "RAW")
    );
  }
  await Promise.all(writes);
}
