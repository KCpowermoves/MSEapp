"use client";

import { useState } from "react";
import { Building2, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import { useUndoStack } from "@/components/payroll/UndoContext";
import { SetSiteDialog } from "@/components/payroll/SetSiteDialog";
import type {
  JobLite,
  PeriodDispatchLite,
} from "@/components/payroll/TechSection";

// Single dialog for both:
//   - mode="manual"     → +/- adjustment with note
//   - mode="standalone" → free-form line item for work outside the app

interface Props {
  mode: "manual" | "standalone";
  periodId: string;
  activeTechs: string[];
  defaultTech: string;
  /** Optional site picker — when provided, admin can attach this
   *  adjustment to a specific dispatch right at creation time. */
  periodDispatches?: PeriodDispatchLite[];
  jobsById?: Record<string, JobLite>;
  onClose: () => void;
  onSaved: () => void;
}

export function AddAdjustmentDialog({
  mode,
  periodId,
  activeTechs,
  defaultTech,
  periodDispatches,
  jobsById,
  onClose,
  onSaved,
}: Props) {
  const [tech, setTech] = useState(defaultTech || activeTechs[0] || "");
  const [sign, setSign] = useState<"+" | "-">("+");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [siteDispatchId, setSiteDispatchId] = useState<string>("");
  const [siteJob, setSiteJob] = useState<JobLite | null>(null);
  const [showSitePicker, setShowSitePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = useUndoStack();

  const canPickSite =
    Boolean(periodDispatches && jobsById && periodDispatches.length > 0);

  const amountNum = Number(amount);
  const canSubmit =
    tech.trim().length > 0 &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    description.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const signed = sign === "+" ? amountNum : -amountNum;
      const res = await fetch("/api/admin/payroll/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId,
          techName: tech,
          type: mode,
          amount: signed,
          description,
          note,
          relatedDispatchId: siteDispatchId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        adjustment?: { adjustmentId?: string };
      };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      if (body.adjustment?.adjustmentId) {
        undo.push({
          label:
            mode === "standalone"
              ? `Added standalone line to ${tech}`
              : `Added adjustment to ${tech}`,
          adjustmentIds: [body.adjustment.adjustmentId],
          undoable: true,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={
        mode === "manual" ? "Add manual adjustment" : "Add standalone line item"
      }
      subtitle={
        mode === "manual"
          ? "+/- dollars on top of the auto-attributed pay for this period."
          : "A line item for work done outside the app. Same total as a normal report."
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Tech
          </div>
          <select
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          >
            {activeTechs.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Amount
          </div>
          <div className="flex items-stretch gap-2">
            <div className="flex rounded-lg border border-mse-light overflow-hidden">
              {(["+", "-"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSign(s)}
                  className={cn(
                    "px-3 py-2 text-sm font-bold",
                    sign === s
                      ? s === "+"
                        ? "bg-mse-navy text-white"
                        : "bg-mse-red text-white"
                      : "bg-white text-mse-muted hover:bg-mse-light"
                  )}
                  aria-label={s === "+" ? "Positive" : "Negative"}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mse-muted font-semibold">
                $
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={0}
                step="0.01"
                placeholder="0.00"
                className="w-full pl-6 pr-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy tabular-nums"
                autoFocus
              />
            </div>
          </div>
        </div>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Description
          </div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              mode === "manual"
                ? "What's this adjustment for?"
                : "What's the work being paid?"
            }
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
        </label>

        {canPickSite && (
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
              Site (optional)
            </div>
            {siteJob ? (
              <div className="flex items-center gap-2 rounded-lg border border-mse-light bg-mse-light/30 px-3 py-2">
                <Building2 className="w-4 h-4 text-mse-gold shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-mse-navy truncate">
                    {siteJob.customerName}
                  </div>
                  {siteJob.siteAddress && (
                    <div className="text-[11px] text-mse-muted truncate">
                      {siteJob.siteAddress}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowSitePicker(true)}
                  className="text-[11px] font-bold text-mse-navy hover:underline"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSiteDispatchId("");
                    setSiteJob(null);
                  }}
                  className="p-1 rounded-md text-mse-muted hover:text-mse-red"
                  aria-label="Clear site"
                  title="Clear site"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSitePicker(true)}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold",
                  "bg-white border-2 border-dashed border-mse-light text-mse-muted",
                  "hover:border-mse-navy/30 hover:text-mse-navy active:scale-[0.99]",
                  "transition-[border-color,color,transform]"
                )}
              >
                <Building2 className="w-4 h-4" />
                Attach to a site
              </button>
            )}
          </div>
        )}

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Note (optional)
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Internal note — only shows on this row."
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
          />
        </label>

        {error && (
          <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy"
          >
            Cancel
          </button>
          <button
            type="submit"
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
            {mode === "manual" ? "Add adjustment" : "Add line item"}
          </button>
        </div>
      </form>

      {showSitePicker && periodDispatches && jobsById && (
        <SetSiteDialog
          mode="pick"
          periodDispatches={periodDispatches}
          jobsById={jobsById}
          initialDispatchId={siteDispatchId}
          onClose={() => setShowSitePicker(false)}
          onPick={(dispatchId, job) => {
            setSiteDispatchId(dispatchId);
            setSiteJob(job);
            setShowSitePicker(false);
          }}
        />
      )}
    </Dialog>
  );
}
