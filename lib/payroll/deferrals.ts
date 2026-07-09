import "server-only";
import { loadAllTechs } from "@/lib/auth";
import { listAllAttributions } from "@/lib/data/pay-attribution";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllPayrollPeriods } from "@/lib/data/payroll-periods";
import { listAllPayrollAdjustments } from "@/lib/data/payroll-adjustments";
import { todayIsoEastern } from "@/lib/utils";
import type { PayPlanType, PayrollPeriod } from "@/lib/types";

/**
 * Deferred-pay ledger.
 *
 * The split-pay comp model: on a weekly (Mon–Sun) period, each tech's
 * Thursday payment holds back a deferred portion that releases when the
 * CLIENT pays MSE for the job, after manual admin approval:
 *
 *   fifty-fifty  → defers 50% of each job's earnings that week
 *   full-upfront → defers nothing (Dante, Jamal)
 *   draw         → Thursday pays a flat weekly draw (Ivan's $1,000);
 *                  the deferred pool = earned − draw, spread across the
 *                  week's jobs proportionally. Weeks under the draw
 *                  create a SHORTFALL the admin nets against future
 *                  releases (surfaced, never auto-deducted).
 *
 * Releases are written as "deferred_release" adjustments into the
 * weekly period that covers the approval date — so they ride the
 * normal Thursday report, PDF, and audit trail. Each release note
 * carries a `[job:JOB-…]` marker; that marker is the join key this
 * ledger uses to know what's already been released.
 */

export const JOB_MARKER = (jobId: string) => `[job:${jobId}]`;

// Composite-map key delimiter — tech names contain spaces, so keys
// join on the ASCII unit separator instead.
const SEP = "";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DeferralEntry {
  techName: string;
  jobId: string;
  customerName: string;
  /** Sum the tech earned on this job inside weekly periods. */
  earned: number;
  /** Deferred portion owed for this job (plan-dependent). */
  deferredOwed: number;
  /** Already released via deferred_release adjustments. */
  released: number;
  /** deferredOwed − released (floored at 0). */
  remaining: number;
  clientPaidAt: string;
  /** Weeks contributing to this entry, for display. */
  weeks: string[];
}

export interface TechShortfall {
  techName: string;
  /** Sum of (draw − earned) across weekly periods where earned < draw.
   *  Positive = MSE advanced more than earned; net it against future
   *  releases (surfaced to the admin, never auto-deducted). */
  amount: number;
  weeks: string[];
}

export interface DeferralLedger {
  /** One row per tech × job with any deferred pay. */
  entries: DeferralEntry[];
  /** Ivan-style draw shortfalls that need netting. */
  shortfalls: TechShortfall[];
  totals: {
    readyToRelease: number;   // client paid, not yet released
    waitingOnClients: number; // client not paid yet
    released: number;
  };
}

/** Weekly deferral for one tech-week. Positive = held back. For draw
 *  plans a NEGATIVE value means the draw exceeded earnings (shortfall
 *  — Thursday still pays the full draw). */
export function weeklyDeferralAmount(
  plan: { planType: PayPlanType; drawAmount: number },
  earned: number
): number {
  if (plan.planType === "full-upfront") return 0;
  if (plan.planType === "draw") return round2(earned - plan.drawAmount);
  return round2(earned * 0.5);
}

