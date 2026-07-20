import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, Handshake, Plus } from "lucide-react";
import { getSession, loadActiveTechs } from "@/lib/auth";
import { listAllLeads, listLeadsForAgent } from "@/lib/data/leads";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllVisits } from "@/lib/data/schedule";
import { LeadCard } from "@/components/leads/LeadCard";
import { todayIsoEastern } from "@/lib/utils";

export const dynamic = "force-dynamic";

// My Sales — the salesperson's home: their leads (admins see everyone's)
// and the schedule for jobs they sold, so they can watch their deals
// get crewed and worked.

export default async function SalesPage() {
  const session = await getSession();
  if (!session.techId) redirect("/login");
  const me = session.name ?? "";
  const isAdmin = session.isAdmin === true;

  const [leads, techs, jobs, visits] = await Promise.all([
    isAdmin ? listAllLeads() : listLeadsForAgent(me),
    loadActiveTechs(),
    listAllJobs(),
    listAllVisits().catch(() => []),
  ]);

  const sorted = [...leads].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );
  const crewTechs = techs
    .filter((t) => t.crewEligible && !t.isSales)
    .map((t) => t.name)
    .sort();

  // Calendar: scheduled visits on jobs this agent sold (admins: all
  // self-sold jobs), from today forward.
  const today = todayIsoEastern();
  const myJobIds = new Set(
    jobs
      .filter((j) => j.selfSold && (isAdmin || j.soldBy === me))
      .map((j) => j.jobId)
  );
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const upcoming = visits
    .filter(
      (v) =>
        v.status === "Scheduled" && v.date >= today && myJobIds.has(v.jobId)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  const open = sorted.filter((l) => l.status === "Sent");
  const closed = sorted.filter((l) => l.status !== "Sent");

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
            <Handshake className="w-7 h-7 text-mse-gold" />
            {isAdmin ? "All sales" : "My sales"}
          </h1>
          <p className="text-sm text-mse-muted mt-1">
            {open.length} open lead{open.length === 1 ? "" : "s"} ·{" "}
            {sorted.filter((l) => l.status === "Converted").length} converted
          </p>
        </div>
        <Link
          href="/leads/new"
          className="inline-flex items-center gap-1.5 bg-mse-navy hover:bg-mse-navy-soft text-white font-bold rounded-2xl px-4 py-3 shadow-card active:scale-[0.98] shrink-0"
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm">New lead</span>
        </Link>
      </div>

      {/* Upcoming visits on sold jobs */}
      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <CalendarDays className="w-4 h-4" />
          Upcoming visits on your sales
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-mse-light p-5 text-center text-sm text-mse-muted">
            Nothing scheduled yet — signed jobs land here once they&apos;re
            assigned.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-mse-light shadow-card divide-y divide-mse-light">
            {upcoming.map((v) => {
              const job = jobById.get(v.jobId);
              return (
                <Link
                  key={v.scheduleId}
                  href={`/jobs/${encodeURIComponent(v.jobId)}`}
                  className="flex items-center gap-3 p-3 hover:bg-mse-light/20"
                >
                  <div className="text-center shrink-0 w-12">
                    <div className="text-[10px] uppercase font-bold text-mse-muted">
                      {new Date(v.date + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
                    </div>
                    <div className="text-lg font-bold text-mse-navy leading-none">
                      {Number(v.date.slice(8, 10))}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-mse-navy truncate">
                      {job?.customerName ?? v.jobId}
                    </div>
                    <div className="text-xs text-mse-muted">
                      {v.startTime} · {v.techs.join(", ") || "unassigned"}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Open leads */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide">
          Open leads
        </h2>
        {open.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-mse-light p-5 text-center text-sm text-mse-muted">
            No open leads. Tap New lead to start one.
          </div>
        ) : (
          open.map((l) => (
            <LeadCard key={l.leadId} lead={l} crewTechs={crewTechs} showAgent={isAdmin} isAdmin={isAdmin} />
          ))
        )}
      </section>

      {/* History */}
      {closed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide">
            History
          </h2>
          {closed.map((l) => (
            <LeadCard key={l.leadId} lead={l} crewTechs={crewTechs} showAgent={isAdmin} isAdmin={isAdmin} />
          ))}
        </section>
      )}
    </div>
  );
}
