import "server-only";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllUnits } from "@/lib/data/units";
import { listAllDispatches } from "@/lib/data/dispatches";
import { extractDriveFileId } from "@/lib/utils";
import type {
  Dispatch,
  Job,
  UnitServiced,
} from "@/lib/types";

// ─── Customer report shape ──────────────────────────────────────────
//
// Per-customer rollup that powers both the PDF and CSV admin exports.
// Built once per request from the canonical Jobs/Units/Dispatches
// reads so the two formats can never disagree.

export interface CustomerReportPhoto {
  fileId: string;
  url: string;
  slotLabel: string;
}

export interface CustomerReportUnit {
  unitId: string;
  unitNumberOnJob: number;
  unitType: string;
  label: string;
  make: string;
  model: string;
  serial: string;
  notes: string;
  loggedBy: string;
  loggedAt: string;
  photos: CustomerReportPhoto[];
  nameplateFileId: string;
}

export interface CustomerReportJob {
  job: Job;
  dispatches: Dispatch[];
  units: CustomerReportUnit[];
  totalPhotos: number;
  techNames: string[];
}

export interface CustomerReport {
  customerName: string;
  generatedAt: string;
  jobs: CustomerReportJob[];
  totals: {
    jobCount: number;
    unitCount: number;
    dispatchCount: number;
    photoCount: number;
  };
  techNames: string[];
  utilityTerritories: string[];
  firstActivityIso: string;
  lastActivityIso: string;
}

// Slot keys to read from a UnitServiced row, mapped to a friendlier
// label for the report. Keep in sync with library.ts label maps —
// duplicated rather than imported because customer reports don't
// care about per-unit-type label variations beyond "before/after/
// nameplate/filter".
const PHOTO_SLOTS: { key: keyof UnitServiced; label: string }[] = [
  { key: "pre1Url", label: "Before" },
  { key: "pre2Url", label: "Before" },
  { key: "pre3Url", label: "Before" },
  { key: "post1Url", label: "After" },
  { key: "post2Url", label: "After" },
  { key: "post3Url", label: "After" },
  { key: "nameplateUrl", label: "Nameplate" },
  { key: "filterUrl", label: "Filter" },
  { key: "inPreUrl", label: "Indoor before" },
  { key: "inPostUrl", label: "Indoor after" },
  { key: "inNameplateUrl", label: "Indoor nameplate" },
];

function photosForUnit(u: UnitServiced): CustomerReportPhoto[] {
  const out: CustomerReportPhoto[] = [];
  for (const slot of PHOTO_SLOTS) {
    const url = String((u as unknown as Record<string, string>)[slot.key as string] ?? "");
    if (!url) continue;
    const fileId = extractDriveFileId(url);
    if (!fileId) continue;
    out.push({ fileId, url, slotLabel: slot.label });
  }
  const csv = String(u.additionalUrls ?? "");
  if (csv) {
    for (const raw of csv.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean)) {
      const fileId = extractDriveFileId(raw);
      if (!fileId) continue;
      out.push({ fileId, url: raw, slotLabel: "Additional" });
    }
  }
  return out;
}

function nameplateFor(u: UnitServiced): string {
  return (
    extractDriveFileId(u.nameplateUrl || "") ||
    extractDriveFileId(u.inNameplateUrl || "") ||
    ""
  );
}

/**
 * Build a per-customer report. Pulls live data from Sheets every
 * call — small enough to be cheap, and the export is meant to be
 * authoritative as-of right now. Returns null when the customer name
 * doesn't match any Active job.
 */
