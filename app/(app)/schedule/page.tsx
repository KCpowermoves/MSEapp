import Link from "next/link";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listUpcomingVisitsForTech } from "@/lib/data/schedule";
import { listAllJobs } from "@/lib/data/jobs";
import { todayIsoEastern } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function prettyDay(iso: string, today: string): string {
  if (iso === today) return "Today";
  const tomorrow = new Date(today + "T00:00:00Z");
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (iso === tomorrow.toISOString().slice(0, 10)) return "Tomorrow";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
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

export default async function MySchedulePage() {
  const session = await getSession();
  const techName = session.name ?? "";
  const today = todayIsoEastern();

  const [visits, jobs] = await Promise.all([
    listUpcomingVisitsForTech({ techName, fromIso: today, days: 14 }),
    listAllJobs(),
  ]);
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));

  // Group by day for a clean agenda view.
  const byDay = new Map<string, typeof visits>();
  for (const v of visits) {
    const arr = byDay.get(v.date) ?? [];
    arr.push(v);
    byDay.set(v.date, arr);
  }
  const days = Array.from(byDay.keys()).sort();

  return (
    <div className="space-y-6">
      <header>
        <div className="text-sm text-mse-muted">Next 14 days</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <CalendarDays className="w-7 h-7 text-mse-gold" />
          My Schedule
        </h1>
      </header>

      {days.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center">
          <p className="text-sm text-mse-muted">
            Nothing on your schedule for the next two weeks. The office
            assigns visits — check back or call in.
          </p>
        </div>
      ) : (
        days.map((day) => (
          <section key={day}>
            <h2
              className={cn(
                "text-sm font-bold uppercase tracking-wide mb-2",
                day === today ? "text-mse-gold" : "text-mse-muted"
              )}
            >
              {prettyDay(day, today)}
            </h2>
            <ul className="space-y-2">
              {(byDay.get(day) ?? []).map((v) => {
                const job = jobById.get(v.jobId);
                const mapsUrl = job?.siteAddress
                  ? `https://maps.google.com/?q=${encodeURIComponent(job.siteAddress)}`
                  : null;
                return (
                  <li
                    key={v.scheduleId}
                    className="bg-white rounded-2xl border border-mse-light shadow-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/jobs/${encodeURIComponent(v.jobId)}`}
                          className="font-bold text-mse-navy hover:underline"
                        >
                          {job?.customerName ?? v.jobId}
                        </Link>
                        {job?.siteAddress && (
                          <div className="text-xs text-mse-muted mt-0.5 flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {mapsUrl ? (
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline truncate"
                              >
                                {job.siteAddress}
                              </a>
                            ) : (
                              <span className="truncate">{job.siteAddress}</span>
                            )}
                          </div>
                        )}
                        <div className="text-xs text-mse-navy mt-1 flex items-center gap-1">
                          <Users className="w-3 h-3 text-mse-muted" />
                          {v.techs.join(", ")}
                        </div>
                        {v.notes && (
                          <div className="text-xs text-mse-muted italic mt-1">
                            {v.notes}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="inline-flex items-center gap-1 font-bold text-mse-navy tabular-nums">
                          <Clock className="w-3.5 h-3.5 text-mse-gold" />
                          {pretty12h(v.startTime) || "any time"}
                        </div>
                        {v.durationMins > 0 && (
                          <div className="text-[11px] text-mse-muted mt-0.5">
                            ~{Math.round((v.durationMins / 60) * 10) / 10} hrs
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
