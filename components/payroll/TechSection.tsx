"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Equal,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { PayrollStatus } from "@/lib/types";
import type {
  ReportLineItem,
  TechRollup,
} from "@/lib/payroll/compute";
import { AddAdjustmentDialog } from "@/components/payroll/AddAdjustmentDialog";
import { EditJobDialog } from "@/components/payroll/EditJobDialog";
import { OverrideDialog } from "@/components/payroll/OverrideDialog";
import { ReattributeDialog } from "@/components/payroll/ReattributeDialog";
import { SetSiteDialog } from "@/components/payroll/SetSiteDialog";
import { SplitChangeDialog } from "@/components/payroll/SplitChangeDialog";
import { useUndoStack } from "@/components/payroll/UndoContext";

export interface PeriodDispatchLite {
  dispatchId: string;
  jobId: string;
  dispatchDate: string;
  techsOnSite: string[];
  crewSplit: string;
}

export interface JobLite {
  jobId: string;
  customerName: string;
  siteAddress: string;
  utilityTerritory: string;
  notes: string;
}

interface Props {
  periodId: string;
  periodStatus: PayrollStatus;
  techName: string;
  tech: TechRollup;
  activeTechs: string[];
  periodDispatches: PeriodDispatchLite[];
  dispatchUnits: Record<
    string,
    { unitId: string; unitNumberOnJob: number; unitType: string }[]
  >;
  /** Slim job lookup so the inline EditJobDialog can pre-fill from
   *  the current record without a fetch. */
  jobsById: Record<string, JobLite>;
  /** When true (orphan section for the empty period case), render only
   *  the standalone-line widget without a tech header. */
  emptyMode?: boolean;
}

