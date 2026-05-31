"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import type { UtilityTerritory } from "@/lib/types";

// Inline job editor reachable from any commission-report line item.
// Admin clicks a job name in a TechSection row → this opens with the
// current values pre-filled, edits hit the existing PATCH /api/jobs
// endpoint. The commission report itself doesn't recompute (the
// underlying Pay Attribution rows don't change); we router.refresh()
// so the updated customer name re-renders on every row referencing
// the same jobId.

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

interface Props {
  jobId: string;
  initialCustomerName: string;
  initialSiteAddress: string;
  initialUtilityTerritory: UtilityTerritory;
  initialNotes: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditJobDialog({
  jobId,
  initialCustomerName,
  initialSiteAddress,
  initialUtilityTerritory,
  initialNotes,
  onClose,
  onSaved,
}: Props) {
  const [customerName, setCustomerName] = useState(initialCustomerName);
  const [siteAddress, setSiteAddress] = useState(initialSiteAddress);
  const [utilityTerritory, setUtilityTerritory] = useState<UtilityTerritory>(
    initialUtilityTerritory
  );
  const [notes, setNotes] = useState(initialNotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = customerName.trim();
  const dirty =
    trimmedName !== initialCustomerName.trim() ||
    siteAddress.trim() !== initialSiteAddress.trim() ||
    utilityTerritory !== initialUtilityTerritory ||
    notes.trim() !== initialNotes.trim();
  const canSubmit = trimmedName.length > 0 && dirty && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          customerName: trimmedName,
          siteAddress: siteAddress.trim(),
          utilityTerritory,
          notes: notes.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="Edit job"
      subtitle={`${jobId} — changes apply to every line item that references this job.`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Customer name
          </div>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            autoFocus
            autoCapitalize="words"
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
        </label>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Site address
          </div>
          <input
            type="text"
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
        </label>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Utility territory
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {TERRITORIES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setUtilityTerritory(t)}
                className={cn(
                  "px-2 py-2 rounded-lg text-xs font-bold border-2 transition-[background-color,border-color,color]",
                  "active:scale-[0.97]",
                  utilityTerritory === t
                    ? "bg-mse-navy border-mse-navy text-white"
                    : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Notes
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Internal notes about the job."
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
            disabled={submitting}
            className="px-3 py-2 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold",
              "transition-[background-color,transform] active:scale-95",
              canSubmit
                ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
                : "bg-mse-light text-mse-muted cursor-not-allowed"
            )}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
