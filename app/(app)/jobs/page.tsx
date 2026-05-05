import Link from "next/link";
import { Plus, DollarSign } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listJobsForTech } from "@/lib/data/jobs";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllUnits, unitPhotoCounts } from "@/lib/data/units";
import { payForTechOnDate } from "@/lib/data/pay-attribution";
import { formatCurrency, todayIsoDate } from "@/lib/utils";
import { SubmittedToast } from "@/components/SubmittedToast";
import { OfflineJobRows } from "@/components/OfflineJobRows";
import { JobsList } from "@/components/JobsList";

export const dynamic = "force-dynamic";

interface JobStats {
  pendingUnits: number;
  photosUploaded: number;
  photosRequired: number;
}

export default async function JobsHomePage({
  searchParams,
}: {
  searchParams: { submitted?: string };
}) {
  const session = await getSession();
  const techName = session.name ?? "";
  const isAdmin = session.isAdmin === true;
  const today = todayIsoDate();
  const [jobs, dispatches, units, todaysPay] = await Promise.all([
    listJobsForTech({ techName, isAdmin }),
    listAllDispatches(),
    listAllUnits(),
    payForTechOnDate({ techName, dateIso: today }),
  ]);
  const firstName = techName.split(" ")[0] || "there";

  // Today's earnings summary inputs
  const distinctDispatchIds = new Set(todaysPay.rows.map((r) => r.dispatchId));
  const installRowCount = todaysPay.rows.filter(
    (r) => r.lineItem === "Install"
  ).length;

  // Map jobId → stats from any unsubmitted dispatch
  const draftDispatchesByJob = new Map<string, Set<string>>();
  for (const d of dispatches) {
    if (d.submittedAt) continue;
    if (!draftDispatchesByJob.has(d.jobId)) {
      draftDispatchesByJob.set(d.jobId, new Set());
    }
    draftDispatchesByJob.get(d.jobId)!.add(d.dispatchId);
  }

  const statsByJob = new Map<string, JobStats>();
  for (const u of units) {
    const drafts = draftDispatchesByJob.get(u.jobId);
    if (!drafts || !drafts.has(u.dispatchId)) continue;
    const { uploaded, required } = unitPhotoCounts(u);
    const cur = statsByJob.get(u.jobId) ?? {
      pendingUnits: 0,
      photosUploaded: 0,
      photosRequired: 0,
    };
    cur.pendingUnits += 1;
    cur.photosUploaded += uploaded;
    cur.photosRequired += required;
    statsByJob.set(u.jobId, cur);
  }

  return (
    <div className="space-y-6">
      {searchParams.submitted === "1" && <SubmittedToast />}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-mse-muted">Hi,</div>
          <h1 className="text-3xl font-bold text-mse-navy tracking-tight">
            {firstName}
          </h1>
        </div>
        <Link
          href="/jobs/new"
          className="inline-flex items-center gap-1.5 bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] transition-[transform,background-color] text-white font-bold rounded-2xl px-4 py-3 shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2 shrink-0"
        >
          <Plus className="w-5 h-5" />
          <span className="text-sm">New job</span>
        </Link>
      </div>

      {/* Today's earnings card hidden 2026-05-05 per Kevin — pay UI
          surfaces are paused for now. Logic above (todaysPay,
          installRowCount, distinctDispatchIds) preserved so the card
          can come back without a refetch rewrite. */}
      {false && todaysPay.total > 0 && (
        <div className="rounded-2xl bg-mse-navy text-white p-4 shadow-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/60 font-semibold">
                Today
              </div>
              <div className="text-3xl font-bold tracking-tight mt-0.5">
                {formatCurrency(todaysPay.total)}
              </div>
            </div>
            <div className="text-right text-xs text-white/70">
              <div>
                {installRowCount} unit{installRowCount === 1 ? "" : "s"}
              </div>
              <div>
                {distinctDispatchIds.size} job
                {distinctDispatchIds.size === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/60">
            <DollarSign className="w-3 h-3" />
            updates after each job is submitted
          </div>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide">
            Active jobs
          </h2>
          <span className="text-xs text-mse-muted">last 7 days</span>
        </div>

        <OfflineJobRows />

        <JobsList
          jobs={jobs}
          statsByJob={Object.fromEntries(statsByJob.entries())}
        />
      </section>

    </div>
  );
}

