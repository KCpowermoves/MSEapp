"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// One-click "Approve this week" on the weekly close card. Same
// transition as the period detail page (Draft → Approved), which
// freezes adjustments until unlocked. Confirms once inline instead of
// a browser dialog; if jobs are still unfinalized the confirm copy
// says so and the admin can override.

export function ApproveWeekButton({
  periodId,
  unfinalizedCount,
}: {
  periodId: string;
  unfinalizedCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/payroll/periods/${encodeURIComponent(periodId)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Approved" }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed");
      setSubmitting(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95 shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-navy focus-visible:ring-offset-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          Approve this week
        </button>
        {error && <div className="text-xs text-mse-red mt-1.5">{error}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-mse-navy/20 bg-mse-navy/5 p-3 space-y-2">
      <p className="text-xs text-mse-navy font-semibold">
        {unfinalizedCount > 0
          ? `${unfinalizedCount} job${unfinalizedCount === 1 ? "" : "s"} in this week still need${unfinalizedCount === 1 ? "s" : ""} finalizing. Approve anyway?`
          : "Approve and freeze this week's report?"}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={submitting}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold active:scale-95",
            submitting
              ? "bg-mse-light text-mse-muted cursor-not-allowed"
              : "bg-mse-navy text-white hover:bg-mse-navy-soft"
          )}
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          Yes, approve
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={submitting}
          className="px-3 py-2 rounded-lg text-xs font-bold text-mse-muted hover:text-mse-navy active:scale-95"
        >
          Cancel
        </button>
      </div>
      {error && <div className="text-xs text-mse-red">{error}</div>}
    </div>
  );
}
