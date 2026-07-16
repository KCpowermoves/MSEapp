"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Date range picker + one-click week pre-selections. Creates a Draft payroll
// period when submitted; navigates to the detail page on success.

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

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format an ISO yyyy-mm-dd date as "Jul 13" without any timezone shift. */
function fmtShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

interface WeekOption {
  start: string; // Monday
  end: string; // Sunday
  relative: string; // "This week" | "Last week" | ""
}

/** Recent Monday–Sunday pay-period weeks, most recent first. These are the
 *  one-click pre-selections admins hit when running commission reports. */
function recentWeeks(count: number): WeekOption[] {
  const thisMonday = startOfThisWeekMonday();
  const out: WeekOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(thisMonday + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 7 * i);
    const start = d.toISOString().slice(0, 10);
    const end = endOfWeekSunday(start);
    const relative = i === 0 ? "This week" : i === 1 ? "Last week" : "";
    out.push({ start, end, relative });
  }
  return out;
}

export function NewPeriodForm() {
  const router = useRouter();
  const [weeks] = useState(() => recentWeeks(8));
  const [start, setStart] = useState(weeks[1]?.start ?? weeks[0].start);
  const [end, setEnd] = useState(weeks[1]?.end ?? weeks[0].end);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyWeek = (w: WeekOption) => {
    setStart(w.start);
    setEnd(w.end);
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
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1.5">
          Pick a pay-period week
        </div>
        <div className="space-y-1">
          {weeks.map((w) => {
            const selected = start === w.start && end === w.end;
            return (
              <button
                key={w.start}
                type="button"
                onClick={() => applyWeek(w)}
                aria-pressed={selected}
                className={cn(
                  "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left",
                  "transition-[border-color,background-color,color,transform] active:scale-[0.99]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-navy/30",
                  selected
                    ? "border-mse-navy bg-mse-navy/5 text-mse-navy"
                    : "border-mse-light text-mse-navy hover:border-mse-navy/30 hover:bg-mse-light/30"
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="w-3.5 h-3.5 text-mse-muted shrink-0" />
                  {fmtShort(w.start)} – {fmtShort(w.end)}
                </span>
                <span className="flex items-center gap-2">
                  {w.relative && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-mse-muted">
                      {w.relative}
                    </span>
                  )}
                  {selected && <Check className="w-4 h-4 text-mse-navy shrink-0" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted pt-1">
        Or set a custom range
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
