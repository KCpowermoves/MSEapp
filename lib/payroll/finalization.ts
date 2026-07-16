import "server-only";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllUnits, unitHasAllRequiredPhotos } from "@/lib/data/units";
import { listAllAttributions } from "@/lib/data/pay-attribution";
import { listAllAudits } from "@/lib/data/audits";
import { listAllVisits } from "@/lib/data/schedule";
import { mondayOf } from "@/lib/data/payroll-periods";
import { todayIsoEastern } from "@/lib/utils";

// ─── Finalization detector ───────────────────────────────────────────
//
// Classifies every dispatch (day of work) since the split-pay epoch and
// rolls problems up per job, so the admin worklist can show "projects
// that need finalizing" before a week's commission report is approved.
//
// Reasons, per dispatch:
//  - not-submitted:  the crew never hit submit (and the nightly auto-
//                    finalize cron hasn't caught it / failed)
//  - no-pay:         submitted, but its Pay Attribution rows sum to $0 —
//                    the week will silently underpay unless corrected
//  - missing-photos: one or more units on the dispatch fail the
//                    required-photo checklist (recomputed live, so late
//                    uploads self-heal the flag)
// Reason, per job:
//  - audit-incomplete: an energy audit was started but is still Draft,
//                    or a past scheduled visit required an audit that
//                    was never started
//
// Force-finalize suppression: when an admin stamps a job (Jobs R/S/T),
// dispatch issues dated ON OR BEFORE the stamp are settled. Issues on
// later dispatches re-flag the job — multi-week projects stay honest.

/** No detection before this date — the week split-pay went live and
 *  the finalization workflow began. Mirrors the weekly-period cron. */
export const FINALIZE_EPOCH = "2026-07-06";

export type FinalizeReason =
  | "not-submitted"
  | "no-pay"
  | "missing-photos"
  | "audit-incomplete";

export interface DispatchIssue {
  dispatchId: string;
  /** YYYY-MM-DD dispatch date — also what dates its pay into a week. */
  date: string;
  /** Monday of the Mon–Sun week this dispatch pays into. */
  weekOf: string;
  techs: string[];
  reasons: FinalizeReason[];
  /** What this dispatch actually attributed, for admin context. */
  payTotal: number;
  unitCount: number;
  unitsMissingPhotos: number;
}

export interface UnfinalizedJob {
  jobId: string;
  customerName: string;
  siteAddress: string;
  /** Latest problem date — drives most-recent-first sorting. */
  latestDate: string;
  /** Union of reasons across this job's problem dispatches + audit. */
  reasons: FinalizeReason[];
  dispatches: DispatchIssue[];
  auditIncomplete: boolean;
  /** Every tech seen on this job's in-scope dispatches (problem or
   *  not) — feeds the adjustment modal's tech picker. */
  techs: string[];
  /** Pass-through of a prior force-finalize stamp, when present. */
  finalizedAt: string;
  finalizedBy: string;
}

export interface FinalizationReport {
  jobs: UnfinalizedJob[];
  counts: {
    jobs: number;
    dispatches: number;
    byReason: Record<FinalizeReason, number>;
  };
}

