"use client";

import { useMemo, useState } from "react";
import { Building2, Loader2, Search, X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import type { PeriodDispatchLite, JobLite } from "@/components/payroll/TechSection";
import type { ReportLineItem } from "@/lib/payroll/compute";

// Pick a job/site for an adjustment row. Each option in the picker
// is a dispatch from this period — choosing one stamps its
// dispatchId on the adjustment, which makes the customer name show
// up everywhere downstream (admin grid, tech-facing report, PDF, CSV).
//
// Used in two flows:
//   1. EXISTING adjustment: click the Job cell on an adjustment row
//      → /api/admin/payroll/adjustments/link writes the new linkage.
//   2. NEW adjustment: AddAdjustmentDialog can mount this picker so
//      the admin can attach a site at creation time. The choice is
//      passed back via onPick rather than written here.
//
// The same component handles both. When `mode === "link"` we POST to
// the link endpoint ourselves and call onSaved; when `mode === "pick"`
// we just call onPick(dispatchId, jobLite).

interface Props {
  mode: "link" | "pick";
  // For mode=link:
  adjustmentId?: string;
  item?: ReportLineItem;
  // For both:
  periodDispatches: PeriodDispatchLite[];
  jobsById: Record<string, JobLite>;
  /** Initial selection (current linkage). */
  initialDispatchId?: string;
  onClose: () => void;
  /** Called after a successful link write. mode=link only. */
  onSaved?: () => void;
  /** Called in pick mode with the picked dispatchId + matching job. */
  onPick?: (dispatchId: string, job: JobLite | null) => void;
}

export function SetSiteDialog({
  mode,
  adjustmentId,
  item,
  periodDispatches,
  jobsById,
  initialDispatchId,
  onClose,
  onSaved,
  onPick,
}: Props) {
  const [selected, setSelected] = useState<string>(initialDispatchId ?? "");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodDispatches
      .map((d) => {
        const job = jobsById[d.jobId];
        return {
          dispatchId: d.dispatchId,
          jobId: d.jobId,
          dispatchDate: d.dispatchDate,
          customerName: job?.customerName ?? "(unknown customer)",
          siteAddress: job?.siteAddress ?? "",
          territory: job?.utilityTerritory ?? "",
          techsOnSite: d.techsOnSite,
        };
      })
      .filter((o) => {
        if (!q) return true;
        const haystack = [
          o.customerName,
          o.siteAddress,
          o.jobId,
          o.dispatchId,
          o.territory,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => b.dispatchDate.localeCompare(a.dispatchDate));
  }, [periodDispatches, jobsById, search]);

  const canSubmit = selected.length > 0 && selected !== initialDispatchId;

  const submit = async () => {
    if (!canSubmit) return;
    if (mode === "pick") {
      const picked = options.find((o) => o.dispatchId === selected) ?? null;
      onPick?.(selected, picked ? jobsById[picked.jobId] ?? null : null);
      return;
    }
    if (!adjustmentId) {
      setError("Missing adjustmentId");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payroll/adjustments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustmentId,
          relatedDispatchId: selected,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update");
      setSubmitting(false);
    }
  };

  const clearLink = async () => {
    if (mode === "pick") {
      onPick?.("", null);
      return;
    }
    if (!adjustmentId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payroll/adjustments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adjustmentId,
          relatedDispatchId: "",
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clear");
      setSubmitting(false);
    }
  };

  const subtitle =
    mode === "link" && item
      ? `Linking ${item.lineType.toLowerCase()} adjustment for ${
          item.techName
        } (${formatCurrency(item.amount)}) to a site.`
      : "Pick the dispatch this adjustment relates to.";

  return (
    <Dialog
      title={mode === "link" ? "Set site for this adjustment" : "Pick a site"}
      subtitle={subtitle}
      size="lg"
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mse-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, address, dispatch ID…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
        </div>

        {options.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-mse-light p-6 text-center text-sm text-mse-muted">
            {periodDispatches.length === 0
              ? "No dispatches in this period to pick from."
              : "No dispatches match that search."}
          </div>
        ) : (
          <ul className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
            {options.map((o) => {
              const picked = selected === o.dispatchId;
              return (
                <li key={o.dispatchId}>
                  <button
                    type="button"
                    onClick={() => setSelected(o.dispatchId)}
                    className={cn(
                      "w-full text-left rounded-xl p-3 border-2 transition-[border-color,background-color]",
                      "active:scale-[0.99]",
                      picked
                        ? "border-mse-navy bg-mse-navy/5"
                        : "border-mse-light bg-white hover:border-mse-navy/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <Building2 className="w-4 h-4 text-mse-gold shrink-0" />
                        <div className="min-w-0">
                          <div className="font-bold text-mse-navy truncate">
                            {o.customerName}
                          </div>
                          <div className="text-[11px] text-mse-muted truncate">
                            {o.siteAddress || "no address"}
                            {o.territory && ` · ${o.territory}`}
                            {" · "}
                            {o.dispatchDate}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-mse-muted font-mono whitespace-nowrap">
                        {o.dispatchId}
                      </span>
                    </div>
                    {o.techsOnSite.length > 0 && (
                      <div className="text-[11px] text-mse-muted mt-1 truncate">
                        Crew: {o.techsOnSite.join(", ")}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
          {initialDispatchId && (
            <button
              type="button"
              onClick={clearLink}
              disabled={submitting}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-mse-muted hover:text-mse-red hover:bg-mse-red/5 disabled:opacity-50"
            >
              <X className="w-3 h-3" />
              Clear site
            </button>
          )}
          <div className="grow" />
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || submitting}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold",
              "transition-[background-color,transform] active:scale-95",
              canSubmit && !submitting
                ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
                : "bg-mse-light text-mse-muted cursor-not-allowed"
            )}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === "link" ? "Set site" : "Use site"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
