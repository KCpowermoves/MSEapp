import "server-only";
import {
  TABS,
  appendRow,
  ensureTabExists,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextPayrollAdjustmentId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type {
  PayrollAdjustment,
  PayrollAdjustmentType,
} from "@/lib/types";

// Mirrors scripts/init-payroll-tabs.mjs — used by ensureTabExists()
// so the tab self-provisions if a deploy ran before the init script.
const ADJUSTMENTS_HEADERS = [
  "AdjustmentId",
  "PeriodId",
  "TechName",
  "Type",
  "Amount",
  "Description",
  "RelatedDispatchId",
  "RelatedUnitId",
  "RelatedTech",
  "CreatedBy",
  "CreatedAt",
  "Note",
];

async function ensureAdjustmentsTab(): Promise<void> {
  await ensureTabExists(TABS.payrollAdjustments, ADJUSTMENTS_HEADERS);
}

// Sheet column layout for "Payroll Adjustments":
// A: AdjustmentId | B: PeriodId | C: TechName | D: Type | E: Amount
// F: Description | G: RelatedDispatchId | H: RelatedUnitId
// I: RelatedTech | J: CreatedBy | K: CreatedAt | L: Note

function rowToAdjustment(row: string[]): PayrollAdjustment {
  return {
    adjustmentId: String(row[0] ?? ""),
    periodId: String(row[1] ?? ""),
    techName: String(row[2] ?? ""),
    type: (String(row[3] ?? "manual") as PayrollAdjustmentType),
    amount: Number(row[4] ?? 0) || 0,
    description: String(row[5] ?? ""),
    relatedDispatchId: String(row[6] ?? ""),
    relatedUnitId: String(row[7] ?? ""),
    relatedTech: String(row[8] ?? ""),
    createdBy: String(row[9] ?? ""),
    createdAt: String(row[10] ?? ""),
    note: String(row[11] ?? ""),
  };
}

export async function listAllPayrollAdjustments(): Promise<
  PayrollAdjustment[]
> {
  try {
    const rows = await readTab(TABS.payrollAdjustments);
    return rows.filter((r) => r[0]).map(rowToAdjustment);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) {
      try {
        await ensureAdjustmentsTab();
        const rows = await readTab(TABS.payrollAdjustments, { fresh: true });
        return rows.filter((r) => r[0]).map(rowToAdjustment);
      } catch (retryErr) {
        console.warn(
          "[payroll-adjustments] auto-provision retry failed:",
          retryErr instanceof Error ? retryErr.message : retryErr
        );
        return [];
      }
    }
    console.warn("[payroll-adjustments] read failed:", msg);
    return [];
  }
}

export async function listAdjustmentsForPeriod(
  periodId: string
): Promise<PayrollAdjustment[]> {
  if (!periodId) return [];
  const all = await listAllPayrollAdjustments();
  return all.filter((a) => a.periodId === periodId);
}

interface CreateAdjustmentInput {
  periodId: string;
  techName: string;
  type: PayrollAdjustmentType;
  amount: number;
  description: string;
  relatedDispatchId?: string;
  relatedUnitId?: string;
  relatedTech?: string;
  createdBy: string;
  note?: string;
}

export async function createAdjustment(
  input: CreateAdjustmentInput
): Promise<PayrollAdjustment> {
  // Self-heal: provision the tab on first write so a fresh deploy
  // never breaks the adjustment / reattribute / split-change actions.
  await ensureAdjustmentsTab();
  const adjustmentId = await nextPayrollAdjustmentId();
  const createdAt = nowIso();
  await appendRow(
    TABS.payrollAdjustments,
    [
      adjustmentId,
      input.periodId,
      input.techName,
      input.type,
      input.amount,
      input.description,
      input.relatedDispatchId ?? "",
      input.relatedUnitId ?? "",
      input.relatedTech ?? "",
      input.createdBy,
      createdAt,
      input.note ?? "",
    ],
    "USER_ENTERED"
  );
  return {
    adjustmentId,
    periodId: input.periodId,
    techName: input.techName,
    type: input.type,
    amount: input.amount,
    description: input.description,
    relatedDispatchId: input.relatedDispatchId ?? "",
    relatedUnitId: input.relatedUnitId ?? "",
    relatedTech: input.relatedTech ?? "",
    createdBy: input.createdBy,
    createdAt,
    note: input.note ?? "",
  };
}

