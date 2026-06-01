import Link from "next/link";
import { CheckCircle2, Clock, Plus } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listJobsForTech } from "@/lib/data/jobs";
import {
  autoFinalizeOpenDraftsForTech,
  listAllDispatches,
} from "@/lib/data/dispatches";
import { listAllUnits, unitPhotoCounts } from "@/lib/data/units";
import {
  payForTechOnDate,
  payForTechInRange,
} from "@/lib/data/pay-attribution";
import { listAllPayrollPeriods } from "@/lib/data/payroll-periods";
import { estimatedInstallPayForTech } from "@/lib/pay-rates";
import {
  cn,
  endOfWeekIso,
  formatCurrency,
  startOfWeekIso,
  todayIsoDate,
} from "@/lib/utils";
import { SubmittedToast } from "@/components/SubmittedToast";
import { OfflineJobRows } from "@/components/OfflineJobRows";
import { JobsList } from "@/components/JobsList";

export const dynamic = "force-dynamic";

interface JobStats {
  pendingUnits: number;
  photosUploaded: number;
  photosRequired: number;
  /** Tech's estimated install pay across the pending units, with
   *  crew-split factored in. Motivational figure — locks in on
   *  finalize. Zero if the tech isn't on the dispatch crew. */
  estimatedPay: number;
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

  // Tech landed on the jobs index — they're no longer working on any
  // specific job, so any of their open drafts from today should
  // auto-finalize. Fire-and-forget; don't block the page render. The
  // 8pm cron sweep is the safety net for anything this misses.
  if (techName) {
    autoFinalizeOpenDraftsForTech(techName, { exceptJobId: null }).catch(
      (e) => console.warn("[jobs] auto-finalize on index failed:", e)
    );
  }

