import "server-only";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllUnits } from "@/lib/data/units";
import { listAllDispatches } from "@/lib/data/dispatches";
import { extractDriveFileId } from "@/lib/utils";
import type { Job, UnitServiced } from "@/lib/types";

// Photo URL slot definitions — same layout the PDF generator uses,
// just expressed as (column, label) tuples so the library UI can
// caption each thumbnail consistently. Pulled into one place so a
// future "Side B" addition stays in sync everywhere.
const PHOTO_SLOT_LABELS: Array<{
  key: keyof UnitServiced;
  label: string;
}> = [
  { key: "nameplateUrl", label: "Nameplate" },
  { key: "pre1Url", label: "Before · 1" },
  { key: "pre2Url", label: "Before · 2" },
  { key: "pre3Url", label: "Before · 3" },
  { key: "post1Url", label: "After · 1" },
  { key: "post2Url", label: "After · 2" },
  { key: "post3Url", label: "After · 3" },
  { key: "filterUrl", label: "Filter" },
  { key: "inNameplateUrl", label: "Air handler nameplate" },
  { key: "inPreUrl", label: "Air handler · before" },
  { key: "inPostUrl", label: "Air handler · after" },
];

export interface LibraryPhoto {
  fileId: string;
  url: string;
  slotLabel: string;
}

export interface LibraryUnit {
  unitId: string;
  unitNumberOnJob: number;
  unitType: string;
  label: string;
  make: string;
  model: string;
  loggedBy: string;
  loggedAt: string;
  photos: LibraryPhoto[];
  additionalPhotoCount: number;
}

export interface LibraryJobCluster {
  job: Job;
  units: LibraryUnit[];
  totalPhotos: number;
  dispatchCount: number;
  lastActivityIso: string;
  techNames: string[];
}

export interface LibrarySnapshot {
  clusters: LibraryJobCluster[];
  totalPhotos: number;
  totalUnits: number;
  totalJobs: number;
  techList: string[];
  unitTypeList: string[];
}

function photosForUnit(u: UnitServiced): LibraryPhoto[] {
  const photos: LibraryPhoto[] = [];
  for (const { key, label } of PHOTO_SLOT_LABELS) {
    const url = String(u[key] ?? "");
    if (!url) continue;
    const fileId = extractDriveFileId(url);
    if (!fileId) continue;
    photos.push({ fileId, url, slotLabel: label });
  }
  // Additional photos column is a CSV of URLs.
  const csv = String(u.additionalUrls ?? "");
  if (csv) {
    const urls = csv
      .split(/[,\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const url of urls) {
      const fileId = extractDriveFileId(url);
      if (!fileId) continue;
      photos.push({ fileId, url, slotLabel: "Additional" });
    }
  }
  return photos;
}

function additionalPhotoCount(u: UnitServiced): number {
  const csv = String(u.additionalUrls ?? "");
  if (!csv) return 0;
  return csv
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

/**
 * Snapshot the entire library in one shot: every job that has at
 * least one photographed unit, sorted by most-recent-activity. Built
 * once per page request server-side; the page component slices and
 * filters it client-side from there.
 */
export async function buildLibrarySnapshot(): Promise<LibrarySnapshot> {
  const [jobs, units, dispatches] = await Promise.all([
    listAllJobs(),
    listAllUnits(),
    listAllDispatches(),
  ]);

  // Pre-index units by jobId for O(1) lookup
  const unitsByJob = new Map<string, UnitServiced[]>();
  for (const u of units) {
    if (u.deleted) continue;
    const arr = unitsByJob.get(u.jobId) ?? [];
    arr.push(u);
    unitsByJob.set(u.jobId, arr);
  }

  const dispatchesByJob = new Map<string, number>();
  const techsByJob = new Map<string, Set<string>>();
  for (const d of dispatches) {
    dispatchesByJob.set(d.jobId, (dispatchesByJob.get(d.jobId) ?? 0) + 1);
    const set = techsByJob.get(d.jobId) ?? new Set<string>();
    for (const t of d.techsOnSite) set.add(t);
    techsByJob.set(d.jobId, set);
  }

  const clusters: LibraryJobCluster[] = [];
  const techList = new Set<string>();
  const unitTypeList = new Set<string>();

  for (const job of jobs) {
    const jobUnits = unitsByJob.get(job.jobId) ?? [];
    if (jobUnits.length === 0) continue;

    const libUnits: LibraryUnit[] = [];
    let total = 0;
    let last = "";
    for (const u of jobUnits) {
      const ps = photosForUnit(u);
      const extras = additionalPhotoCount(u);
      total += ps.length;
      unitTypeList.add(u.unitType);
      if (u.loggedAt > last) last = u.loggedAt;
      libUnits.push({
        unitId: u.unitId,
        unitNumberOnJob: u.unitNumberOnJob,
        unitType: u.unitType,
        label: u.label,
        make: u.make,
        model: u.model,
        loggedBy: u.loggedBy,
        loggedAt: u.loggedAt,
        photos: ps,
        additionalPhotoCount: extras,
      });
    }

    if (total === 0) continue;

    // Sort units within a job by unit number for predictable display.
    libUnits.sort((a, b) => a.unitNumberOnJob - b.unitNumberOnJob);

    const techs = Array.from(techsByJob.get(job.jobId) ?? new Set<string>());
    for (const t of techs) techList.add(t);

    clusters.push({
      job,
      units: libUnits,
      totalPhotos: total,
      dispatchCount: dispatchesByJob.get(job.jobId) ?? 0,
      lastActivityIso: last || job.lastActivityDate || job.createdDate,
      techNames: techs,
    });
  }

  // Most recent first.
  clusters.sort((a, b) =>
    b.lastActivityIso.localeCompare(a.lastActivityIso)
  );

  return {
    clusters,
    totalPhotos: clusters.reduce((s, c) => s + c.totalPhotos, 0),
    totalUnits: clusters.reduce((s, c) => s + c.units.length, 0),
    totalJobs: clusters.length,
    techList: Array.from(techList).sort(),
    unitTypeList: Array.from(unitTypeList).sort(),
  };
}
