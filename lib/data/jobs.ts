import "server-only";
import { TABS, appendRow, findRowIndex, readTab, updateCell } from "@/lib/google/sheets";
import {
  createFolder,
  getRootFolderId,
  jobFolderName,
} from "@/lib/google/drive";
import { nextJobId } from "@/lib/id-generators";
import { ageInDays, nowIso } from "@/lib/utils";
import type { Job, UtilityTerritory } from "@/lib/types";

function rowToJob(row: string[]): Job {
  const driveFolderId = String(row[10] ?? "");
  return {
    jobId: String(row[0] ?? ""),
    createdDate: String(row[1] ?? ""),
    lastActivityDate: String(row[2] ?? ""),
    customerName: String(row[3] ?? ""),
    siteAddress: String(row[4] ?? ""),
    utilityTerritory: (row[5] as UtilityTerritory) || "BGE",
    status: (row[6] as Job["status"]) || "Active",
    selfSold: String(row[7] ?? "").toUpperCase() === "TRUE",
    soldBy: String(row[8] ?? ""),
    driveFolderUrl: driveFolderId
      ? `https://drive.google.com/drive/folders/${driveFolderId}`
      : "",
    driveFolderId,
    createdBy: String(row[11] ?? ""),
    notes: String(row[12] ?? ""),
  };
}

export async function listAllJobs(
  opts: { fresh?: boolean } = {}
): Promise<Job[]> {
  const rows = await readTab(TABS.jobs, opts);
  return rows.filter((r) => r[0]).map(rowToJob);
}

export async function listActiveJobs(): Promise<Job[]> {
  const all = await listAllJobs();
  return all
    .filter((j) => j.status === "Active")
    .filter((j) => ageInDays(j.lastActivityDate || j.createdDate) <= 7)
    .sort((a, b) => (b.lastActivityDate || "").localeCompare(a.lastActivityDate || ""));
}

/**
 * Active jobs visible to a specific tech. Admins see everything. Regular
 * techs see only jobs they're connected to: jobs they created, jobs
 * they're the seller on (self-sold), or jobs where they appear in any
 * dispatch's techsOnSite list.
 */
export async function listJobsForTech(opts: {
  techName: string;
  isAdmin: boolean;
}): Promise<Job[]> {
  const active = await listActiveJobs();
  if (opts.isAdmin) return active;
  if (!opts.techName) return [];

  // Defer the dispatches import to avoid a top-level circular import
  // between jobs.ts and dispatches.ts.
  const { listAllDispatches } = await import("@/lib/data/dispatches");
  const dispatches = await listAllDispatches();
  const jobIdsFromDispatches = new Set<string>();
  for (const d of dispatches) {
    if (d.techsOnSite.some((t) => t === opts.techName)) {
      jobIdsFromDispatches.add(d.jobId);
    }
  }

  return active.filter(
    (j) =>
      j.createdBy === opts.techName ||
      (j.selfSold && j.soldBy === opts.techName) ||
      jobIdsFromDispatches.has(j.jobId)
  );
}

/**
 * True if the tech is connected to this job (created it, sold it, or
 * was on a dispatch). Admins always pass.
 */
export async function techCanAccessJob(opts: {
  job: Job;
  techName: string;
  isAdmin: boolean;
}): Promise<boolean> {
  if (opts.isAdmin) return true;
  if (!opts.techName) return false;
  if (opts.job.createdBy === opts.techName) return true;
  if (opts.job.selfSold && opts.job.soldBy === opts.techName) return true;

  const { listAllDispatches } = await import("@/lib/data/dispatches");
  const dispatches = await listAllDispatches();
  return dispatches.some(
    (d) =>
      d.jobId === opts.job.jobId &&
      d.techsOnSite.some((t) => t === opts.techName)
  );
}

