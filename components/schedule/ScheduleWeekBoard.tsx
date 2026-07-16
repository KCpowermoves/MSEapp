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

// Standard 2-hour shift windows. Picking one sets both the start time
// and the duration in a single tap.
const SHIFT_PRESETS = [
  { key: "morning", label: "Morning", range: "9–11", start: "09:00", mins: 120 },
  { key: "late-morning", label: "Late morning", range: "11–1", start: "11:00", mins: 120 },
  { key: "mid-afternoon", label: "Mid-afternoon", range: "1–3", start: "13:00", mins: 120 },
  { key: "late-afternoon", label: "Late afternoon", range: "3–5", start: "15:00", mins: 120 },
] as const;

// Custom start times, quarter-hour steps 6:00a – 8:00p.
const QUARTER_HOURS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 20; h++) {
    for (const m of [0, 15, 30, 45]) {
      if (h === 20 && m > 0) break;
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

/** Which shift preset (if any) a start/duration pair corresponds to. */
function shiftForValues(startTime: string, durationMins: number): string {
  const p = SHIFT_PRESETS.find(
    (s) => s.start === startTime && s.mins === durationMins
  );
  return p ? p.key : "custom";
}

/** Scope chips — units to clean and/or audit status. Shared by the
 *  admin board and the tech agenda so both read the same. */
export function ScopeBadges({
  estUnits,
  auditRequired,
}: {
  estUnits: number;
  auditRequired: boolean;
}) {
  const auditOnly = auditRequired && estUnits === 0;
  if (estUnits === 0 && !auditRequired) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {auditOnly ? (
        <span className="px-2 py-0.5 rounded-full bg-mse-navy text-white text-[10px] font-bold uppercase tracking-wider">
          Audit only
        </span>
      ) : (
        <>
          {estUnits > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-mse-gold/20 text-mse-navy text-[10px] font-bold uppercase tracking-wider">
              {estUnits} unit{estUnits === 1 ? "" : "s"}
            </span>
          )}
          {auditRequired && (
            <span className="px-2 py-0.5 rounded-full bg-mse-navy text-white text-[10px] font-bold uppercase tracking-wider">
              Audit required
            </span>
          )}
        </>
      )}
    </span>
  );
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
                          {(v.estUnits > 0 || v.auditRequired) && (
                            <div className="mt-1">
                              <ScopeBadges
                                estUnits={v.estUnits}
                                auditRequired={v.auditRequired}
                              />
                            </div>
                          )}
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
  // Time defaults to the Morning shift on a new visit.
  const [startTime, setStartTime] = useState(editing?.startTime ?? "09:00");
  const [durationMins, setDurationMins] = useState(editing?.durationMins ?? 120);
  const [shift, setShift] = useState<string>(
    editing ? shiftForValues(editing.startTime, editing.durationMins) : "morning"
  );
  const [techs, setTechs] = useState<string[]>(editing?.techs ?? []);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [estUnits, setEstUnits] = useState<number>(editing?.estUnits ?? 0);
  const [auditRequired, setAuditRequired] = useState<boolean>(
    editing?.auditRequired ?? false
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickShift(p: (typeof SHIFT_PRESETS)[number]) {
    setShift(p.key);
    setStartTime(p.start);
    setDurationMins(p.mins);
  }

  // Inline "create a new job" sub-form, so the office can build the
  // whole calendar without leaving the dialog for a job that doesn't
  // exist yet.
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [newJobName, setNewJobName] = useState("");
  const [newJobAddress, setNewJobAddress] = useState("");
  const [newJobUtility, setNewJobUtility] = useState<
    "BGE" | "PEPCO" | "Delmarva" | "SMECO"
  >("BGE");
  const [creatingJob, setCreatingJob] = useState(false);
  // A job just created here isn't in the server-rendered `jobs` prop —
  // hold it locally so selectedJob resolves.
  const [createdJob, setCreatedJob] = useState<JobLite | null>(null);

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

  const selectedJob =
    jobs.find((j) => j.jobId === jobId) ??
    (createdJob?.jobId === jobId ? createdJob : undefined);
  const canSave = Boolean(jobId && date && techs.length > 0) && !busy;

  function toggleTech(name: string) {
    setTechs((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  }

  async function createJobInline() {
    const name = newJobName.trim();
    if (!name) {
      setError("Business name is required");
      return;
    }
    setCreatingJob(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name,
          siteAddress: newJobAddress.trim(),
          utilityTerritory: newJobUtility,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobId?: string;
        job?: { jobId?: string };
      };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      const newId = body.jobId ?? body.job?.jobId ?? "";
      if (!newId) throw new Error("Job created but no ID returned");
      const lite: JobLite = {
        jobId: newId,
        customerName: name,
        siteAddress: newJobAddress.trim(),
      };
      setCreatedJob(lite);
      setJobId(newId);
      setNewJobOpen(false);
      setNewJobName("");
      setNewJobAddress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create job");
    } finally {
      setCreatingJob(false);
    }
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
              body: JSON.stringify({
                date,
                startTime,
                durationMins,
                techs,
                notes,
                estUnits,
                auditRequired,
              }),
            }
          )
        : await fetch("/api/admin/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jobId,
              date,
              startTime,
              durationMins,
              techs,
              notes,
              estUnits,
              auditRequired,
            }),
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
              ) : newJobOpen ? (
                /* Inline new-job form — create a job without leaving. */
                <div className="rounded-lg border-2 border-mse-navy/20 bg-mse-navy/[0.03] p-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] uppercase tracking-wider font-bold text-mse-navy">
                      New job
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewJobOpen(false)}
                      className="text-[11px] font-bold text-mse-muted hover:text-mse-navy"
                    >
                      Back to search
                    </button>
                  </div>
                  <input
                    type="text"
                    value={newJobName}
                    onChange={(e) => setNewJobName(e.target.value)}
                    placeholder="Business name (the property)"
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                  />
                  <input
                    type="text"
                    value={newJobAddress}
                    onChange={(e) => setNewJobAddress(e.target.value)}
                    placeholder="Site address (optional)"
                    className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                  />
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["BGE", "PEPCO", "Delmarva", "SMECO"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setNewJobUtility(u)}
                        className={cn(
                          "px-2 py-1.5 rounded-lg text-xs font-bold border-2 active:scale-95",
                          newJobUtility === u
                            ? "bg-mse-navy border-mse-navy text-white"
                            : "bg-white border-mse-light text-mse-muted hover:border-mse-navy/30"
                        )}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={createJobInline}
                    disabled={creatingJob || !newJobName.trim()}
                    className={cn(
                      "w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold",
                      "transition-[background-color,transform] active:scale-95",
                      creatingJob || !newJobName.trim()
                        ? "bg-mse-light text-mse-muted cursor-not-allowed"
                        : "bg-mse-navy text-white hover:bg-mse-navy-soft"
                    )}
                  >
                    {creatingJob && <Loader2 className="w-4 h-4 animate-spin" />}
                    Create job &amp; use it
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
                  <button
                    type="button"
                    onClick={() => {
                      setNewJobOpen(true);
                      // Seed the new-job name from whatever they typed.
                      if (jobQuery.trim() && !newJobName) setNewJobName(jobQuery.trim());
                      setError(null);
                    }}
                    className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-mse-navy border-2 border-dashed border-mse-light hover:border-mse-navy/30 active:scale-95"
                  >
                    <Plus className="w-4 h-4" />
                    Create a new job
                  </button>
                </>
              )}
            </div>
          )}

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

          {/* Time — shift presets or a 15-minute custom picker */}
          <div>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
              Shift
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {SHIFT_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => pickShift(p)}
                  className={cn(
                    "px-2 py-2 rounded-lg text-xs font-bold border-2 text-center leading-tight",
                    "active:scale-95 transition-[background-color,border-color,color]",
                    shift === p.key
                      ? "bg-mse-navy border-mse-navy text-white"
                      : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                  )}
                >
                  {p.label}
                  <span className="block text-[10px] font-normal opacity-80">
                    {p.range}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShift("custom")}
              className={cn(
                "mt-1.5 w-full px-2 py-1.5 rounded-lg text-xs font-bold border-2",
                "active:scale-[0.99] transition-[background-color,border-color,color]",
                shift === "custom"
                  ? "bg-mse-navy border-mse-navy text-white"
                  : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
              )}
            >
              Custom time
            </button>

            {shift === "custom" && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <label className="block">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
                    Start time
                  </div>
                  <select
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                  >
                    <option value="">Any time</option>
                    {QUARTER_HOURS.map((t) => (
                      <option key={t} value={t}>
                        {pretty12h(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
                    Duration (hrs)
                  </div>
                  <input
                    type="number"
                    min={0}
                    step={0.25}
                    value={durationMins ? durationMins / 60 : ""}
                    onChange={(e) =>
                      setDurationMins(
                        Math.round(Number(e.target.value) * 60) || 0
                      )
                    }
                    placeholder="e.g. 2"
                    className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Scope — what the crew is walking into */}
          <div className="rounded-xl border border-mse-light bg-mse-light/20 p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
              Job scope
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="block">
                <div className="text-[11px] font-semibold text-mse-navy mb-1">
                  HVAC units to clean (est.)
                </div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={estUnits || ""}
                  onChange={(e) =>
                    setEstUnits(Math.max(0, Math.round(Number(e.target.value) || 0)))
                  }
                  placeholder="e.g. 8"
                  className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                />
              </label>
              <div>
                <div className="text-[11px] font-semibold text-mse-navy mb-1">
                  Audit required?
                </div>
                <div className="flex rounded-lg border-2 border-mse-light overflow-hidden">
                  {[
                    { v: false, label: "No" },
                    { v: true, label: "Yes" },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setAuditRequired(o.v)}
                      className={cn(
                        "flex-1 py-2 text-sm font-bold transition-colors",
                        auditRequired === o.v
                          ? "bg-mse-navy text-white"
                          : "bg-white text-mse-muted hover:text-mse-navy"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="text-[11px] text-mse-muted">
              {auditRequired && estUnits === 0
                ? "This visit will show as Audit only."
                : estUnits > 0 && auditRequired
                ? `${estUnits} unit${estUnits === 1 ? "" : "s"} to clean + audit.`
                : estUnits > 0
                ? `${estUnits} unit${estUnits === 1 ? "" : "s"} to clean.`
                : "Set the units and whether an audit is required."}
            </div>
          </div>

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