/**
 * Create a paired re-attribution: -$amount from `fromTech` and
 * +$amount to `toTech`, both tagged to the same unit and dispatch
 * with shared narrative. Returns both rows for the UI to optimistic-
 * render. Used by the "move this unit's pay to a different tech"
 * admin action.
 */
export async function createReattribution(opts: {
  periodId: string;
  fromTech: string;
  toTech: string;
  amount: number;
  description: string;
  relatedDispatchId: string;
  relatedUnitId: string;
  createdBy: string;
}): Promise<{
  fromRow: PayrollAdjustment;
  toRow: PayrollAdjustment;
}> {
  const fromRow = await createAdjustment({
    periodId: opts.periodId,
    techName: opts.fromTech,
    type: "reattribute_from",
    amount: -Math.abs(opts.amount),
    description: opts.description,
    relatedDispatchId: opts.relatedDispatchId,
    relatedUnitId: opts.relatedUnitId,
    relatedTech: opts.toTech,
    createdBy: opts.createdBy,
  });
  const toRow = await createAdjustment({
    periodId: opts.periodId,
    techName: opts.toTech,
    type: "reattribute_to",
    amount: Math.abs(opts.amount),
    description: opts.description,
    relatedDispatchId: opts.relatedDispatchId,
    relatedUnitId: opts.relatedUnitId,
    relatedTech: opts.fromTech,
    createdBy: opts.createdBy,
  });
  return { fromRow, toRow };
}

/**
 * Create split-change deltas. Caller passes the list of (tech, delta)
 * pairs — both negative (clawback) and positive (gain) rows get
 * written. Single description threaded across all rows so the audit
 * is coherent.
 */
export async function createSplitChange(opts: {
  periodId: string;
  deltas: Array<{ techName: string; delta: number }>;
  description: string;
  relatedDispatchId: string;
  createdBy: string;
}): Promise<PayrollAdjustment[]> {
  const out: PayrollAdjustment[] = [];
  for (const d of opts.deltas) {
    if (d.delta === 0) continue;
    out.push(
      await createAdjustment({
        periodId: opts.periodId,
        techName: d.techName,
        type: "split_change",
        amount: d.delta,
        description: opts.description,
        relatedDispatchId: opts.relatedDispatchId,
        createdBy: opts.createdBy,
      })
    );
  }
  return out;
}

/** Reversing an adjustment is the audit-correct way to "delete" one.
 *  We never actually clear sheet rows — instead we append a paired
 *  reversal with the equal-and-opposite amount, linked via note. */
export async function reverseAdjustment(opts: {
  original: PayrollAdjustment;
  createdBy: string;
  reason: string;
}): Promise<PayrollAdjustment> {
  return createAdjustment({
    periodId: opts.original.periodId,
    techName: opts.original.techName,
    type: opts.original.type,
    amount: -opts.original.amount,
    description: `Reversal of ${opts.original.adjustmentId} — ${opts.reason}`,
    relatedDispatchId: opts.original.relatedDispatchId,
    relatedUnitId: opts.original.relatedUnitId,
    relatedTech: opts.original.relatedTech,
    createdBy: opts.createdBy,
    note: opts.original.adjustmentId,
  });
}

// Mark an adjustment as void by writing a "*" prefix to its description.
// Lightweight alternative to reversal when the admin just typo'd —
// keeps the audit row but excludes from totals. Voided rows are still
// visible in the UI with strikethrough styling.
export async function voidAdjustment(
  adjustmentId: string,
  voidedBy: string
): Promise<void> {
  const rowIndex = await findRowIndex(
    TABS.payrollAdjustments,
    "A",
    adjustmentId
  );
  if (!rowIndex) throw new Error("Adjustment not found");
  await updateCell(
    `${TABS.payrollAdjustments}!E${rowIndex}`,
    0,
    "USER_ENTERED"
  );
  await updateCell(
    `${TABS.payrollAdjustments}!L${rowIndex}`,
    `VOIDED by ${voidedBy} at ${nowIso()}`,
    "RAW"
  );
}
