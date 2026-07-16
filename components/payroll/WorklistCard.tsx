"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardX,
  DollarSign,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type {
  FinalizeReason,
  UnfinalizedJob,
} from "@/lib/payroll/finalization";

// One card per unfinalized job on the payroll worklist, plus the
// force-finalize modal. Two paths out:
//  - Adjust: corrective pay lines land in this week's period, job stamped
//  - Wave off: admin accepts as-is with a required reason, job stamped

const REASON_META: Record<
  FinalizeReason,
  { label: string; className: string; icon: React.ReactNode }
> = {
  "not-submitted": {
    label: "Not submitted",
    className: "bg-mse-red/10 text-mse-red border-mse-red/25",
    icon: <ClipboardX className="w-3 h-3" />,
  },
  "no-pay": {
    label: "$0 pay",
    className: "bg-mse-red/10 text-mse-red border-mse-red/25",
    icon: <DollarSign className="w-3 h-3" />,
  },
  "missing-photos": {
    label: "Missing photos",
    className: "bg-mse-gold/15 text-mse-navy border-mse-gold/40",
    icon: <Camera className="w-3 h-3" />,
  },
  "audit-incomplete": {
    label: "Audit incomplete",
    className: "bg-mse-light text-mse-muted border-mse-light",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
};

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ReasonChip({ reason }: { reason: FinalizeReason }) {
  const m = REASON_META[reason];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
        m.className
      )}
    >
      {m.icon}
      {m.label}
    </span>
  );
}

interface AdjLine {
  techName: string;
  amount: string;
  description: string;
}

