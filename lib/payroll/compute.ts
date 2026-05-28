import "server-only";
import { listAllAttributions } from "@/lib/data/pay-attribution";
import {
  getPayrollPeriod,
  listAllPayrollPeriods,
} from "@/lib/data/payroll-periods";
import { listAdjustmentsForPeriod } from "@/lib/data/payroll-adjustments";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllJobs } from "@/lib/data/jobs";
import type {
  PayrollAdjustment,
  PayrollPeriod,
} from "@/lib/types";

// ─── Output shape ────────────────────────────────────────────────────

export type LineItemSource = "attribution" | "adjustment";

/** A single row in the report — either from Pay Attribution or a
 *  manual adjustment. Normalized so the UI doesn't have to special-
 *  case the two sources. */
export interface ReportLineItem {
  source: LineItemSource;
  id: string;
  date: string;            // YYYY-MM-DD (adjustments use their createdAt date)
  techName: string;
  lineType: string;        // "Install", "Sales (paid)", "Manual", "Reattribute (in/out)", etc.
  amount: number;
  description: string;     // Human-readable narrative
  dispatchId: string;
  unitId: string;
  jobId: string;
  customerName: string;
  note: string;            // free-form admin note (adjustments only)
  adjustmentId: string;    // empty for attribution rows
  adjustmentType: string;  // empty for attribution rows
  relatedTech: string;     // counterparty for re-attributions
}

export interface TechRollup {
  techName: string;
  lineItems: ReportLineItem[];
  /** Subtotals by category — surface in cards/summary. */
  subtotals: {
    install: number;
    salesPaid: number;
    salesPending: number;
    service: number;
    standalone: number;
    dailyStipend: number;
    travelBonus: number;
    /** Manual / reattribute / split-change / standalone adjustments. */
    adjustments: number;
    /** Auto-attribution lines (everything except adjustments). */
    earned: number;
  };
  grandTotal: number;
}

export interface PayrollReport {
  period: PayrollPeriod | null;
  startDate: string;
  endDate: string;
  techs: TechRollup[];
  grandTotal: number;
  attributionLineCount: number;
  adjustmentLineCount: number;
  generatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function inDateRange(iso: string, start: string, end: string): boolean {
  if (!iso) return false;
  return iso >= start && iso <= end;
}

function bucketKey(lineItem: string): keyof TechRollup["subtotals"] {
  if (lineItem === "Install") return "install";
  if (lineItem === "Sales (paid)") return "salesPaid";
  if (lineItem === "Sales (pending)") return "salesPending";
  if (lineItem === "Service") return "service";
  if (lineItem === "Standalone Trip") return "standalone";
  if (lineItem === "Daily Stipend") return "dailyStipend";
  if (lineItem === "Travel Bonus") return "travelBonus";
  return "adjustments";
}

function describeAdjustment(a: PayrollAdjustment): string {
  if (a.description) return a.description;
  if (a.type === "reattribute_from") return `Reattributed to ${a.relatedTech}`;
  if (a.type === "reattribute_to") return `Reattributed from ${a.relatedTech}`;
  if (a.type === "split_change") return `Crew split delta`;
  if (a.type === "standalone") return `Standalone line item`;
  return "Manual adjustment";
}

function adjustmentLineType(a: PayrollAdjustment): string {
  if (a.type === "manual") return "Adjustment";
  if (a.type === "standalone") return "Standalone";
  if (a.type === "reattribute_from") return "Reattribute (out)";
  if (a.type === "reattribute_to") return "Reattribute (in)";
  if (a.type === "split_change") return "Split change";
  return "Adjustment";
}

// ─── Main entry ──────────────────────────────────────────────────────

interface ComputeInput {
  /** When set, pulls the period row + its adjustments. When omitted,
   *  computes from raw attribution only (preview mode). */
  periodId?: string;
  startDate: string;
  endDate: string;
}

/**
 * Build the full payroll report for a date range. Pulls Pay
 * Attribution rows in the window + (if periodId is set) the
 * adjustments tagged to that period. Groups by tech, computes
 * subtotals + grand totals, and threads in job/customer names so
 * the UI can render rich line items without extra lookups.
 */
export async function computePayrollReport(
  input: ComputeInput
): Promise<PayrollReport> {
  const [attributions, dispatches, jobs, adjustments, period] =
    await Promise.all([
      listAllAttributions(),
      listAllDispatches(),
      listAllJobs(),
      input.periodId ? listAdjustmentsForPeriod(input.periodId) : Promise.resolve([] as PayrollAdjustment[]),
      input.periodId ? getPayrollPeriod(input.periodId) : Promise.resolve(null),
    ]);

  // Index jobs by id so we can resolve customer names quickly.
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const dispatchById = new Map(dispatches.map((d) => [d.dispatchId, d]));

  // Filter attributions into the date window.
  const inWindow = attributions.filter((r) =>
    inDateRange(r.date, input.startDate, input.endDate)
  );

  // ── Group by tech ───────────────────────────────────────────────
  const techMap = new Map<string, ReportLineItem[]>();

  function pushForTech(techName: string, item: ReportLineItem) {
    if (!techName) return;
    const arr = techMap.get(techName) ?? [];
    arr.push(item);
    techMap.set(techName, arr);
  }

  for (const r of inWindow) {
    const dispatch = dispatchById.get(r.dispatchId);
    const job = dispatch ? jobById.get(dispatch.jobId) : undefined;
    pushForTech(r.techName, {
      source: "attribution",
      id: r.id,
      date: r.date,
      techName: r.techName,
      lineType: r.lineItem,
      amount: r.amount,
      description: r.notes || r.lineItem,
      dispatchId: r.dispatchId,
      unitId: "",
      jobId: dispatch?.jobId ?? "",
      customerName: job?.customerName ?? "",
      note: "",
      adjustmentId: "",
      adjustmentType: "",
      relatedTech: "",
    });
  }

  for (const a of adjustments) {
    const dispatch = a.relatedDispatchId
      ? dispatchById.get(a.relatedDispatchId)
      : undefined;
    const job = dispatch ? jobById.get(dispatch.jobId) : undefined;
    pushForTech(a.techName, {
      source: "adjustment",
      id: a.adjustmentId,
      date: a.createdAt ? a.createdAt.slice(0, 10) : input.startDate,
      techName: a.techName,
      lineType: adjustmentLineType(a),
      amount: a.amount,
      description: describeAdjustment(a),
      dispatchId: a.relatedDispatchId,
      unitId: a.relatedUnitId,
      jobId: dispatch?.jobId ?? "",
      customerName: job?.customerName ?? "",
      note: a.note,
      adjustmentId: a.adjustmentId,
      adjustmentType: a.type,
      relatedTech: a.relatedTech,
    });
  }

  // ── Build TechRollup per tech ───────────────────────────────────
  const techRollups: TechRollup[] = [];
  // Array.from for ES5 target compatibility — tsconfig has no explicit
  // target so direct Map iteration trips downlevelIteration.
  for (const [techName, items] of Array.from(techMap.entries())) {
    // Stable sort: by date, then attribution before adjustment within a
    // date so the auto rows come first. Older → newer.
    const sorted = [...items].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.source !== b.source) return a.source === "attribution" ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

    const subtotals: TechRollup["subtotals"] = {
      install: 0,
      salesPaid: 0,
      salesPending: 0,
      service: 0,
      standalone: 0,
      dailyStipend: 0,
      travelBonus: 0,
      adjustments: 0,
      earned: 0,
    };
    for (const it of sorted) {
      if (it.source === "attribution") {
        const k = bucketKey(it.lineType);
        subtotals[k] += it.amount;
      } else {
        // Standalone-typed adjustments still get folded into the
        // adjustments bucket — they're a "manual line we added,"
        // not an auto-attribution.
        subtotals.adjustments += it.amount;
      }
    }
    subtotals.earned =
      subtotals.install +
      subtotals.salesPaid +
      subtotals.salesPending +
      subtotals.service +
      subtotals.standalone +
      subtotals.dailyStipend +
      subtotals.travelBonus;

    const grandTotal = subtotals.earned + subtotals.adjustments;
    techRollups.push({ techName, lineItems: sorted, subtotals, grandTotal });
  }

