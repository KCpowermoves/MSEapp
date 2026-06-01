import "server-only";
import { listAllAttributions } from "@/lib/data/pay-attribution";
import {
  getPayrollPeriod,
  listAllPayrollPeriods,
} from "@/lib/data/payroll-periods";
import { listAdjustmentsForPeriod } from "@/lib/data/payroll-adjustments";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllUnits } from "@/lib/data/units";
import { extractDriveFileId } from "@/lib/utils";
import type {
  PayrollAdjustment,
  PayrollPeriod,
  UnitServiced,
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
  /** Drive file ID of the unit's nameplate photo, when this row
   *  refers to a unit and a nameplate exists. Drives the tiny
   *  thumbnail next to the unit number in the report. */
  nameplateFileId: string;
  /** Display label for the unit ("PTAC 308", "RTU-M 1", etc.) —
   *  same string the tech sees on the job detail page. */
  unitLabel: string;
}

export interface TechRollup {
  techName: string;
  lineItems: ReportLineItem[];
  /** Subtotals by category — surface in cards/summary. The historical
   *  data model has separate "Install" (unit-install pay) and "Service"
   *  (additional-services pay like thermostat installs) line items —
   *  per Kevin's spec, both display under a single user-facing
   *  "Service" bucket so techs see one number instead of two
   *  semantically-similar ones. The merge happens here so all
   *  consumers (UI / PDF / CSV) get the merged value without each one
   *  needing its own translation.
   */
  subtotals: {
    /** Combined: legacy "Install" attribution + legacy "Service" attribution. */
    service: number;
    salesPaid: number;
    salesPending: number;
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
  // Legacy "Install" rows now fold into the unified "Service" bucket
  // so the rollup matches the user-facing label.
  if (lineItem === "Install") return "service";
  if (lineItem === "Service") return "service";
  if (lineItem === "Sales (paid)") return "salesPaid";
  if (lineItem === "Sales (pending)") return "salesPending";
  if (lineItem === "Standalone Trip") return "standalone";
  if (lineItem === "Daily Stipend") return "dailyStipend";
  if (lineItem === "Travel Bonus") return "travelBonus";
  return "adjustments";
}

/** Translate the historical line-item value for display. "Install"
 *  rows render as "Service" so the user-facing labeling is uniform. */
function displayLineType(lineItem: string): string {
  if (lineItem === "Install") return "Service";
  return lineItem;
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
  const [attributions, dispatches, jobs, units, adjustments, period] =
    await Promise.all([
      listAllAttributions(),
      listAllDispatches(),
      listAllJobs(),
      listAllUnits(),
      input.periodId ? listAdjustmentsForPeriod(input.periodId) : Promise.resolve([] as PayrollAdjustment[]),
      input.periodId ? getPayrollPeriod(input.periodId) : Promise.resolve(null),
    ]);

  // Index jobs / dispatches by id.
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const dispatchById = new Map(dispatches.map((d) => [d.dispatchId, d]));

  // Index units by dispatch + unit number so attribution rows can
  // look up their source unit for the nameplate thumbnail. Pay
  // Attribution rows don't carry a unitId directly, but their notes
  // column embeds "Unit-NNN <unitType> (<crewSplit>)" — we parse the
  // NNN and look the row up against the dispatch.
  const unitsByDispatchAndNumber = new Map<string, UnitServiced>();
  for (const u of units) {
    if (u.deleted) continue;
    unitsByDispatchAndNumber.set(`${u.dispatchId}#${u.unitNumberOnJob}`, u);
  }
  function findUnitForAttribution(
    dispatchId: string,
    notes: string
  ): UnitServiced | undefined {
    const m = notes.match(/Unit-(\d+)/i);
    if (!m) return undefined;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) return undefined;
    return unitsByDispatchAndNumber.get(`${dispatchId}#${n}`);
  }
  function unitLabel(u: UnitServiced): string {
    if (u.label && u.label.trim()) return u.label;
    return `Unit ${String(u.unitNumberOnJob).padStart(3, "0")}`;
  }

  // Filter attributions into the date window.
  const inWindow = attributions.filter((r) =>
    inDateRange(r.date, input.startDate, input.endDate)
  );

