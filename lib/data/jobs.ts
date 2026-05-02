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

export async function listAllJobs(): Promise<Job[]> {
  const rows = await readTab(TABS.jobs);
  return rows.filter((r) => r[0]).map(rowToJob);
}

export async function listActiveJobs(): Promise<Job[]> {
  const all = await listAllJobs();
  return all
    .filter((j) => j.status === "Active")
    .filter((j) => ageInDays(j.lastActivityDate || j.createdDate) <= 7)
    .sort((a, b) => (b.lastActivityDate || "").localeCompare(a.lastActivityDate || ""));
}

export async function getJob(jobId: string): Promise<Job | null> {
  const all = await listAllJobs();
  return all.find((j) => j.jobId === jobId) ?? null;
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
