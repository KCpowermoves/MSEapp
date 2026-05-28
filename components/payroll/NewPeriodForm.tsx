"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Date range picker + quick-jump shortcuts. Creates a Draft payroll
// period when submitted; navigates to the detail page on success.

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfThisWeekMonday(): string {
  const d = new Date();
  const dayOfWeek = d.getDay(); // 0 = Sun
  const diff = (dayOfWeek + 6) % 7; // days since Monday
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function endOfWeekSunday(monday: string): string {
  const d = new Date(monday + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

interface Shortcut {
  label: string;
  start: () => string;
  end: () => string;
}

const SHORTCUTS: Shortcut[] = [
  {
    label: "This week (Mon–Sun)",
    start: () => startOfThisWeekMonday(),
    end: () => endOfWeekSunday(startOfThisWeekMonday()),
  },
  {
    label: "Last week",
    start: () => {
      const d = new Date(startOfThisWeekMonday() + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 7);
      return d.toISOString().slice(0, 10);
    },
    end: () => {
      const d = new Date(startOfThisWeekMonday() + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    },
  },
  {
    label: "Last 7 days",
    start: () => isoOffset(-6),
    end: () => isoToday(),
  },
  {
    label: "Last 14 days",
    start: () => isoOffset(-13),
    end: () => isoToday(),
  },
];

export function NewPeriodForm() {
  const router = useRouter();
  const [start, setStart] = useState(SHORTCUTS[0].start());
  const [end, setEnd] = useState(SHORTCUTS[0].end());
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = (s: Shortcut) => {
    setStart(s.start());
    setEnd(s.end());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payroll/periods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: start,
          endDate: end,
          label,
          note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        period?: { periodId?: string };
      };
      if (!res.ok) {
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      const id = data.period?.periodId;
      if (!id) throw new Error("Period created but server returned no id");
      router.push(`/admin/payroll/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create period");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {SHORTCUTS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => apply(s)}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[11px] font-semibold border",
              "border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30",
              "active:scale-95 transition-[border-color,color,transform]"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Start
          </div>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
        </label>
        <label className="block">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1 flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            End
          </div>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            required
            className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
        </label>
      </div>

      <label className="block">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
          Label (optional)
        </div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='e.g. "Week of May 1"'
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
          placeholder="Anything worth flagging on this period."
          className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
        />
      </label>

      {error && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !start || !end}
        className={cn(
          "w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 font-bold text-sm",
          "transition-[background-color,transform] active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
          submitting || !start || !end
            ? "bg-mse-light text-mse-muted cursor-not-allowed"
            : "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
        )}
      >
        {submitting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Check className="w-4 h-4" />
        )}
        {submitting ? "Creating…" : "Create Draft period"}
      </button>
    </form>
  );
}
