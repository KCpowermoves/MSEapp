"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import { useUndoStack } from "@/components/payroll/UndoContext";

// Single dialog for both:
//   - mode="manual"     → +/- adjustment with note
//   - mode="standalone" → free-form line item for work outside the app

interface Props {
  mode: "manual" | "standalone";
  periodId: string;
  activeTechs: string[];
  defaultTech: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AddAdjustmentDialog({
  mode,
  periodId,
  activeTechs,
  defaultTech,
  onClose,
  onSaved,
}: Props) {
  const [tech, setTech] = useState(defaultTech || activeTechs[0] || "");
  const [sign, setSign] = useState<"+" | "-">("+");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = useUndoStack();

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
    </Dialog>
  );
}
