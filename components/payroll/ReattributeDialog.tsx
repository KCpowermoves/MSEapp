"use client";

import { useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import type { ReportLineItem } from "@/lib/payroll/compute";

// Move one line's pay from this tech to another. Writes a paired
// (-X, +X) adjustment with the same dispatch/unit reference so the
// audit trail explains the move.

interface Props {
  periodId: string;
  fromTech: string;
  activeTechs: string[];
  item: ReportLineItem;
  onClose: () => void;
  onSaved: () => void;
}

export function ReattributeDialog({
  periodId,
  fromTech,
  activeTechs,
  item,
  onClose,
  onSaved,
}: Props) {
  const otherTechs = activeTechs.filter((t) => t !== fromTech);
  const [toTech, setToTech] = useState(otherTechs[0] ?? "");
  const [amount, setAmount] = useState(Math.abs(item.amount).toFixed(2));
  const [description, setDescription] = useState(
    `Reattributed ${item.lineType.toLowerCase()} on ${
      item.customerName || item.jobId || "this dispatch"
    } from ${fromTech} to ${toTech}`
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const canSubmit =
    toTech.length > 0 &&
    toTech !== fromTech &&
    Number.isFinite(amountNum) &&
    amountNum > 0;

  // Keep the auto-description fresh as toTech changes.
  const handleToTech = (next: string) => {
    setToTech(next);
    setDescription(
      `Reattributed ${item.lineType.toLowerCase()} on ${
        item.customerName || item.jobId || "this dispatch"
      } from ${fromTech} to ${next}`
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payroll/reattribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId,
          fromTech,
          toTech,
          amount: amountNum,
          description,
          relatedDispatchId: item.dispatchId,
          relatedUnitId: item.unitId,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reattribute");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="Reattribute this line"
      subtitle={`Move pay from ${fromTech} to another tech. The original line stays put; we write a balancing pair.`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-mse-light bg-mse-light/30 p-3 text-xs">
          <div className="text-mse-muted">Original line</div>
          <div className="font-semibold text-mse-navy mt-0.5">
            {item.customerName || item.jobId || "—"}
          </div>
          <div className="text-mse-muted mt-0.5">
            {item.date} · {item.lineType} ·{" "}
            <span className="font-bold text-mse-navy tabular-nums">
              ${Math.abs(item.amount).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 py-2">
          <TechChip label="From" name={fromTech} tone="muted" />
          <ArrowRightLeft className="w-4 h-4 text-mse-gold" />
          <TechChip label="To" name={toTech || "—"} tone="gold" />
        </div>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Target tech
          </div>
          <select
            value={toTech}
            onChange={(e) => handleToTech(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          >
            {otherTechs.length === 0 && (
              <option value="" disabled>
                No other active techs
              </option>
            )}
            {otherTechs.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Amount to move
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-mse-muted font-semibold">
              $
            </span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0}
              step="0.01"
              className="w-full pl-6 pr-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy tabular-nums"
            />
          </div>
          <div className="text-[11px] text-mse-muted mt-1">
            Defaults to the full original amount. Lower it for partial moves.
          </div>
        </label>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Note on both rows
          </div>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
            Reattribute
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function TechChip({
  label,
  name,
  tone,
}: {
  label: string;
  name: string;
  tone: "muted" | "gold";
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2",
        tone === "gold"
          ? "bg-mse-gold/20 border border-mse-gold/40"
          : "bg-mse-light border border-mse-light"
      )}
    >
      <div className="text-[9px] uppercase tracking-wider font-semibold text-mse-muted">
        {label}
      </div>
      <div className="text-sm font-bold text-mse-navy truncate max-w-[120px]">
        {name}
      </div>
    </div>
  );
}
