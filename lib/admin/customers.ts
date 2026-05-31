import "server-only";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllUnits } from "@/lib/data/units";
import { listAllDispatches } from "@/lib/data/dispatches";
import type { Job, UnitServiced } from "@/lib/types";

export interface CustomerSummary {
  customerName: string;
  jobs: Job[];
  jobCount: number;
  unitCount: number;
  dispatchCount: number;
  firstActivityIso: string;
  lastActivityIso: string;
  techNames: string[];
  utilityTerritories: string[];
}

/**
 * Roll up the Jobs sheet into one entry per unique customerName.
 * Drive folders stay attached to each individual job; this view is
 * pure aggregation — no schema change required.
 */
export async function listCustomers(): Promise<CustomerSummary[]> {
  const [jobs, units, dispatches] = await Promise.all([
    listAllJobs(),
    listAllUnits(),
    listAllDispatches(),
  ]);

  const unitsByJob = new Map<string, UnitServiced[]>();
  for (const u of units) {
    if (u.deleted) continue;
    const arr = unitsByJob.get(u.jobId) ?? [];
    arr.push(u);
    unitsByJob.set(u.jobId, arr);
  }
  const dispatchesByJob = new Map<string, typeof dispatches>();
  for (const d of dispatches) {
    const arr = dispatchesByJob.get(d.jobId) ?? [];
    arr.push(d);
    dispatchesByJob.set(d.jobId, arr);
  }

  const byCustomer = new Map<string, CustomerSummary>();
  for (const job of jobs) {
    const name = (job.customerName || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let sum = byCustomer.get(key);
    if (!sum) {
      sum = {
        customerName: name,
        jobs: [],
        jobCount: 0,
        unitCount: 0,
        dispatchCount: 0,
        firstActivityIso: "",
        lastActivityIso: "",
        techNames: [],
        utilityTerritories: [],
      };
      byCustomer.set(key, sum);
    }
    sum.jobs.push(job);
    sum.jobCount += 1;

    const jobUnits = unitsByJob.get(job.jobId) ?? [];
    sum.unitCount += jobUnits.length;
    const jobDispatches = dispatchesByJob.get(job.jobId) ?? [];
    sum.dispatchCount += jobDispatches.length;
    for (const d of jobDispatches) {
      for (const t of d.techsOnSite) {
        if (!sum.techNames.includes(t)) sum.techNames.push(t);
      }
    }
    if (
      job.utilityTerritory &&
      !sum.utilityTerritories.includes(job.utilityTerritory)
    ) {
      sum.utilityTerritories.push(job.utilityTerritory);
    }
    const created = job.createdDate;
    if (created && (!sum.firstActivityIso || created < sum.firstActivityIso)) {
      sum.firstActivityIso = created;
    }
    const last = job.lastActivityDate || created;
    if (last && (!sum.lastActivityIso || last > sum.lastActivityIso)) {
      sum.lastActivityIso = last;
    }
  }

  const out = Array.from(byCustomer.values());
  // Most recent activity first.
  out.sort((a, b) =>
    b.lastActivityIso.localeCompare(a.lastActivityIso)
  );
  for (const c of out) {
    c.jobs.sort((a, b) => b.createdDate.localeCompare(a.createdDate));
    c.techNames.sort();
    c.utilityTerritories.sort();
  }
  return out;
}

export async function getCustomerDetail(
  customerName: string
): Promise<CustomerSummary | null> {
  const all = await listCustomers();
  const target = customerName.trim().toLowerCase();
  return (
    all.find((c) => c.customerName.toLowerCase() === target) ?? null
  );
}
