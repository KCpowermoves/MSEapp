"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  jobId: string;
  /** True when at least one dispatch on this job is finalized
   *  (submittedAt set). */
  jobFinalized: boolean;
  /** Current audit status, or null when none exists yet. */
  auditStatus: "Draft" | "Complete" | null;
  auditId: string | null;
}

export function JobCompletionBar({
  jobId,
  jobFinalized,
  auditStatus,
  auditId,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"job" | "audit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleJob() {
    setBusy("job");
    setError(null);
    try {
      const path = jobFinalized ? "reopen" : "complete";
      const res = await fetch(
        `/api/jobs/${encodeURIComponent(jobId)}/${path}`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        blockingPeriodId?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAudit() {
    if (!auditId) return;
    setBusy("audit");
    setError(null);
    try {
      const path = auditStatus === "Complete" ? "reopen" : "complete";
      const res = await fetch(
        `/api/audits/${encodeURIComponent(auditId)}/${path}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
      <div className="max-w-2xl mx-auto space-y-2">
        {error && (
          <div className="text-[11px] text-mse-red bg-mse-red/5 border border-mse-red/20 rounded px-3 py-2">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={toggleJob}
            disabled={busy !== null}
            className={cn(
              "py-3 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-1.5",
              jobFinalized
                ? "bg-mse-light text-mse-navy border border-mse-navy/20"
                : "bg-mse-red text-white shadow-card hover:bg-mse-red-hover"
            )}
          >
            {busy === "job" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : jobFinalized ? (
              <RotateCcw className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {jobFinalized ? "Complete ✓ · Reopen" : "Job Complete"}
          </button>
          <button
            type="button"
            onClick={toggleAudit}
            disabled={busy !== null || !auditId}
            className={cn(
              "py-3 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-1.5",
              auditStatus === "Complete"
                ? "bg-mse-light text-mse-navy border border-mse-navy/20"
                : "bg-mse-gold text-mse-navy hover:bg-mse-gold/90"
            )}
          >
            {busy === "audit" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : auditStatus === "Complete" ? (
              <RotateCcw className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {auditStatus === "Complete" ? "Audit ✓ · Reopen" : "Audit Complete"}
          </button>
        </div>
      </div>
    </div>
  );
}