export async function computeDeferralLedger(): Promise<DeferralLedger> {
  const [techs, attributions, dispatches, jobs, periods, adjustments] =
    await Promise.all([
      loadAllTechs(),
      listAllAttributions(),
      listAllDispatches(),
      listAllJobs(),
      listAllPayrollPeriods(),
      listAllPayrollAdjustments(),
    ]);

  const planByName = new Map(
    techs.map((t) => [t.name, { planType: t.planType, drawAmount: t.drawAmount }])
  );
  const dispatchById = new Map(dispatches.map((d) => [d.dispatchId, d]));
  const jobById = new Map(jobs.map((j) => [j.jobId, j]));
  const weeklyPeriods = periods.filter((p) => p.periodType === "weekly");

  function weekFor(dateIso: string): PayrollPeriod | undefined {
    return weeklyPeriods.find(
      (p) => p.startDate <= dateIso && dateIso <= p.endDate
    );
  }

  // ── Earned per (tech, week, job) inside weekly periods ────────────
  const cell = new Map<string, number>();
  const weekTechTotals = new Map<string, number>();
  for (const a of attributions) {
    const week = weekFor(a.date);
    if (!week) continue;
    const plan = planByName.get(a.techName);
    if (!plan || plan.planType === "full-upfront") continue;
    const dispatch = dispatchById.get(a.dispatchId);
    const jobId = dispatch?.jobId ?? "";
    if (!jobId) continue;
    const k = [a.techName, week.periodId, jobId].join(SEP);
    cell.set(k, (cell.get(k) ?? 0) + a.amount);
    const wk = [a.techName, week.periodId].join(SEP);
    weekTechTotals.set(wk, (weekTechTotals.get(wk) ?? 0) + a.amount);
  }

  // ── Deferred owed per (tech, job), cents-corrected per week ───────
  const owed = new Map<string, { earned: number; deferred: number; weeks: Set<string> }>();
  const shortfallByTech = new Map<string, { amount: number; weeks: Set<string> }>();

  // Group cells by tech-week so proportional draw math sums exactly.
  const byTechWeek = new Map<string, Array<{ jobId: string; earned: number }>>();
  for (const [k, earned] of Array.from(cell.entries())) {
    const [tech, periodId, jobId] = k.split(SEP);
    const wk = [tech, periodId].join(SEP);
    const arr = byTechWeek.get(wk) ?? [];
    arr.push({ jobId, earned });
    byTechWeek.set(wk, arr);
  }

  for (const [wk, jobsInWeek] of Array.from(byTechWeek.entries())) {
    const [tech, periodId] = wk.split(SEP);
    const plan = planByName.get(tech)!;
    const weekEarned = weekTechTotals.get(wk) ?? 0;
    const weekLabel =
      weeklyPeriods.find((p) => p.periodId === periodId)?.label ?? periodId;

    let perJob: Array<{ jobId: string; earned: number; deferred: number }>;
    if (plan.planType === "draw") {
      const pool = Math.max(0, round2(weekEarned - plan.drawAmount));
      if (weekEarned < plan.drawAmount) {
        const sf = shortfallByTech.get(tech) ?? { amount: 0, weeks: new Set<string>() };
        sf.amount = round2(sf.amount + (plan.drawAmount - weekEarned));
        sf.weeks.add(weekLabel);
        shortfallByTech.set(tech, sf);
      }
      // Proportional split of the pool across the week's jobs, with
      // the rounding remainder absorbed by the largest job so the
      // slices always sum exactly to the pool.
      perJob = jobsInWeek.map((j) => ({
        ...j,
        deferred:
          weekEarned > 0 ? round2((j.earned / weekEarned) * pool) : 0,
      }));
      const drift = round2(pool - perJob.reduce((s, j) => s + j.deferred, 0));
      if (Math.abs(drift) >= 0.01 && perJob.length > 0) {
        const biggest = perJob.reduce((a, b) => (b.earned > a.earned ? b : a));
        biggest.deferred = round2(biggest.deferred + drift);
      }
    } else {
      // fifty-fifty
      perJob = jobsInWeek.map((j) => ({ ...j, deferred: round2(j.earned / 2) }));
    }

    for (const j of perJob) {
      const key = [tech, j.jobId].join(SEP);
      const entry = owed.get(key) ?? {
        earned: 0,
        deferred: 0,
        weeks: new Set<string>(),
      };
      entry.earned = round2(entry.earned + j.earned);
      entry.deferred = round2(entry.deferred + j.deferred);
      entry.weeks.add(weekLabel);
      owed.set(key, entry);
    }
  }

  // Zero-work weeks for draw techs: the Thursday report still pays the
  // full draw (guarantee), so the entire draw is a shortfall to net
  // against future releases. Only completed weeks count — a week still
  // in progress isn't a shortfall yet.
  const todayEt = todayIsoEastern();
  for (const p of weeklyPeriods) {
    if (p.endDate >= todayEt) continue;
    for (const t of techs) {
      if (!t.active || t.planType !== "draw" || t.drawAmount <= 0) continue;
      const wk = [t.name, p.periodId].join(SEP);
      if (weekTechTotals.has(wk)) continue;
      const sf = shortfallByTech.get(t.name) ?? {
        amount: 0,
        weeks: new Set<string>(),
      };
      sf.amount = round2(sf.amount + t.drawAmount);
      sf.weeks.add(p.label || p.periodId);
      shortfallByTech.set(t.name, sf);
    }
  }

  // ── Released so far (deferred_release adjustments, any period) ────
  const released = new Map<string, number>();
  for (const a of adjustments) {
    if (a.type !== "deferred_release") continue;
    if ((a.note ?? "").trim().toUpperCase().startsWith("VOIDED")) continue;
    const m = (a.note ?? "").match(/\[job:([^\]]+)\]/);
    if (!m) continue;
    const key = [a.techName, m[1]].join(SEP);
    released.set(key, round2((released.get(key) ?? 0) + a.amount));
  }

  // ── Assemble ledger ───────────────────────────────────────────────
  const entries: DeferralEntry[] = [];
  let readyToRelease = 0;
  let waitingOnClients = 0;
  let totalReleased = 0;
  for (const [key, o] of Array.from(owed.entries())) {
    const [techName, jobId] = key.split(SEP);
    const rel = released.get(key) ?? 0;
    const remaining = Math.max(0, round2(o.deferred - rel));
    totalReleased += rel;
    const job = jobById.get(jobId);
    const clientPaidAt = job?.clientPaidAt ?? "";
    if (remaining > 0) {
      if (clientPaidAt) readyToRelease += remaining;
      else waitingOnClients += remaining;
    }
    entries.push({
      techName,
      jobId,
      customerName: job?.customerName ?? jobId,
      earned: o.earned,
      deferredOwed: o.deferred,
      released: rel,
      remaining,
      clientPaidAt,
      weeks: Array.from(o.weeks),
    });
  }
  // Orphaned releases: a deferred_release exists but its attribution
  // was later deleted (dispatch unfinalized after release). Without
  // this pass the released money would drop out of the totals — keep
  // it visible so the books always account for every dollar out.
  for (const [key, rel] of Array.from(released.entries())) {
    if (owed.has(key)) continue;
    const [techName, jobId] = key.split(SEP);
    totalReleased += rel;
    const job = jobById.get(jobId);
    entries.push({
      techName,
      jobId,
      customerName: `${job?.customerName ?? jobId} (attribution removed after release)`,
      earned: 0,
      deferredOwed: 0,
      released: rel,
      remaining: 0,
      clientPaidAt: job?.clientPaidAt ?? "",
      weeks: [],
    });
  }

  entries.sort(
    (a, b) =>
      (b.clientPaidAt ? 1 : 0) - (a.clientPaidAt ? 1 : 0) ||
      b.remaining - a.remaining
  );

  const shortfalls: TechShortfall[] = Array.from(shortfallByTech.entries()).map(
    ([techName, sf]) => ({
      techName,
      amount: sf.amount,
      weeks: Array.from(sf.weeks),
    })
  );

  return {
    entries,
    shortfalls,
    totals: {
      readyToRelease: round2(readyToRelease),
      waitingOnClients: round2(waitingOnClients),
      released: round2(totalReleased),
    },
  };
}
