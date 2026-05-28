import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextPayrollPeriodId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type { PayrollPeriod, PayrollStatus } from "@/lib/types";

// Sheet column layout for "Payroll Periods":
// A: PeriodId | B: StartDate | C: EndDate | D: Status | E: Label
// F: CreatedBy | G: CreatedAt | H: ApprovedBy | I: ApprovedAt
// J: PaidBy | K: PaidAt | L: Note
//
// Schema-flexible reads — a missing PayrollPeriods tab returns []
// rather than throwing, so the admin UI degrades cleanly until the
// setup script is run.

function normalizeStatus(raw: unknown): PayrollStatus {
  const s = String(raw ?? "").trim();
  if (s === "Approved") return "Approved";
  if (s === "Paid") return "Paid";
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
  };
}

export async function listAllPayrollPeriods(): Promise<PayrollPeriod[]> {
  try {
    const rows = await readTab(TABS.payrollPeriods);
    return rows.filter((r) => r[0]).map(rowToPeriod);
  } catch (e) {
    console.warn(
      "[payroll-periods] read failed — is the tab created? Run scripts/init-payroll-tabs.mjs:",
      e instanceof Error ? e.message : e
    );
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
}

export async function createPayrollPeriod(
  input: CreatePeriodInput
): Promise<PayrollPeriod> {
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
  };
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
