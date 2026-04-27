import Link from "next/link";
import { Plus, ChevronRight, MapPin } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listActiveJobs } from "@/lib/data/jobs";
import { ageInDays } from "@/lib/utils";
import { SubmittedToast } from "@/components/SubmittedToast";

export const dynamic = "force-dynamic";

export default async function JobsHomePage({
  searchParams,
}: {
  searchParams: { submitted?: string };
}) {
  const [session, jobs] = await Promise.all([
    getSession(),
    listActiveJobs(),
  ]);
  const firstName = (session.name ?? "").split(" ")[0] || "there";

  return (
    <div className="space-y-6">
      {searchParams.submitted === "1" && <SubmittedToast />}
      <div>
        <div className="text-sm text-mse-muted">Hi,</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight">
          {firstName}
        </h1>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide">
            Active jobs
          </h2>
          <span className="text-xs text-mse-muted">last 7 days</span>
        </div>

        {jobs.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center">
            <p className="text-mse-muted">No active jobs.</p>
            <p className="text-xs text-mse-muted mt-1">
              Tap the button below to create your first one.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => {
              const age = Math.floor(
                ageInDays(j.lastActivityDate || j.createdDate)
              );
              return (
                <li key={j.jobId}>
                  <Link
                    href={`/jobs/${encodeURIComponent(j.jobId)}`}
                    className="block bg-white rounded-2xl border border-mse-light p-4 shadow-card hover:shadow-elevated active:scale-[0.99] transition-[transform,box-shadow]"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-mse-navy truncate">
                          {j.customerName}
                        </div>
                        <div className="text-sm text-mse-muted truncate flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {j.siteAddress}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <TerritoryPill territory={j.utilityTerritory} />
                          <span className="text-xs text-mse-muted">
                            {age === 0 ? "today" : `${age}d ago`}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-mse-muted shrink-0 mt-1" />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Link
        href="/jobs/new"
        className="block w-full bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] transition-[transform,background-color] text-white font-bold rounded-2xl py-4 text-center shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2"
      >
        <span className="inline-flex items-center gap-2">
          <Plus className="w-5 h-5" />
          New job
        </span>
      </Link>
    </div>
  );
}

function TerritoryPill({ territory }: { territory: string }) {
  const colors: Record<string, string> = {
    BGE: "bg-mse-navy/10 text-mse-navy",
    PEPCO: "bg-mse-navy/10 text-mse-navy",
    Delmarva: "bg-mse-gold/15 text-mse-navy",
    SMECO: "bg-mse-gold/15 text-mse-navy",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
        colors[territory] ?? "bg-mse-light text-mse-text"
      }`}
    >
      {territory}
    </span>
  );
}