export function WorklistCard({
  job,
  allTechs,
}: {
  job: UnfinalizedJob;
  allTechs: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return null;

  return (
    <div className="bg-white rounded-2xl border-2 border-mse-light shadow-card p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-mse-navy">
              {job.customerName || job.jobId}
            </span>
            <span className="text-[11px] text-mse-muted font-mono">
              {job.jobId}
            </span>
          </div>
          {job.siteAddress && (
            <div className="text-xs text-mse-muted mt-0.5">{job.siteAddress}</div>
          )}
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {job.reasons.map((r) => (
              <ReasonChip key={r} reason={r} />
            ))}
          </div>
          {job.finalizedAt && (
            <div className="text-[11px] text-mse-muted mt-2 inline-flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              Previously finalized by {job.finalizedBy} on{" "}
              {fmtDate(job.finalizedAt.slice(0, 10))} — new work since then
              re-flagged it.
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/jobs/${encodeURIComponent(job.jobId)}`}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-mse-navy border-2 border-mse-light hover:border-mse-navy/30 active:scale-95"
          >
            Open
            <ArrowRight className="w-3 h-3" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95 shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-navy focus-visible:ring-offset-2"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Finalize
          </button>
        </div>
      </div>

      {job.dispatches.length > 0 && (
        <div className="mt-3 border-t border-mse-light pt-2 space-y-1">
          {job.dispatches.map((d) => (
            <div
              key={d.dispatchId}
              className="flex items-center gap-2 flex-wrap text-xs text-mse-muted"
            >
              <span className="font-semibold text-mse-navy w-14">
                {fmtDate(d.date)}
              </span>
              <span className="truncate">{d.techs.join(", ") || "no crew"}</span>
              <span>·</span>
              <span className="tabular-nums">
                paid {formatCurrency(d.payTotal)}
              </span>
              {d.unitsMissingPhotos > 0 && (
                <>
                  <span>·</span>
                  <span>
                    {d.unitsMissingPhotos}/{d.unitCount} unit
                    {d.unitCount === 1 ? "" : "s"} missing photos
                  </span>
                </>
              )}
              <span className="flex items-center gap-1 ml-auto">
                {d.reasons.map((r) => (
                  <ReasonChip key={r} reason={r} />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {open && (
        <FinalizeModal
          job={job}
          allTechs={allTechs}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setDone(true);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function FinalizeModal({
  job,
  allTechs,
  onClose,
  onDone,
}: {
  job: UnfinalizedJob;
  allTechs: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  // Adjustment path leads (per Kevin's spec); wave-off is secondary.
  const [mode, setMode] = useState<"adjust" | "waive">("adjust");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<AdjLine[]>([
    {
      techName: job.techs[0] ?? "",
      amount: "",
      description: `Pay correction for ${job.customerName || job.jobId}`,
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Techs on this job first, then the rest of the active roster.
  const techOptions = [
    ...job.techs,
    ...allTechs.filter((t) => !job.techs.includes(t)),
  ];

  const patchLine = (i: number, patch: Partial<AdjLine>) => {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    );
  };

  const submit = async () => {
    if (submitting) return;
    setError(null);

    const body: Record<string, unknown> = {
      jobId: job.jobId,
      mode,
      note: note.trim(),
    };
    if (mode === "adjust") {
      const parsed = lines
        .filter((l) => l.techName.trim())
        .map((l) => ({
          techName: l.techName.trim(),
          amount: Number(l.amount),
          description: l.description.trim(),
        }));
      if (parsed.length === 0) {
        setError("Add at least one adjustment line, or switch to wave off.");
        return;
      }
      if (parsed.some((l) => !Number.isFinite(l.amount) || l.amount === 0)) {
        setError("Every adjustment line needs a nonzero dollar amount.");
        return;
      }
      body.adjustments = parsed;
    }
    if (!String(body.note)) {
      setError(
        mode === "waive"
          ? "A reason is required to wave off."
          : "Add a short note for the audit log."
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/payroll/finalize-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Finalize failed");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-mse-navy/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-elevated max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-mse-light px-5 py-3.5 flex items-center justify-between">
          <div>
            <div className="font-bold text-mse-navy text-sm">
              Finalize {job.customerName || job.jobId}
            </div>
            <div className="text-[11px] text-mse-muted font-mono">
              {job.jobId}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-mse-muted hover:text-mse-navy hover:bg-mse-light/50 active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {job.reasons.map((r) => (
              <ReasonChip key={r} reason={r} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setMode("adjust")}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-bold border-2 active:scale-[0.98]",
                mode === "adjust"
                  ? "border-mse-navy bg-mse-navy/5 text-mse-navy"
                  : "border-mse-light text-mse-muted hover:text-mse-navy"
              )}
            >
              Fix the pay
            </button>
            <button
              type="button"
              onClick={() => setMode("waive")}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-bold border-2 active:scale-[0.98]",
                mode === "waive"
                  ? "border-mse-navy bg-mse-navy/5 text-mse-navy"
                  : "border-mse-light text-mse-muted hover:text-mse-navy"
              )}
            >
              Wave off as-is
            </button>
          </div>

          {mode === "adjust" ? (
            <div className="space-y-3">
              <p className="text-xs text-mse-muted">
                Corrective pay lines land in <strong>this week&apos;s</strong>{" "}
                period and ride the next pay report. The job is then marked
                finalized.
              </p>
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-mse-light p-3 space-y-2"
                >
                  <div className="grid grid-cols-[1fr_110px] gap-2">
                    <select
                      value={l.techName}
                      onChange={(e) => patchLine(i, { techName: e.target.value })}
                      className="px-2.5 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                    >
                      <option value="">Pick tech…</option>
                      {techOptions.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="$ amount"
                      value={l.amount}
                      onChange={(e) => patchLine(i, { amount: e.target.value })}
                      className="px-2.5 py-2 rounded-lg border border-mse-light bg-white text-sm tabular-nums focus:outline-none focus:border-mse-navy"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="What this pays for"
                      value={l.description}
                      onChange={(e) =>
                        patchLine(i, { description: e.target.value })
                      }
                      className="flex-1 px-2.5 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                    />
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setLines((prev) => prev.filter((_, idx) => idx !== i))
                        }
                        aria-label="Remove line"
                        className="p-2 rounded-lg text-mse-muted hover:text-mse-red hover:bg-mse-red/5 active:scale-95"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    { techName: "", amount: "", description: "" },
                  ])
                }
                className="inline-flex items-center gap-1 text-xs font-bold text-mse-navy hover:underline"
              >
                <Plus className="w-3.5 h-3.5" />
                Add another line
              </button>
            </div>
          ) : (
            <p className="text-xs text-mse-muted">
              No pay changes. You&apos;re approving this job as-is — the reason
              below goes to the audit log under your name.
            </p>
          )}

          <label className="block">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
              {mode === "waive" ? "Reason (required)" : "Note (required)"}
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={
                mode === "waive"
                  ? 'e.g. "Photos lost to a dead phone — verified work on site myself."'
                  : 'e.g. "Paying PTAC 4 at full rate, photos never uploaded."'
              }
              className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
            />
          </label>

          {error && (
            <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className={cn(
              "w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 font-bold text-sm",
              "transition-[background-color,transform] active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-navy focus-visible:ring-offset-2",
              submitting
                ? "bg-mse-light text-mse-muted cursor-not-allowed"
                : "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
            )}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {submitting
              ? "Finalizing…"
              : mode === "adjust"
              ? "Add pay and finalize"
              : "Wave off and finalize"}
          </button>
        </div>
      </div>
    </div>
  );
}