export async function getJob(
  jobId: string,
  opts: { fresh?: boolean } = {}
): Promise<Job | null> {
  const cached = await listAllJobs(opts);
  const hit = cached.find((j) => j.jobId === jobId);
  if (hit) return hit;
  // Self-heal across Vercel's per-process sheets cache. If we missed
  // on a cached read, the row may have been appended on a different
  // serverless instance and the local cache is stale — retry once
  // with a fresh sheet read before declaring not-found.
  if (!opts.fresh) {
    const fresh = await listAllJobs({ fresh: true });
    return fresh.find((j) => j.jobId === jobId) ?? null;
  }
  return null;
}

export async function createJob(opts: {
  customerName: string;
  siteAddress: string;
  utilityTerritory: UtilityTerritory;
  selfSold: boolean;
  soldBy: string;
  createdBy: string;
  notes?: string;
}): Promise<Job> {
  const jobId = await nextJobId();
  const created = new Date();
  const folderName = jobFolderName({
    customerName: opts.customerName,
    siteAddress: opts.siteAddress,
    createdDate: created,
  });
  const folder = await createFolder(folderName, getRootFolderId());

  const isoNow = nowIso();
  const hyperlink = `=HYPERLINK("${folder.url}", "Open folder")`;

  await appendRow(TABS.jobs, [
    jobId,
    isoNow,
    isoNow,
    opts.customerName,
    opts.siteAddress,
    opts.utilityTerritory,
    "Active",
    opts.selfSold ? "TRUE" : "FALSE",
    opts.selfSold ? opts.soldBy : "",
    hyperlink,
    folder.id,
    opts.createdBy,
    opts.notes ?? "",
  ]);

  return {
    jobId,
    createdDate: isoNow,
    lastActivityDate: isoNow,
    customerName: opts.customerName,
    siteAddress: opts.siteAddress,
    utilityTerritory: opts.utilityTerritory,
    status: "Active",
    selfSold: opts.selfSold,
    soldBy: opts.selfSold ? opts.soldBy : "",
    driveFolderUrl: folder.url,
    driveFolderId: folder.id,
    createdBy: opts.createdBy,
    notes: opts.notes ?? "",
  };
}

export async function bumpLastActivity(jobId: string): Promise<void> {
  const rowIndex = await findRowIndex(TABS.jobs, "A", jobId);
  if (!rowIndex) return;
  await updateCell(`${TABS.jobs}!C${rowIndex}`, nowIso());
}

export async function updateJob(opts: {
  jobId: string;
  customerName?: string;
  siteAddress?: string;
  utilityTerritory?: UtilityTerritory;
  status?: "Active" | "Closed";
  selfSold?: boolean;
  soldBy?: string;
  notes?: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.jobs, "A", opts.jobId);
  if (!rowIndex) throw new Error(`Job not found: ${opts.jobId}`);
  const updates: Promise<void>[] = [];
  if (opts.customerName !== undefined)
    updates.push(updateCell(`${TABS.jobs}!D${rowIndex}`, opts.customerName));
  if (opts.siteAddress !== undefined)
    updates.push(updateCell(`${TABS.jobs}!E${rowIndex}`, opts.siteAddress));
  if (opts.utilityTerritory !== undefined)
    updates.push(updateCell(`${TABS.jobs}!F${rowIndex}`, opts.utilityTerritory));
  if (opts.status !== undefined)
    updates.push(updateCell(`${TABS.jobs}!G${rowIndex}`, opts.status));
  if (opts.selfSold !== undefined)
    updates.push(updateCell(`${TABS.jobs}!H${rowIndex}`, opts.selfSold ? "TRUE" : "FALSE"));
  if (opts.soldBy !== undefined)
    updates.push(updateCell(`${TABS.jobs}!I${rowIndex}`, opts.soldBy));
  if (opts.notes !== undefined)
    updates.push(updateCell(`${TABS.jobs}!M${rowIndex}`, opts.notes));
  if (updates.length > 0) {
    await Promise.all(updates);
    await bumpLastActivity(opts.jobId);
  }
}