export async function buildCustomerReport(
  customerName: string
): Promise<CustomerReport | null> {
  const target = customerName.trim().toLowerCase();
  if (!target) return null;

  const [jobs, units, dispatches] = await Promise.all([
    listAllJobs(),
    listAllUnits(),
    listAllDispatches(),
  ]);

  const customerJobs = jobs
    .filter((j) => j.status === "Active")
    .filter((j) => j.customerName.trim().toLowerCase() === target);
  if (customerJobs.length === 0) return null;

  // Canonical display name — first job's spelling wins so capitalization
  // matches what the admin sees in the index.
  const canonicalName = customerJobs[0].customerName;

  const unitsByJob = new Map<string, UnitServiced[]>();
  for (const u of units) {
    if (u.deleted) continue;
    const arr = unitsByJob.get(u.jobId) ?? [];
    arr.push(u);
    unitsByJob.set(u.jobId, arr);
  }
  const dispatchesByJob = new Map<string, Dispatch[]>();
  for (const d of dispatches) {
    const arr = dispatchesByJob.get(d.jobId) ?? [];
    arr.push(d);
    dispatchesByJob.set(d.jobId, arr);
  }

  const reportJobs: CustomerReportJob[] = [];
  let unitCount = 0;
  let dispatchCount = 0;
  let photoCount = 0;
  const techNames = new Set<string>();
  const utilityTerritories = new Set<string>();
  let firstIso = "";
  let lastIso = "";

  // Most recent jobs first.
  customerJobs.sort((a, b) => b.createdDate.localeCompare(a.createdDate));

  for (const job of customerJobs) {
    if (job.utilityTerritory) utilityTerritories.add(job.utilityTerritory);
    if (job.createdDate) {
      if (!firstIso || job.createdDate < firstIso) firstIso = job.createdDate;
    }
    const lastActivity = job.lastActivityDate || job.createdDate;
    if (lastActivity) {
      if (!lastIso || lastActivity > lastIso) lastIso = lastActivity;
    }

    const jobUnits = (unitsByJob.get(job.jobId) ?? []).slice();
    jobUnits.sort((a, b) => a.unitNumberOnJob - b.unitNumberOnJob);
    const jobDispatches = (dispatchesByJob.get(job.jobId) ?? []).slice();
    jobDispatches.sort((a, b) =>
      a.dispatchDate.localeCompare(b.dispatchDate)
    );
    dispatchCount += jobDispatches.length;
    for (const d of jobDispatches) {
      for (const t of d.techsOnSite) techNames.add(t);
    }

    const reportUnits: CustomerReportUnit[] = [];
    let jobPhotoCount = 0;
    for (const u of jobUnits) {
      const ps = photosForUnit(u);
      jobPhotoCount += ps.length;
      reportUnits.push({
        unitId: u.unitId,
        unitNumberOnJob: u.unitNumberOnJob,
        unitType: u.unitType,
        label: u.label || "",
        make: u.make || "",
        model: u.model || "",
        serial: u.serial || "",
        notes: u.notes || "",
        loggedBy: u.loggedBy || "",
        loggedAt: u.loggedAt || "",
        photos: ps,
        nameplateFileId: nameplateFor(u),
      });
    }
    unitCount += reportUnits.length;
    photoCount += jobPhotoCount;

    reportJobs.push({
      job,
      dispatches: jobDispatches,
      units: reportUnits,
      totalPhotos: jobPhotoCount,
      techNames: Array.from(
        new Set(jobDispatches.flatMap((d) => d.techsOnSite))
      ).sort(),
    });
  }

  return {
    customerName: canonicalName,
    generatedAt: new Date().toISOString(),
    jobs: reportJobs,
    totals: {
      jobCount: reportJobs.length,
      unitCount,
      dispatchCount,
      photoCount,
    },
    techNames: Array.from(techNames).sort(),
    utilityTerritories: Array.from(utilityTerritories).sort(),
    firstActivityIso: firstIso,
    lastActivityIso: lastIso,
  };
}

// ─── CSV serializer ──────────────────────────────────────────────────

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Excel-safe: wrap in quotes if there's anything that would
  // otherwise break a column. Doubled quotes inside the cell escape.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCustomerReportCsv(report: CustomerReport): string {
  const headers = [
    "Customer",
    "Job ID",
    "Site Address",
    "Utility",
    "Status",
    "Job Created",
    "Job Last Activity",
    "Dispatches",
    "Unit Number",
    "Unit Type",
    "Unit Label",
    "Make",
    "Model",
    "Serial",
    "Notes",
    "Photo Count",
    "Logged By",
    "Logged At",
  ];
  const rows: string[] = [headers.map(csvCell).join(",")];
  for (const rj of report.jobs) {
    if (rj.units.length === 0) {
      // Job with no units still gets one row so the export doesn't
      // silently drop them — useful for sanity-checking missing data.
      rows.push(
        [
          report.customerName,
          rj.job.jobId,
          rj.job.siteAddress,
          rj.job.utilityTerritory,
          rj.job.status,
          rj.job.createdDate,
          rj.job.lastActivityDate,
          rj.dispatches.length,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          0,
          "",
          "",
        ]
          .map(csvCell)
          .join(",")
      );
      continue;
    }
    for (const u of rj.units) {
      rows.push(
        [
          report.customerName,
          rj.job.jobId,
          rj.job.siteAddress,
          rj.job.utilityTerritory,
          rj.job.status,
          rj.job.createdDate,
          rj.job.lastActivityDate,
          rj.dispatches.length,
          u.unitNumberOnJob,
          u.unitType,
          u.label,
          u.make,
          u.model,
          u.serial,
          u.notes,
          u.photos.length,
          u.loggedBy,
          u.loggedAt,
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }
  return rows.join("\r\n") + "\r\n";
}