  // ── Attribution-row deletions ───────────────────────────────────
  // Deleting an attribution row in the admin UI writes a manual
  // counter-adjustment with note "Offsets attribution row <id>". We
  // hide BOTH rows from the report so the deletion is visible as an
  // actual disappearance instead of a pair that nets to zero. The
  // audit story still lives in the sheet (original Pay Attribution
  // row intact + counter-adjustment row intact).
  const deletedAttributionIds = new Set<string>();
  const offsetAdjustmentIds = new Set<string>();
  for (const a of adjustments) {
    const m = (a.note ?? "")
      .trim()
      .match(/^Offsets attribution row\s+(.+)$/i);
    if (m && m[1]) {
      deletedAttributionIds.add(m[1].trim());
      offsetAdjustmentIds.add(a.adjustmentId);
    }
  }

  // ── Group by tech ───────────────────────────────────────────────
  const techMap = new Map<string, ReportLineItem[]>();

  function pushForTech(techName: string, item: ReportLineItem) {
    if (!techName) return;
    const arr = techMap.get(techName) ?? [];
    arr.push(item);
    techMap.set(techName, arr);
  }

  for (const r of inWindow) {
    if (deletedAttributionIds.has(r.id)) continue;
    const dispatch = dispatchById.get(r.dispatchId);
    const job = dispatch ? jobById.get(dispatch.jobId) : undefined;
    const unit = findUnitForAttribution(r.dispatchId, r.notes);
    const nameplateFileId = unit
      ? extractDriveFileId(unit.nameplateUrl || unit.inNameplateUrl || "") ?? ""
      : "";
    pushForTech(r.techName, {
      source: "attribution",
      id: r.id,
      date: r.date,
      techName: r.techName,
      lineType: displayLineType(r.lineItem),
      amount: r.amount,
      description: r.notes || displayLineType(r.lineItem),
      dispatchId: r.dispatchId,
      unitId: unit?.unitId ?? "",
      jobId: dispatch?.jobId ?? "",
      customerName: job?.customerName ?? "",
      note: "",
      adjustmentId: "",
      adjustmentType: "",
      relatedTech: "",
      nameplateFileId,
      unitLabel: unit ? unitLabel(unit) : "",
    });
  }

  for (const a of adjustments) {
    // Deleted / voided adjustments are filtered out of the report.
    // The row still lives in the Payroll Adjustments sheet (audit
    // trail), but it no longer contributes to any total or appears
    // in any UI. Two signals — either is sufficient:
    //   1. Note text starts with "VOIDED" (legacy void path).
    //   2. Amount has been zeroed (also the void path) AND the row's
    //      type is "manual" — preserves real zero-delta adjustments
    //      created intentionally (e.g. crew-split deltas where the
    //      math happens to net out exactly even).
    if (
      (a.note ?? "").trim().toUpperCase().startsWith("VOIDED") ||
      (a.amount === 0 && a.type === "manual") ||
      offsetAdjustmentIds.has(a.adjustmentId)
    ) {
      continue;
    }
    const dispatch = a.relatedDispatchId
      ? dispatchById.get(a.relatedDispatchId)
      : undefined;
    const job = dispatch ? jobById.get(dispatch.jobId) : undefined;
    // If the adjustment is linked to a specific unit, surface its
    // nameplate + display label so the row gets the same thumbnail
    // treatment as the auto-attributed Service line it overrides.
    let adjNameplateFileId = "";
    let adjUnitLabel = "";
    if (a.relatedUnitId) {
      const unit = units.find(
        (u) => u.unitId === a.relatedUnitId && !u.deleted
      );
      if (unit) {
        adjNameplateFileId =
          extractDriveFileId(unit.nameplateUrl || unit.inNameplateUrl || "") ?? "";
        adjUnitLabel = unitLabel(unit);
      }
    }
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
      nameplateFileId: adjNameplateFileId,
      unitLabel: adjUnitLabel,
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
      service: 0,
      salesPaid: 0,
      salesPending: 0,
      standalone: 0,
      dailyStipend: 0,
      travelBonus: 0,
      adjustments: 0,
      earned: 0,
    };
    for (const it of sorted) {
      if (it.source === "attribution") {
        // bucketKey reads the already-display-translated lineType, but
        // also accepts the legacy "Install" string defensively in case
        // any caller bypasses the translation.
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
      subtotals.service +
      subtotals.salesPaid +
      subtotals.salesPending +
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
