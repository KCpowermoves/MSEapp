import "server-only";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllUnits } from "@/lib/data/units";
import { listAllDispatches } from "@/lib/data/dispatches";
import { extractDriveFileId } from "@/lib/utils";
import type { Job, UnitServiced } from "@/lib/types";

// Photo URL slot definitions — the same column letter (G/H/I/J/...)
// means different things depending on the unit type the row was
// captured with. PHOTO_SLOT_KEYS lists every column we might pull a
// URL from; LABELS_BY_TYPE maps (unitType, columnKey) → human label.
//
// For unit types not explicitly mapped (legacy "Split System" rows,
// future types), we fall through to a sensible default that doesn't
// invent a "· 1" suffix when there's only a single photo of that
// kind.
const PHOTO_SLOT_KEYS: (keyof UnitServiced)[] = [
  "nameplateUrl",
  "pre1Url",
  "pre2Url",
  "pre3Url",
  "post1Url",
  "post2Url",
  "post3Url",
  "filterUrl",
  "inNameplateUrl",
  "inPreUrl",
  "inPostUrl",
];

type LabelMap = Partial<Record<keyof UnitServiced, string>>;

const LABELS_DEFAULT: LabelMap = {
  nameplateUrl: "Nameplate",
  pre1Url: "Before",
  pre2Url: "Before · 2",
  pre3Url: "Before · 3",
  post1Url: "After",
  post2Url: "After · 2",
  post3Url: "After · 3",
  filterUrl: "Filter",
  inNameplateUrl: "Air handler nameplate",
  inPreUrl: "Air handler · before",
  inPostUrl: "Air handler · after",
};

// PTAC / Ductless: a single Before + a single After + nameplate.
// Drop the "· N" suffix entirely.
const LABELS_PTAC: LabelMap = {
  nameplateUrl: "Nameplate",
  pre1Url: "Before",
  post1Url: "After",
  filterUrl: "Filter",
};

// RTU: pre1/pre2 are the two coils' BEFORE photos; post1/post2 are
// the AFTERs; pre3 is filter-before; post3 is filter-after.
const LABELS_RTU: LabelMap = {
  nameplateUrl: "Nameplate",
  pre1Url: "Coil 1 · before",
  pre2Url: "Coil 2 · before",
  pre3Url: "Filter · before",
  post1Url: "Coil 1 · after",
  post2Url: "Coil 2 · after",
  post3Url: "Filter · after",
};

// Outdoor Split System: pre1/2/3 = three sides BEFORE; post1/2/3 =
// three sides AFTER; one filter; one outdoor nameplate.
const LABELS_OUTDOOR_SPLIT: LabelMap = {
  nameplateUrl: "Outdoor nameplate",
  pre1Url: "Side 1 · before",
  pre2Url: "Side 2 · before",
  pre3Url: "Side 3 · before",
  post1Url: "Side 1 · after",
  post2Url: "Side 2 · after",
  post3Url: "Side 3 · after",
  filterUrl: "Filter",
};

// Indoor Split System (air handler): air handler before + after +
// nameplate, in different columns (V/W/X) than the outdoor unit.
const LABELS_INDOOR_SPLIT: LabelMap = {
  inNameplateUrl: "Air handler nameplate",
  inPreUrl: "Air handler · before",
  inPostUrl: "Air handler · after",
  filterUrl: "Filter",
};

function labelFor(unitType: string, key: keyof UnitServiced): string {
  let map: LabelMap = LABELS_DEFAULT;
  if (unitType === "PTAC / Ductless") map = LABELS_PTAC;
  else if (unitType === "RTU-S" || unitType === "RTU-M" || unitType === "RTU-L")
    map = LABELS_RTU;
  else if (unitType === "Outdoor Split System") map = LABELS_OUTDOOR_SPLIT;
  else if (unitType === "Indoor Split System") map = LABELS_INDOOR_SPLIT;
  return map[key] ?? LABELS_DEFAULT[key] ?? "Photo";
}

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
  for (const key of PHOTO_SLOT_KEYS) {
    const url = String(u[key] ?? "");
    if (!url) continue;
    const fileId = extractDriveFileId(url);
    if (!fileId) continue;
    photos.push({ fileId, url, slotLabel: labelFor(u.unitType, key) });
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
    // Closed jobs are soft-deleted — keep them out of the library view.
    if (job.status === "Closed") continue;
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
