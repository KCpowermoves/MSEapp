"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduledVisit } from "@/lib/data/schedule";

interface JobLite {
  jobId: string;
  customerName: string;
  siteAddress: string;
}

interface Props {
  weekStart: string; // Monday YYYY-MM-DD
  visits: ScheduledVisit[];
  jobs: JobLite[];
  jobNameById: Record<string, { customerName: string; siteAddress: string }>;
  crewNames: string[];
  today: string;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyDay(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function pretty12h(hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const am = h < 12;
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")}${am ? "am" : "pm"}`;
}

export function ScheduleWeekBoard({
  weekStart,
  visits,
  jobs,
  jobNameById,
  crewNames,
  today,
}: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<
    | { mode: "create"; date: string }
    | { mode: "edit"; visit: ScheduledVisit }
    | null
  >(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduledVisit[]>();
    for (const v of visits) {
      const arr = m.get(v.date) ?? [];
      arr.push(v);
      m.set(v.date, arr);
    }
    return m;
  }, [visits]);

  const weekLabel = `${prettyDay(days[0])} – ${prettyDay(days[6])}`;

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          href={`/admin/schedule?week=${addDays(weekStart, -7)}`}
          className="p-2 rounded-xl border-2 border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
          aria-label="Previous week"
        >
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <div className="font-bold text-mse-navy min-w-[10rem] text-center">
          {weekLabel}
        </div>
        <Link
          href={`/admin/schedule?week=${addDays(weekStart, 7)}`}
          className="p-2 rounded-xl border-2 border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
          aria-label="Next week"
        >
          <ChevronRight className="w-4 h-4" />
        </Link>
        <Link
          href="/admin/schedule"
          className="px-3 py-2 rounded-xl text-xs font-bold border-2 border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
        >
          Today
        </Link>
        <div className="grow" />
        <button
          type="button"
          onClick={() => setDialog({ mode: "create", date: today })}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-mse-navy text-white hover:bg-mse-navy-soft shadow-card active:scale-95"
        >
          <Plus className="w-4 h-4" />
          New visit
        </button>
      </div>

      {/* Week grid — one row per day (works on every screen width) */}
      <div className="space-y-2">
        {days.map((day, i) => {
          const dayVisits = byDay.get(day) ?? [];
          const isToday = day === today;
          const isPast = day < today;
          return (
            <section
              key={day}
              className={cn(
                "rounded-2xl border bg-white shadow-card overflow-hidden",
                isToday ? "border-mse-gold" : "border-mse-light",
                isPast && "opacity-70"
              )}
            >
              <div
                className={cn(
                  "px-4 py-2 flex items-center gap-2",
                  isToday ? "bg-mse-gold/15" : "bg-mse-light/40"
                )}
              >
                <span className="font-bold text-mse-navy">
                  {DAY_LABELS[i]} {prettyDay(day)}
                </span>
                {isToday && (
                  <span className="px-2 py-0.5 rounded-full bg-mse-gold text-mse-navy text-[10px] font-bold uppercase tracking-wider">
                    Today
                  </span>
                )}
                <div className="grow" />
                <button
                  type="button"
                  onClick={() => setDialog({ mode: "create", date: day })}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-mse-muted hover:text-mse-navy"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>
              {dayVisits.length === 0 ? (
                <div className="px-4 py-3 text-xs text-mse-muted">
                  Nothing scheduled.
                </div>
              ) : (
                <ul className="divide-y divide-mse-light/60">
                  {dayVisits.map((v) => {
                    const job = jobNameById[v.jobId];
                    const cancelled = v.status === "Cancelled";
                    return (
                      <li
                        key={v.scheduleId}
                        className={cn(
                          "px-4 py-2.5 flex items-start gap-3",
                          cancelled && "opacity-50"
                        )}
                      >
                        <div className="w-16 shrink-0 text-sm font-bold text-mse-navy tabular-nums flex items-center gap-1">
                          <Clock className="w-3 h-3 text-mse-gold" />
                          {pretty12h(v.startTime) || "—"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className={cn(
                              "font-semibold text-mse-navy truncate",
                              cancelled && "line-through"
                            )}
                          >
                            {job?.customerName ?? v.jobId}
                          </div>
                          <div className="text-[11px] text-mse-muted truncate">
                            {job?.siteAddress || v.jobId}
                          </div>
                          <div className="text-[11px] text-mse-navy mt-0.5 flex items-center gap-1">
                            <Users className="w-3 h-3 text-mse-muted" />
                            {v.techs.join(", ")}
                            {v.durationMins > 0 && (
                              <span className="text-mse-muted">
                                · ~{Math.round(v.durationMins / 60 * 10) / 10}h
                              </span>
                            )}
                          </div>
                          {v.notes && (
                            <div className="text-[11px] text-mse-muted italic mt-0.5 truncate">
                              {v.notes}
                            </div>
                          )}
                          {cancelled && (
                            <span className="text-[10px] font-bold text-mse-red uppercase">
                              Cancelled
                            </span>
                          )}
                        </div>
                        {!cancelled && (
                          <button
                            type="button"
                            onClick={() => setDialog({ mode: "edit", visit: v })}
                            className="p-1.5 rounded-md text-mse-muted hover:text-mse-navy hover:bg-mse-light shrink-0"
                            aria-label="Edit visit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {dialog && (
        <VisitDialog
          state={dialog}
          jobs={jobs}
          crewNames={crewNames}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── Create / edit dialog ────────────────────────────────────────────

function VisitDialog({
  state,
  jobs,
  crewNames,
  onClose,
  onSaved,
}: {
  state:
    | { mode: "create"; date: string }
    | { mode: "edit"; visit: ScheduledVisit };
  jobs: JobLite[];
  crewNames: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.mode === "edit" ? state.visit : null;
  const [jobQuery, setJobQuery] = useState("");
  const [jobId, setJobId] = useState(editing?.jobId ?? "");
  const [date, setDate] = useState(editing?.date ?? (state.mode === "create" ? state.date : ""));
  const [startTime, setStartTime] = useState(editing?.startTime ?? "08:00");
  const [durationMins, setDurationMins] = useState(editing?.durationMins ?? 0);
  const [techs, setTechs] = useState<string[]>(editing?.techs ?? []);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return jobs.slice(0, 8);
    return jobs
      .filter(
        (j) =>
          j.customerName.toLowerCase().includes(q) ||
          j.siteAddress.toLowerCase().includes(q) ||
          j.jobId.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [jobs, jobQuery]);

  const selectedJob = jobs.find((j) => j.jobId === jobId);
  const canSave = Boolean(jobId && date && techs.length > 0) && !busy;

  function toggleTech(name: string) {
    setTechs((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = editing
        ? await fetch(
            `/api/admin/schedule/${encodeURIComponent(editing.scheduleId)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ date, startTime, durationMins, techs, notes }),
            }
          )
        : await fetch("/api/admin/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, date, startTime, durationMins, techs, notes }),
          });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  }

  async function cancelVisit() {
    if (!editing) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Cancel this visit? It stays on the calendar crossed out.")
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/schedule/${encodeURIComponent(editing.scheduleId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Cancelled" }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-elevated max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-mse-light sticky top-0 bg-white">
          <div className="font-bold text-mse-navy text-lg">
            {editing ? "Edit visit" : "Schedule a visit"}
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* Job picker (create only — a visit stays with its job) */}
          {!editing && (
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
                Job
              </div>
              {selectedJob ? (
                <div className="flex items-center gap-2 rounded-lg border border-mse-light bg-mse-light/30 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-mse-navy truncate">
                      {selectedJob.customerName}
                    </div>
                    <div className="text-[11px] text-mse-muted truncate">
                      {selectedJob.siteAddress || selectedJob.jobId}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setJobId("")}
                    className="text-[11px] font-bold text-mse-navy hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                    placeholder="Search customer, address, or job ID…"
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                  />
                  <ul className="mt-1 border border-mse-light rounded-lg divide-y divide-mse-light/60 max-h-48 overflow-y-auto">
                    {matches.map((j) => (
                      <li key={j.jobId}>
                        <button
                          type="button"
                          onClick={() => setJobId(j.jobId)}
                          className="w-full text-left px-3 py-2 hover:bg-mse-light/40"
                        >
                          <div className="text-sm font-semibold text-mse-navy">
                            {j.customerName}
                          </div>
                          <div className="text-[11px] text-mse-muted">
                            {j.siteAddress || j.jobId}
                          </div>
                        </button>
                      </li>
                    ))}
                    {matches.length === 0 && (
                      <li className="px-3 py-2 text-xs text-mse-muted">
                        No matching jobs.
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
                Date
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
              />
            </label>
            <label className="block">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
                Start time
              </div>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
              />
            </label>
          </div>

          <label className="block">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
              Estimated duration (hours, optional)
            </div>
            <input
              type="number"
              min={0}
              step={0.5}
              value={durationMins ? durationMins / 60 : ""}
              onChange={(e) =>
                setDurationMins(Math.round(Number(e.target.value) * 60) || 0)
              }
              placeholder="e.g. 4"
              className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
            />
          </label>

          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
              Crew ({techs.length} assigned)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {crewNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleTech(name)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold border-2",
                    "active:scale-95 transition-[background-color,border-color,color]",
                    techs.includes(name)
                      ? "bg-mse-navy border-mse-navy text-white"
                      : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
              Notes (optional)
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Gate code, contact on site, what to bring…"
              className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy resize-none"
            />
          </label>

          {error && (
            <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            {editing && (
              <button
                type="button"
                onClick={cancelVisit}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-mse-red hover:bg-mse-red/10"
              >
                <Ban className="w-3.5 h-3.5" />
                Cancel visit
              </button>
            )}
            <div className="grow" />
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy"
            >
              Close
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold",
                "transition-[background-color,transform] active:scale-95",
                canSave
                  ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
                  : "bg-mse-light text-mse-muted cursor-not-allowed"
              )}
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? "Save changes" : "Schedule visit"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