  // Mon-Sun week containing today + the prior Mon-Sun week for the
  // "Last week's invoice" preview tile.
  const weekStartIso = startOfWeekIso();
  const weekEndIso = endOfWeekIso();
  const lastWeekStartIso = (() => {
    const d = new Date(weekStartIso);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const lastWeekEndIso = (() => {
    const d = new Date(weekStartIso);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const [
    jobs,
    dispatches,
    units,
    todaysPay,
    weekPay,
    lastWeekPay,
    payrollPeriods,
  ] = await Promise.all([
    listJobsForTech({ techName, isAdmin }),
    listAllDispatches(),
    listAllUnits(),
    payForTechOnDate({ techName, dateIso: today }),
    payForTechInRange({
      techName,
      startIso: weekStartIso,
      endIso: weekEndIso,
    }),
    payForTechInRange({
      techName,
      startIso: lastWeekStartIso,
      endIso: lastWeekEndIso,
    }),
    listAllPayrollPeriods(),
  ]);
  const firstName = techName.split(" ")[0] || "there";

  // Today's earnings summary inputs
  const distinctDispatchIds = new Set(todaysPay.rows.map((r) => r.dispatchId));
  const installRowCount = todaysPay.rows.filter(
    (r) => r.lineItem === "Install"
  ).length;

  // Week summary inputs.
  const weekDispatchIds = new Set(weekPay.rows.map((r) => r.dispatchId));

  // Classify each row in the week as "confirmed" (sits inside a
  // commission period whose status is Approved or Paid) vs
  // "unconfirmed" (preview — no approved period covers it yet). A
  // single approved period that overlaps the row's date is enough to
  // mark it confirmed, even if other Draft periods also overlap.
  const lockedPeriods = payrollPeriods.filter(
    (p) => p.status === "Approved" || p.status === "Paid"
  );
  function isRowConfirmed(rowDate: string): boolean {
    return lockedPeriods.some(
      (p) =>
        p.startDate &&
        p.endDate &&
        rowDate >= p.startDate &&
        rowDate <= p.endDate
    );
  }
  // Compact this-week tile only needs to know whether any rows are
  // still in preview state — flipping the label between "preview"
  // and "confirmed". The detailed confirmed/preview $ split is now
  // visible on the per-period page.
  let weekUnconfirmed = 0;
  for (const r of weekPay.rows) {
    if (!isRowConfirmed(r.date)) weekUnconfirmed += r.amount;
  }
  // Only need the unconfirmed total to know whether last week's
  // invoice has been fully approved — the compact tile no longer
  // surfaces the confirmed/preview split or the job count.
  let lastWeekUnconfirmed = 0;
  for (const r of lastWeekPay.rows) {
    if (!isRowConfirmed(r.date)) lastWeekUnconfirmed += r.amount;
  }
  const lastWeekFullyConfirmed =
    lastWeekPay.total > 0 && lastWeekUnconfirmed === 0;

  // Map jobId → set of unsubmitted dispatchIds + the dispatch
  // metadata needed to compute the tech's share.
  const draftDispatchesByJob = new Map<string, Set<string>>();
  const draftDispatchById = new Map<
    string,
    { jobId: string; techsOnSite: string[]; crewSplit: "Solo" | "50-50" | "33-33-33" }
  >();
  for (const d of dispatches) {
    if (d.submittedAt) continue;
    if (!draftDispatchesByJob.has(d.jobId)) {
      draftDispatchesByJob.set(d.jobId, new Set());
    }
    draftDispatchesByJob.get(d.jobId)!.add(d.dispatchId);
    draftDispatchById.set(d.dispatchId, {
      jobId: d.jobId,
      techsOnSite: d.techsOnSite,
      crewSplit: d.crewSplit,
    });
  }

  const statsByJob = new Map<string, JobStats>();
  // Group pending units by dispatch so the crew-split estimate is
  // calculated per dispatch (which is where the split lives).
  const unitsByDraftDispatch = new Map<
    string,
    { unitType: string }[]
  >();
  for (const u of units) {
    const drafts = draftDispatchesByJob.get(u.jobId);
    if (!drafts || !drafts.has(u.dispatchId)) continue;
    const { uploaded, required } = unitPhotoCounts(u);
    const cur = statsByJob.get(u.jobId) ?? {
      pendingUnits: 0,
      photosUploaded: 0,
      photosRequired: 0,
      estimatedPay: 0,
    };
    cur.pendingUnits += 1;
    cur.photosUploaded += uploaded;
    cur.photosRequired += required;
    statsByJob.set(u.jobId, cur);

    const arr = unitsByDraftDispatch.get(u.dispatchId) ?? [];
    arr.push({ unitType: u.unitType });
    unitsByDraftDispatch.set(u.dispatchId, arr);
  }

  // Per-dispatch pay estimate → fold into the job's total. Splits are
  // applied via estimatedInstallPayForTech so a 50-50 dispatch shows
  // half the install rate to this tech.
  if (techName) {
    for (const [dispatchId, dispatchUnits] of Array.from(
      unitsByDraftDispatch.entries()
    )) {
      const meta = draftDispatchById.get(dispatchId);
      if (!meta) continue;
      const share = estimatedInstallPayForTech({
        units: dispatchUnits as { unitType: import("@/lib/types").UnitType }[],
        crewSplit: meta.crewSplit,
        techsOnSite: meta.techsOnSite,
        techName,
      });
      const cur = statsByJob.get(meta.jobId);
      if (cur) cur.estimatedPay += share;
    }
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

      {/* Earnings summary — three tiles in one row at the very top of
          the dashboard so the tech sees Today, This week, and Last
          week side-by-side without scrolling. Last week takes equal
          column width but trims its detail lines so the 3-up fits on
          a phone. Status pill on Last week flips green once an admin
          approves the commission report covering that week; stays
          gold while it's still a preview. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-mse-navy text-white p-3 shadow-elevated">
          <div className="text-[10px] uppercase tracking-[0.1em] text-mse-gold font-bold">
            Today
          </div>
          <div className="text-2xl font-bold tracking-tight mt-0.5 tabular-nums">
            {formatCurrency(todaysPay.total)}
          </div>
          <div className="mt-1 text-[10px] text-white/65 leading-tight">
            {installRowCount} unit{installRowCount === 1 ? "" : "s"} ·{" "}
            {distinctDispatchIds.size} job
            {distinctDispatchIds.size === 1 ? "" : "s"}
          </div>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-mse-navy-soft to-mse-navy text-white p-3 shadow-elevated">
          <div className="text-[10px] uppercase tracking-[0.1em] text-mse-gold font-bold">
            This week
          </div>
          <div className="text-2xl font-bold tracking-tight mt-0.5 tabular-nums">
            {formatCurrency(weekPay.total)}
          </div>
          <div className="mt-1 text-[10px] text-white/65 leading-tight">
            {weekDispatchIds.size} job{weekDispatchIds.size === 1 ? "" : "s"} ·
            {weekUnconfirmed > 0 ? " preview" : " confirmed"}
          </div>
        </div>

        {/* Last week — same column width, status-tinted background so
            the tech can tell at a glance whether last week's invoice
            has been approved. Renders even at $0 to keep the three
            columns balanced. */}
        <div
          className={cn(
            "rounded-2xl p-3 shadow-elevated text-white relative overflow-hidden",
            lastWeekFullyConfirmed
              ? "bg-gradient-to-br from-emerald-700 to-emerald-900"
              : lastWeekPay.total > 0
              ? "bg-gradient-to-br from-mse-navy to-mse-navy-soft"
              : "bg-mse-navy-soft/80"
          )}
        >
          <div
            className={cn(
              "text-[10px] uppercase tracking-[0.1em] font-bold",
              lastWeekFullyConfirmed ? "text-emerald-200" : "text-mse-gold"
            )}
          >
            Last week
          </div>
          <div className="text-2xl font-bold tracking-tight mt-0.5 tabular-nums">
            {formatCurrency(lastWeekPay.total)}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] leading-tight">
            {lastWeekFullyConfirmed ? (
              <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold uppercase tracking-wider">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Confirmed
              </span>
            ) : lastWeekPay.total > 0 ? (
              <span className="inline-flex items-center gap-1 text-mse-gold font-semibold uppercase tracking-wider">
                <Clock className="w-2.5 h-2.5" />
                Preview
              </span>
            ) : (
              <span className="text-white/50">No activity</span>
            )}
          </div>
        </div>
      </div>

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


