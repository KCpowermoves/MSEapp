"use client";

import { useMemo, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/payroll/Dialog";
import { useUndoStack } from "@/components/payroll/UndoContext";
import type { CrewSplit } from "@/lib/types";
import type { PeriodDispatchLite } from "@/components/payroll/TechSection";

// Retroactively re-split a dispatch's install pay across a new crew
// roster. Server computes the per-tech delta and writes split-change
// adjustment rows. Sales/service/travel are not touched.

interface Props {
  periodId: string;
  dispatches: PeriodDispatchLite[];
  dispatchUnits: Record<
    string,
    { unitId: string; unitNumberOnJob: number; unitType: string }[]
  >;
  activeTechs: string[];
  initialDispatchId: string;
  onClose: () => void;
  onSaved: () => void;
}

const SPLITS: CrewSplit[] = ["Solo", "50-50", "33-33-33"];
const SPLIT_SIZE: Record<CrewSplit, number> = {
  Solo: 1,
  "50-50": 2,
  "33-33-33": 3,
};

export function SplitChangeDialog({
  periodId,
  dispatches,
  dispatchUnits,
  activeTechs,
  initialDispatchId,
  onClose,
  onSaved,
}: Props) {
  const [dispatchId, setDispatchId] = useState(initialDispatchId);
  const dispatch = useMemo(
    () => dispatches.find((d) => d.dispatchId === dispatchId),
    [dispatches, dispatchId]
  );

  const [newSplit, setNewSplit] = useState<CrewSplit>(
    (dispatch?.crewSplit as CrewSplit) ?? "Solo"
  );
  const [newCrew, setNewCrew] = useState<string[]>(
    dispatch?.techsOnSite ?? []
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedSize = SPLIT_SIZE[newSplit];
  const sizeMismatch = newCrew.length !== expectedSize;
  const units = (dispatch && dispatchUnits[dispatch.dispatchId]) || [];

  const toggleTech = (name: string) => {
    setNewCrew((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      // Cap at expectedSize to keep the form sensible.
      if (prev.length >= expectedSize) {
        const next = prev.slice(0, expectedSize - 1);
        return [...next, name];
      }
      return [...prev, name];
    });
  };

  // When dispatch picker changes, reset crew/split to that dispatch's
  // current values so the user starts from accurate state.
  const handleDispatchChange = (id: string) => {
    setDispatchId(id);
    const d = dispatches.find((x) => x.dispatchId === id);
    if (d) {
      setNewSplit(d.crewSplit as CrewSplit);
      setNewCrew(d.techsOnSite);
    }
  };

  const canSubmit =
    !!dispatch && !sizeMismatch && newCrew.length > 0 && !submitting;

  const undo = useUndoStack();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payroll/split-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodId,
          dispatchId,
          newTechs: newCrew,
          newCrewSplit: newSplit,
          note,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        rows?: { adjustmentId?: string }[];
      };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      const ids = (body.rows ?? [])
        .map((r) => r?.adjustmentId)
        .filter((x): x is string => Boolean(x));
      if (ids.length > 0) {
        undo.push({
          label: `Changed crew split on ${dispatchId}`,
          adjustmentIds: ids,
          undoable: true,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change split");
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="Change crew split"
      subtitle="Recomputes the unit pay across a new crew. Only Service pay is affected; sales/standalone/travel stay put."
      size="lg"
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Dispatch to re-split
          </div>
          <select
            value={dispatchId}
            onChange={(e) => handleDispatchChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          >
            {dispatches.map((d) => (
              <option key={d.dispatchId} value={d.dispatchId}>
                {d.dispatchDate} · {d.dispatchId} · {d.crewSplit} (
                {d.techsOnSite.join(", ")})
              </option>
            ))}
          </select>
        </label>

        {dispatch && (
          <div className="rounded-xl border border-mse-light bg-mse-light/30 p-3 text-xs">
            <div className="text-mse-muted">Current crew on this dispatch</div>
            <div className="font-semibold text-mse-navy mt-0.5">
              {dispatch.techsOnSite.join(", ")} · {dispatch.crewSplit}
            </div>
            <div className="text-mse-muted mt-1">
              {units.length} unit{units.length === 1 ? "" : "s"}:{" "}
              {units
                .map(
                  (u) => `#${String(u.unitNumberOnJob).padStart(3, "0")} ${u.unitType}`
                )
                .slice(0, 4)
                .join(" · ")}
              {units.length > 4 && ` + ${units.length - 4} more`}
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            New split
          </div>
          <div className="flex gap-1">
            {SPLITS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setNewSplit(s)}
                className={cn(
                  "flex-1 px-3 py-2 rounded-lg text-sm font-bold border",
                  newSplit === s
                    ? "bg-mse-navy text-white border-mse-navy"
                    : "bg-white border-mse-light text-mse-muted hover:border-mse-navy/30 hover:text-mse-navy"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 flex items-center gap-1">
            <Users className="w-3 h-3" />
            New crew · pick {expectedSize} tech
            {expectedSize === 1 ? "" : "s"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeTechs.map((t) => {
              const picked = newCrew.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTech(t)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[11px] font-semibold border",
                    "transition-[background-color,border-color,color]",
                    picked
                      ? "bg-mse-navy border-mse-navy text-white"
                      : "bg-white border-mse-light text-mse-muted hover:border-mse-navy/30 hover:text-mse-navy"
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
          {sizeMismatch && (
            <div className="text-[11px] text-mse-red mt-1.5">
              {newSplit} needs exactly {expectedSize} tech
              {expectedSize === 1 ? "" : "s"} — you have {newCrew.length}.
            </div>
          )}
        </div>

        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Note (optional)
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for the correction, audit-friendly."
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
            Apply split change
          </button>
        </div>
      </form>
    </Dialog>
  );
}