export function TechSection({
  periodId,
  periodStatus,
  techName,
  tech,
  activeTechs,
  periodDispatches,
  dispatchUnits,
  jobsById,
  emptyMode,
}: Props) {
  const router = useRouter();
  const isDraft = periodStatus === "Draft";

  const [expanded, setExpanded] = useState(true);
  const [showAddManual, setShowAddManual] = useState(false);
  const [showAddStandalone, setShowAddStandalone] = useState(false);
  const [reattribute, setReattribute] = useState<{
    item: ReportLineItem;
  } | null>(null);
  const [override, setOverride] = useState<{ item: ReportLineItem } | null>(
    null
  );
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [setSiteFor, setSetSiteFor] = useState<{
    item: ReportLineItem;
  } | null>(null);
  const [splitChange, setSplitChange] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Distinct dispatches this tech worked on in the period — feeds the
  // "Change crew split" picker when this tech is the section owner.
  const techDispatches = useMemo(() => {
    if (!techName) return [];
    return periodDispatches.filter((d) =>
      d.techsOnSite.includes(techName)
    );
  }, [periodDispatches, techName]);

  const undo = useUndoStack();

  const deleteAdjustment = async (adjustmentId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete this adjustment? It stays in the sheet for audit but disappears from the report and stops counting toward the total."
      )
    ) {
      return;
    }
    setDeleting(adjustmentId);
    try {
      // Backed by the existing void endpoint — sets amount=0 + VOIDED
      // note. Compute now filters voided rows out of the report
      // entirely so the line disappears instead of rendering with a
      // strikethrough.
      const res = await fetch("/api/admin/payroll/adjustments/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustmentId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      // Deletes are non-undoable — push the entry so the toast still
      // surfaces the action, but clicking "Undo" yields the proper
      // "permanent" error.
      undo.push({
        label: `Deleted line ${adjustmentId}`,
        adjustmentIds: [],
        undoable: false,
      });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setDeleting(null);
    }
  };

  // Deleting an attribution row writes a counter-adjustment of -amount
  // so the report total reflects the deletion. The original Pay
  // Attribution row stays in its sheet (immutable history of what
  // was earned at finalize time); the new manual adjustment carries
  // the offset with a clear description so the audit story stays
  // legible.
  const deleteAttributionLine = async (item: ReportLineItem) => {
    if (item.amount === 0) {
      // Nothing to offset.
      return;
    }
    const customerLabel = item.customerName || item.jobId || "this line";
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete this ${item.lineType.toLowerCase()} line (${customerLabel}, ${item.amount < 0 ? "-" : ""}$${Math.abs(
          item.amount
        ).toFixed(2)})? Writes an offsetting adjustment so the report total reflects the removal.`
      )
    ) {
      return;
    }
    setDeleting(item.id);
    try {
      const description = `Deleted ${item.lineType} line: ${customerLabel} (${item.amount < 0 ? "-" : ""}$${Math.abs(
        item.amount
      ).toFixed(2)})`;
      const res = await fetch("/api/admin/payroll/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId,
          techName: item.techName,
          type: "manual",
          amount: -item.amount,
          description,
          relatedDispatchId: item.dispatchId,
          relatedUnitId: item.unitId,
          note: `Offsets attribution row ${item.id}`,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        adjustment?: { adjustmentId?: string };
      };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      if (body.adjustment?.adjustmentId) {
        undo.push({
          label: `Deleted ${item.lineType} on ${customerLabel}`,
          adjustmentIds: [body.adjustment.adjustmentId],
          undoable: true,
        });
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setDeleting(null);
    }
  };

  if (emptyMode) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowAddStandalone(true)}
          disabled={!isDraft}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold",
            isDraft
              ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
              : "bg-mse-light text-mse-muted cursor-not-allowed"
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Add standalone line
        </button>
        {showAddStandalone && (
          <AddAdjustmentDialog
            mode="standalone"
            periodId={periodId}
            activeTechs={activeTechs}
            defaultTech=""
            periodDispatches={periodDispatches}
            jobsById={jobsById}
            onClose={() => setShowAddStandalone(false)}
            onSaved={() => {
              setShowAddStandalone(false);
              router.refresh();
            }}
          />
        )}
      </>
    );
  }

  const chips: Array<{ label: string; value: number }> = [
    { label: "Service", value: tech.subtotals.service },
    { label: "Sales (paid)", value: tech.subtotals.salesPaid },
    { label: "Sales (pending)", value: tech.subtotals.salesPending },
    { label: "Standalone", value: tech.subtotals.standalone },
    { label: "Stipend", value: tech.subtotals.dailyStipend },
    { label: "Travel", value: tech.subtotals.travelBonus },
    { label: "Adjustments", value: tech.subtotals.adjustments },
  ].filter((c) => c.value !== 0);

  return (
    <section className="rounded-2xl bg-white border border-mse-light shadow-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-mse-light/40 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-mse-navy/10 flex items-center justify-center text-mse-navy font-bold text-sm shrink-0">
          {techName
            .split(" ")
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase() || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-mse-navy truncate">{techName}</div>
          <div className="text-[11px] text-mse-muted">
            {tech.lineItems.length} line item
            {tech.lineItems.length === 1 ? "" : "s"}
            {tech.subtotals.adjustments !== 0 && (
              <>
                {" · "}
                <span
                  className={cn(
                    "font-bold",
                    tech.subtotals.adjustments < 0
                      ? "text-mse-red"
                      : "text-mse-gold"
                  )}
                >
                  {formatCurrency(tech.subtotals.adjustments)} adj
                </span>
              </>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold tabular-nums text-mse-navy">
            {formatCurrency(tech.grandTotal)}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-mse-muted ml-1" />
        ) : (
          <ChevronDown className="w-4 h-4 text-mse-muted ml-1" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-mse-light/70">
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 mb-2">
              {chips.map((c) => (
                <span
                  key={c.label}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    c.value < 0
                      ? "bg-mse-red/10 text-mse-red"
                      : c.label === "Adjustments"
                      ? "bg-mse-gold/15 text-mse-navy"
                      : "bg-mse-navy/5 text-mse-navy"
                  )}
                >
                  {c.label} {formatCurrency(c.value)}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 -mx-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-mse-muted">
                  <th className="text-left py-1 px-2 font-semibold">Date</th>
                  <th className="text-left py-1 px-2 font-semibold">
                    Job
                  </th>
                  <th className="text-left py-1 px-2 font-semibold">Type</th>
                  <th className="text-left py-1 px-2 font-semibold">
                    Description
                  </th>
                  <th className="text-right py-1 px-2 font-semibold">
                    Amount
                  </th>
                  <th className="text-right py-1 px-2 font-semibold w-12">
                    {isDraft && <span className="sr-only">Actions</span>}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tech.lineItems.map((it) => (
                  <LineItemRow
                    key={`${it.source}-${it.id}`}
                    item={it}
                    isDraft={isDraft}
                    canEditJob={
                      it.source === "attribution" &&
                      Boolean(it.jobId && jobsById[it.jobId])
                    }
                    onEditJob={() => it.jobId && setEditJobId(it.jobId)}
                    onSetSite={() => setSetSiteFor({ item: it })}
                    onReattribute={() => setReattribute({ item: it })}
                    onOverride={() => setOverride({ item: it })}
                    onDelete={() =>
                      it.source === "adjustment"
                        ? deleteAdjustment(it.adjustmentId)
                        : deleteAttributionLine(it)
                    }
                    isDeleting={
                      deleting ===
                      (it.source === "adjustment"
                        ? it.adjustmentId
                        : it.id)
                    }
                  />
                ))}
                {tech.lineItems.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-4 text-center text-xs text-mse-muted italic"
                    >
                      No line items.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t border-mse-light">
                  <td colSpan={4} className="py-2 px-2 text-right text-xs font-bold text-mse-muted uppercase tracking-wider">
                    Tech total
                  </td>
                  <td className="py-2 px-2 text-right text-lg font-bold text-mse-navy tabular-nums">
                    {formatCurrency(tech.grandTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t border-mse-light/70">
            <button
              type="button"
              onClick={() => setShowAddManual(true)}
              disabled={!isDraft}
              className={miniBtn(isDraft, "navy")}
            >
              <Plus className="w-3 h-3" />
              Add adjustment
            </button>
            <button
              type="button"
              onClick={() => setShowAddStandalone(true)}
              disabled={!isDraft}
              className={miniBtn(isDraft, "gold")}
            >
              <Sparkles className="w-3 h-3" />
              Add standalone line
            </button>
            {techDispatches.length > 0 && (
              <button
                type="button"
                onClick={() => setSplitChange(techDispatches[0].dispatchId)}
                disabled={!isDraft}
                className={miniBtn(isDraft, "outline")}
              >
                <Users className="w-3 h-3" />
                Change crew split
              </button>
            )}
            <a
              href={`/api/admin/payroll/periods/${encodeURIComponent(
                periodId
              )}/export?format=pdf&tech=${encodeURIComponent(techName)}`}
              className={miniBtn(true, "outline")}
            >
              Download PDF for {techName.split(" ")[0]}
            </a>
          </div>
        </div>
      )}

      {showAddManual && (
        <AddAdjustmentDialog
          mode="manual"
          periodId={periodId}
          activeTechs={activeTechs}
          defaultTech={techName}
          periodDispatches={periodDispatches}
          jobsById={jobsById}
          onClose={() => setShowAddManual(false)}
          onSaved={() => {
            setShowAddManual(false);
            router.refresh();
          }}
        />
      )}
      {showAddStandalone && (
        <AddAdjustmentDialog
          mode="standalone"
          periodId={periodId}
          activeTechs={activeTechs}
          defaultTech={techName}
          periodDispatches={periodDispatches}
          jobsById={jobsById}
          onClose={() => setShowAddStandalone(false)}
          onSaved={() => {
            setShowAddStandalone(false);
            router.refresh();
          }}
        />
      )}
      {reattribute && (
        <ReattributeDialog
          periodId={periodId}
          fromTech={techName}
          activeTechs={activeTechs}
          item={reattribute.item}
          onClose={() => setReattribute(null)}
          onSaved={() => {
            setReattribute(null);
            router.refresh();
          }}
        />
      )}
      {override && (
        <OverrideDialog
          periodId={periodId}
          techName={techName}
          item={override.item}
          onClose={() => setOverride(null)}
          onSaved={() => {
            setOverride(null);
            router.refresh();
          }}
        />
      )}
      {splitChange && (
        <SplitChangeDialog
          periodId={periodId}
          dispatches={techDispatches}
          activeTechs={activeTechs}
          initialDispatchId={splitChange}
          dispatchUnits={dispatchUnits}
          onClose={() => setSplitChange(null)}
          onSaved={() => {
            setSplitChange(null);
            router.refresh();
          }}
        />
      )}
      {editJobId && jobsById[editJobId] && (
        <EditJobDialog
          jobId={editJobId}
          initialCustomerName={jobsById[editJobId].customerName}
          initialSiteAddress={jobsById[editJobId].siteAddress}
          initialUtilityTerritory={
            jobsById[editJobId].utilityTerritory as
              | "BGE"
              | "PEPCO"
              | "Delmarva"
              | "SMECO"
          }
          initialNotes={jobsById[editJobId].notes}
          onClose={() => setEditJobId(null)}
          onSaved={() => {
            setEditJobId(null);
            router.refresh();
          }}
        />
      )}
      {setSiteFor && (
        <SetSiteDialog
          mode="link"
          adjustmentId={setSiteFor.item.adjustmentId}
          item={setSiteFor.item}
          periodDispatches={periodDispatches}
          jobsById={jobsById}
          initialDispatchId={setSiteFor.item.dispatchId}
          onClose={() => setSetSiteFor(null)}
          onSaved={() => {
            setSetSiteFor(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function LineItemRow({
  item,
  isDraft,
  canEditJob,
  onEditJob,
  onSetSite,
  onReattribute,
  onOverride,
  onDelete,
  isDeleting,
}: {
  item: ReportLineItem;
  isDraft: boolean;
  canEditJob: boolean;
  onEditJob: () => void;
  onSetSite: () => void;
  onReattribute: () => void;
  onOverride: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const isAdj = item.source === "adjustment";
  const negative = item.amount < 0;
  const voided = item.amount === 0 && item.note?.startsWith("VOIDED");

  return (
    <tr
      className={cn(
        "border-t border-mse-light/60 align-top",
        isAdj && "bg-mse-gold/5",
        voided && "opacity-50"
      )}
    >
      <td className="py-2 px-2 text-xs text-mse-muted tabular-nums whitespace-nowrap">
        {item.date || "—"}
      </td>
      <td className="py-2 px-2 max-w-[180px]">
        {isAdj && isDraft && !voided ? (
          // ADJUSTMENT row: click to set or change the linked site.
          // Always rebinds to a dispatch — different intent from an
          // auto-attribution row, which edits the underlying job.
          <button
            type="button"
            onClick={onSetSite}
            className={cn(
              "text-sm truncate text-left",
              item.customerName
                ? "text-mse-navy font-semibold hover:underline decoration-mse-gold underline-offset-2"
                : "text-mse-muted italic underline decoration-dotted underline-offset-2 hover:text-mse-navy hover:decoration-mse-gold",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-1 rounded-sm"
            )}
            title={
              item.customerName
                ? "Change which site this adjustment is linked to"
                : "Set the site / job for this adjustment"
            }
          >
            {item.customerName || "Set site…"}
          </button>
        ) : canEditJob ? (
          <button
            type="button"
            onClick={onEditJob}
            className={cn(
              "text-mse-navy text-sm font-semibold truncate text-left",
              "hover:underline decoration-mse-gold underline-offset-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-1 rounded-sm"
            )}
            title={`Edit ${item.customerName || item.jobId}`}
          >
            {item.customerName || item.jobId || "—"}
          </button>
        ) : (
          <div className="text-mse-navy text-sm font-semibold truncate">
            {item.customerName || (isAdj ? "—" : item.jobId || "—")}
          </div>
        )}
        {(item.unitLabel || item.unitId) && (
          <div className="text-[10px] text-mse-muted mt-0.5 inline-flex items-center gap-1.5">
            {item.nameplateFileId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/photo?fileId=${encodeURIComponent(
                  item.nameplateFileId
                )}&w=120`}
                alt=""
                loading="lazy"
                className="w-5 h-5 rounded-sm object-cover border border-mse-light"
              />
            )}
            <span className={item.unitLabel ? "" : "font-mono"}>
              {item.unitLabel || item.unitId}
            </span>
          </div>
        )}
      </td>
      <td className="py-2 px-2 text-xs">
        <span
          className={cn(
            "px-1.5 py-0.5 rounded-md font-bold",
            isAdj
              ? "bg-mse-gold/20 text-mse-navy"
              : "bg-mse-light text-mse-muted"
          )}
        >
          {item.lineType}
        </span>
      </td>
      <td className="py-2 px-2 text-xs text-mse-muted max-w-[280px]">
        <div className={cn(voided && "line-through")}>
          {item.description || "—"}
        </div>
        {item.relatedTech && (
          <div className="text-[10px] text-mse-muted/80 mt-0.5">
            ↔ {item.relatedTech}
          </div>
        )}
      </td>
      <td
        className={cn(
          "py-2 px-2 text-right font-bold tabular-nums whitespace-nowrap",
          negative ? "text-mse-red" : "text-mse-navy",
          voided && "line-through"
        )}
      >
        {formatCurrency(item.amount)}
      </td>
      <td className="py-2 px-2 text-right">
        {isDraft && !voided && (
          <div className="inline-flex items-center gap-1">
            {!isAdj && (
              <>
                <button
                  type="button"
                  onClick={onOverride}
                  className="p-1.5 rounded-md text-mse-muted hover:text-mse-navy hover:bg-mse-light"
                  aria-label="Override this line's amount"
                  title="Override amount"
                >
                  <Equal className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onReattribute}
                  className="p-1.5 rounded-md text-mse-muted hover:text-mse-navy hover:bg-mse-light"
                  aria-label="Reattribute this line to another tech"
                  title="Reattribute"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="p-1.5 rounded-md text-mse-muted hover:text-mse-red hover:bg-mse-red/10"
              aria-label={
                isAdj
                  ? "Delete this adjustment"
                  : "Delete this line (writes a counter-adjustment)"
              }
              title="Delete"
            >
              {isDeleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function miniBtn(
  enabled: boolean,
  variant: "navy" | "gold" | "outline"
): string {
  const base =
    "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-[background-color,transform] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-1";
  if (!enabled)
    return `${base} bg-mse-light text-mse-muted cursor-not-allowed`;
  if (variant === "navy")
    return `${base} bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card`;
  if (variant === "gold")
    return `${base} bg-mse-gold/15 text-mse-navy border border-mse-gold/30 hover:bg-mse-gold/25`;
  return `${base} bg-white border border-mse-light text-mse-navy hover:border-mse-navy/30`;
}
// Silence the unused-import warning — Minus stays for a future
// "negative quick-add" hint in the empty state.
void Minus;