  // Sort techs by grand total desc — top earner first.
  techRollups.sort((a, b) => b.grandTotal - a.grandTotal);

  const grandTotal = techRollups.reduce((s, t) => s + t.grandTotal, 0);

  return {
    period,
    startDate: input.startDate,
    endDate: input.endDate,
    techs: techRollups,
    grandTotal,
    attributionLineCount: inWindow.length,
    adjustmentLineCount: adjustments.length,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Convenience: just the dates from a periodId ─────────────────────

export async function rangeForPeriod(
  periodId: string
): Promise<{ startDate: string; endDate: string } | null> {
  const p = await getPayrollPeriod(periodId);
  if (!p) return null;
  return { startDate: p.startDate, endDate: p.endDate };
}

// ─── Convenience: this tech's report only ────────────────────────────

export async function computeReportForTech(opts: {
  techName: string;
  periodId?: string;
  startDate: string;
  endDate: string;
}): Promise<{ period: PayrollPeriod | null; rollup: TechRollup | null; report: PayrollReport }> {
  const report = await computePayrollReport({
    periodId: opts.periodId,
    startDate: opts.startDate,
    endDate: opts.endDate,
  });
  const rollup =
    report.techs.find((t) => t.techName === opts.techName) ?? null;
  return { period: report.period, rollup, report };
}

// ─── Period summaries for the admin list page ────────────────────────

export interface PeriodSummary {
  period: PayrollPeriod;
  techCount: number;
  grandTotal: number;
  attributionLineCount: number;
  adjustmentLineCount: number;
}

export async function summarizeAllPeriods(): Promise<PeriodSummary[]> {
  const periods = await listAllPayrollPeriods();
  if (periods.length === 0) return [];
  const summaries: PeriodSummary[] = [];
  for (const p of periods) {
    const r = await computePayrollReport({
      periodId: p.periodId,
      startDate: p.startDate,
      endDate: p.endDate,
    });
    summaries.push({
      period: p,
      techCount: r.techs.length,
      grandTotal: r.grandTotal,
      attributionLineCount: r.attributionLineCount,
      adjustmentLineCount: r.adjustmentLineCount,
    });
  }
  // Newest start date first.
  summaries.sort((a, b) =>
    b.period.startDate.localeCompare(a.period.startDate)
  );
  return summaries;
}