export async function computeFinalizationReport(opts?: {
  /** Restrict dispatch issues to this inclusive window (weekly close
   *  panel). Omit for the global worklist. */
  weekStart?: string;
  weekEnd?: string;
}): Promise<FinalizationReport> {
  const today = todayIsoEastern();
  const [jobs, dispatches, units, attributions, audits, visits] =
    await Promise.all([
      listAllJobs(),
      listAllDispatches(),
      listAllUnits(),
      listAllAttributions(),
      listAllAudits(),
      listAllVisits().catch(() => []),
    ]);

  // Index the heavy tabs once.
  const paidByDispatch = new Map<string, number>();
  for (const a of attributions) {
    paidByDispatch.set(
      a.dispatchId,
      (paidByDispatch.get(a.dispatchId) ?? 0) + a.amount
    );
  }
  const unitsByDispatch = new Map<string, typeof units>();
  for (const u of units) {
    const list = unitsByDispatch.get(u.dispatchId) ?? [];
    list.push(u);
    unitsByDispatch.set(u.dispatchId, list);
  }
  const auditByJob = new Map(audits.map((a) => [a.jobId, a]));
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));

  // Jobs where a past scheduled visit demanded an audit.
  const auditRequiredJobs = new Set<string>();
  for (const v of visits) {
    if (
      v.auditRequired &&
      v.status === "Scheduled" &&
      v.date &&
      v.date <= today
    ) {
      auditRequiredJobs.add(v.jobId);
    }
  }

  const inScope = (date: string) =>
    date >= FINALIZE_EPOCH &&
    date <= today &&
    (!opts?.weekStart || date >= opts.weekStart) &&
    (!opts?.weekEnd || date <= opts.weekEnd);

  interface Bucket {
    issues: DispatchIssue[];
    allTechs: Set<string>;
    /** Latest in-scope dispatch date regardless of problems — decides
     *  whether a stale audit flag or old stamp should resurface. */
    latestActivity: string;
  }
  const buckets = new Map<string, Bucket>();
  const bucketFor = (jobId: string): Bucket => {
    let b = buckets.get(jobId);
    if (!b) {
      b = { issues: [], allTechs: new Set(), latestActivity: "" };
      buckets.set(jobId, b);
    }
    return b;
  };

  for (const d of dispatches) {
    if (!d.dispatchDate || !inScope(d.dispatchDate)) continue;
    const job = jobById.get(d.jobId);
    if (!job) continue;

    const b = bucketFor(d.jobId);
    for (const t of d.techsOnSite) b.allTechs.add(t);
    if (d.dispatchDate > b.latestActivity) b.latestActivity = d.dispatchDate;

    // Settled by a prior force-finalize stamp.
    const stampDate = job.finalizedAt ? job.finalizedAt.slice(0, 10) : "";
    if (stampDate && d.dispatchDate <= stampDate) continue;

    const reasons: FinalizeReason[] = [];
    const dispatchUnits = unitsByDispatch.get(d.dispatchId) ?? [];
    const missing = dispatchUnits.filter(
      (u) => !unitHasAllRequiredPhotos(u)
    ).length;
    const payTotal = paidByDispatch.get(d.dispatchId) ?? 0;

    if (!d.submittedAt) {
      // Same-day open drafts are live work, not problems — the nightly
      // cron finalizes them tonight. Only prior days flag.
      if (d.dispatchDate < today) reasons.push("not-submitted");
    } else {
      if (payTotal === 0) reasons.push("no-pay");
      if (missing > 0) reasons.push("missing-photos");
    }

    if (reasons.length > 0) {
      b.issues.push({
        dispatchId: d.dispatchId,
        date: d.dispatchDate,
        weekOf: mondayOf(d.dispatchDate),
        techs: d.techsOnSite,
        reasons,
        payTotal: Math.round(payTotal * 100) / 100,
        unitCount: dispatchUnits.length,
        unitsMissingPhotos: missing,
      });
    }
  }

  const out: UnfinalizedJob[] = [];
  for (const [jobId, b] of Array.from(buckets.entries())) {
    const job = jobById.get(jobId);
    if (!job) continue;

    // Audit flag: started-but-Draft, or required-by-schedule and never
    // started. Suppressed by a stamp unless work happened after it.
    const audit = auditByJob.get(jobId);
    let auditIncomplete =
      (audit ? audit.status === "Draft" : auditRequiredJobs.has(jobId)) &&
      b.latestActivity !== "";
    if (auditIncomplete && job.finalizedAt) {
      const stampDate = job.finalizedAt.slice(0, 10);
      if (b.latestActivity <= stampDate) auditIncomplete = false;
    }

    if (b.issues.length === 0 && !auditIncomplete) continue;

    const reasonSet = new Set<FinalizeReason>();
    for (const i of b.issues) for (const r of i.reasons) reasonSet.add(r);
    if (auditIncomplete) reasonSet.add("audit-incomplete");

    b.issues.sort((a, z) => z.date.localeCompare(a.date));
    out.push({
      jobId,
      customerName: job.customerName,
      siteAddress: job.siteAddress,
      latestDate: b.issues[0]?.date ?? b.latestActivity,
      reasons: Array.from(reasonSet),
      dispatches: b.issues,
      auditIncomplete,
      techs: Array.from(b.allTechs).sort(),
      finalizedAt: job.finalizedAt,
      finalizedBy: job.finalizedBy,
    });
  }

  out.sort((a, z) => z.latestDate.localeCompare(a.latestDate));

  const byReason: Record<FinalizeReason, number> = {
    "not-submitted": 0,
    "no-pay": 0,
    "missing-photos": 0,
    "audit-incomplete": 0,
  };
  let dispatchCount = 0;
  for (const j of out) {
    dispatchCount += j.dispatches.length;
    for (const r of j.reasons) byReason[r] += 1;
  }

  return {
    jobs: out,
    counts: { jobs: out.length, dispatches: dispatchCount, byReason },
  };
}
