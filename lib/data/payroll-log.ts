import "server-only";
import { TABS, appendRow, ensureTabExists } from "@/lib/google/sheets";
import { nowIso } from "@/lib/utils";

/**
 * Append-only audit trail for every admin payroll action. Sheets
 * appends are atomic, so rows can't be lost to races, and nothing in
 * the app ever edits or deletes them.
 *
 * Logging must NEVER break the action being logged — all writes are
 * best-effort.
 */

const HEADERS = [
  "Logged At",  // A — ISO timestamp
  "Admin",      // B — who did it
  "Action",     // C — machine-readable verb
  "Period ID",  // D
  "Target",     // E — adjustmentId / techName / dispatchId as relevant
  "Detail",     // F — human-readable summary incl. amounts
  "Justification", // G — required for reopen-after-close
];

export type PayrollLogAction =
  | "period-create"
  | "period-edit"
  | "status-change"
  | "period-reopen"
  | "adjustment-create"
  | "adjustment-void"
  | "adjustment-link"
  | "reattribute"
  | "split-change"
  | "finalize-adjust"
  | "finalize-waive";

export async function logPayrollAction(entry: {
  admin: string;
  action: PayrollLogAction;
  periodId: string;
  target?: string;
  detail: string;
  justification?: string;
}): Promise<void> {
  try {
    await ensureTabExists(TABS.payrollLog, HEADERS);
    await appendRow(TABS.payrollLog, [
      nowIso(),
      entry.admin,
      entry.action,
      entry.periodId,
      entry.target ?? "",
      entry.detail,
      entry.justification ?? "",
    ]);
  } catch (e) {
    // Best-effort — a logging failure must never fail the admin action.
    console.warn("[payroll-log] append failed:", e);
  }
}
