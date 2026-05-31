"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import type { ReportLineItem } from "@/lib/payroll/compute";

// Override a single auto-attributed line item to a different amount.
// We never touch the underlying Pay Attribution row — instead we
// write a "manual" adjustment carrying the delta so the report total
// reflects the override and the audit trail makes it obvious what
// changed. Same admin-only endpoint as the regular Add Adjustment
// flow.

interface Props {
  periodId: string;
  techName: string;
  item: ReportLineItem;
  onClose: () => void;
  onSaved: () => void;
}

export function OverrideDialog({
  periodId,
  techName,
  item,
  onClose,
  onSaved,
}: Props) {
  const [newAmount, setNewAmount] = useState(item.amount.toFixed(2));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newAmountNum = Number(newAmount);
  const delta =
    Number.isFinite(newAmountNum) ? newAmountNum - item.amount : 0;
  const canSubmit =
    Number.isFinite(newAmountNum) &&
    Math.abs(delta) > 0.005 &&
    reason.trim().length > 0 &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const customerLabel =
        item.customerName || item.jobId || "this line item";
      const description = `Override ${item.lineType} on ${customerLabel}: ${formatCurrency(
        item.amount
      )} → ${formatCurrency(newAmountNum)} (${reason.trim()})`;
      const res = await fetch("/api/admin/payroll/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId,
          techName,
          type: "manual",
          amount: Number(delta.toFixed(2)),
          description,
          relatedDispatchId: item.dispatchId,
          relatedUnitId: item.unitId,
          note: reason.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't override");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="Override this line"
      subtitle="Writes a +/- adjustment so the report total reflects the override. The original auto-attribution row stays untouched."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-mse-light bg-mse-light/30 p-3 text-xs space-y-1">
          <div className="text-mse-muted">Original</div>
          <div className="font-semibold text-mse-navy">
            {item.customerName || item.jobId || "—"}
          </div>
          <div className="text-mse-muted">
            {item.date} · {item.lineType} ·{" "}
            <span className="font-bold text-mse-navy tabular-nums">
              {formatCurrency(item.amount)}
            </span>
          </div>
        </div>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            New amount
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mse-muted font-semibold">
              $
            </span>
            <input
              type="number"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              step="0.01"
              autoFocus
              className="w-full pl-6 pr-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy tabular-nums"
            />
          </div>
          {Number.isFinite(newAmountNum) && Math.abs(delta) > 0.005 && (
            <div className="text-[11px] mt-1.5">
              <span className="text-mse-muted">Delta will be </span>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  delta > 0 ? "text-mse-navy" : "text-mse-red"
                )}
              >
                {delta > 0 ? "+" : ""}
                {formatCurrency(Number(delta.toFixed(2)))}
              </span>
            </div>
          )}
        </label>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Reason
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you overriding this line?"
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
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
            Apply override
          </button>
        </div>
      </form>
    </Dialog>
  );
}
