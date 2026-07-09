import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { listVisitsInRange } from "@/lib/data/schedule";
import { listAllJobs } from "@/lib/data/jobs";
import { loadActiveTechs } from "@/lib/auth";
import { mondayOf } from "@/lib/data/payroll-periods";
import { todayIsoEastern } from "@/lib/utils";
import { ScheduleWeekBoard } from "@/components/schedule/ScheduleWeekBoard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? "")
    ? (searchParams.week as string)
    : todayIsoEastern();
  const weekStart = mondayOf(anchor);
  const weekEnd = addDays(weekStart, 6);

  const [visits, jobs, techs] = await Promise.all([
    listVisitsInRange({ startIso: weekStart, endIso: weekEnd }),
    listAllJobs(),
    loadActiveTechs(),
  ]);

  // Slim job list for the picker + name lookups (open jobs first).
  const jobLite = jobs
    .filter((j) => j.status !== "Closed")
    .sort((a, b) =>
      (b.lastActivityDate || b.createdDate).localeCompare(
        a.lastActivityDate || a.createdDate
      )
    )
    .map((j) => ({
      jobId: j.jobId,
      customerName: j.customerName,
      siteAddress: j.siteAddress,
    }));
  const jobNameById: Record<string, { customerName: string; siteAddress: string }> = {};
  for (const j of jobs) {
    jobNameById[j.jobId] = {
      customerName: j.customerName,
      siteAddress: j.siteAddress,
    };
  }

  const crewNames = techs.filter((t) => t.crewEligible).map((t) => t.name);

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Admin
      </Link>

      <header>
        <div className="text-sm text-mse-muted">Admin</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <CalendarDays className="w-7 h-7 text-mse-gold" />
          Schedule
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Plan the week: assign crews to jobs with a date and time. Techs
          see their own visits under &ldquo;My Schedule.&rdquo;
        </p>
      </header>

      <ScheduleWeekBoard
        weekStart={weekStart}
        visits={visits}
        jobs={jobLite}
        jobNameById={jobNameById}
        crewNames={crewNames}
        today={todayIsoEastern()}
      />
    </div>
  );
}
