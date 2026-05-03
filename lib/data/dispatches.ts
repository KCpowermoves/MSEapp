import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextDispatchId } from "@/lib/id-generators";
import { bumpLastActivity, getJob } from "@/lib/data/jobs";
import {
  listUnitsForDispatch,
  unitHasAllRequiredPhotos,
} from "@/lib/data/units";
import { listServicesForDispatch } from "@/lib/data/services";
import { writeAttributions } from "@/lib/data/pay-attribution";
import { nowIso, todayIsoDate } from "@/lib/utils";
import {
  DAILY_DRIVING_STIPEND,
  TRAVEL_DISPATCH_BONUS,
  isTravelTerritory,
} from "@/lib/pay-rates";
import type { CrewSplit, Dispatch } from "@/lib/types";

// Sheets may return dates as ISO strings, US-locale strings, or serial
// numbers (days since 1899-12-30) depending on cell formatting and the
// valueInputOption used to write them. Normalize all three to YYYY-MM-DD.
function normalizeDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number") return serialToIso(raw);
  const s = String(raw).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 25000 && n < 100000) return serialToIso(n);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return s;
}

function serialToIso(serial: number): string {
  // Sheets epoch: 1899-12-30 (preserves the Lotus 1-2-3 leap-year bug)
  const ms = (serial - 25569) * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function rowToDispatch(row: string[]): Dispatch {
  const techsCsv = String(row[3] ?? "");
  return {
    dispatchId: String(row[0] ?? ""),
    jobId: String(row[1] ?? ""),
    dispatchDate: normalizeDate(row[2]),
    techsOnSite: techsCsv ? techsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [],
    crewSplit: (row[4] as CrewSplit) || "Solo",
    driver: String(row[5] ?? ""),
    dailyDrivingStipend: Number(row[6] ?? 0),
    travelDispatchBonus: Number(row[7] ?? 0),
    photosComplete: String(row[8] ?? "").toUpperCase() === "TRUE",
    submittedAt: String(row[9] ?? ""),
    signatureUrl: String(row[10] ?? ""),
    signedByName: String(row[11] ?? ""),
    reportPdfUrl: String(row[12] ?? ""),
    customerEmail: String(row[13] ?? ""),
    customerRating: Number(row[14] ?? 0) || 0,
    customerFeedback: String(row[15] ?? ""),
  };
}

export async function listAllDispatches(): Promise<Dispatch[]> {
  const rows = await readTab(TABS.dispatches);
  return rows.filter((r) => r[0]).map(rowToDispatch);
}

export async function getDispatch(
  dispatchId: string
): Promise<Dispatch | null> {
  const all = await listAllDispatches();
  return all.find((d) => d.dispatchId === dispatchId) ?? null;
}

export async function findDraftDispatch(
  jobId: string,
  date: string
): Promise<Dispatch | null> {
  const all = await listAllDispatches();
  return (
    all.find(
      (d) => d.jobId === jobId && d.dispatchDate === date && !d.submittedAt
    ) ?? null
  );
}

/** Most recent dispatch on a job for the given date, regardless of
 *  whether it's been submitted. Used by the post-submit customer
 *  confirmation + feedback screens, which run AFTER the dispatch is
 *  finalized and therefore can't use findDraftDispatch. */
export async function findDispatchByDate(
  jobId: string,
  date: string
): Promise<Dispatch | null> {
  const all = await listAllDispatches();
  const matches = all.filter(
    (d) => d.jobId === jobId && d.dispatchDate === date
  );
  if (matches.length === 0) return null;
  // Prefer the latest submitted one, falling back to any match.
  matches.sort((a, b) =>
    (b.submittedAt || "").localeCompare(a.submittedAt || "")
  );
  return matches[0];
}

export async function ensureDraftDispatch(
  jobId: string
): Promise<Dispatch> {
  const today = todayIsoDate();
  const existing = await findDraftDispatch(jobId, today);
  if (existing) return existing;

  const dispatchId = await nextDispatchId();
  await appendRow(
    TABS.dispatches,
    [dispatchId, jobId, today, "", "Solo", "", 0, 0, "FALSE", "", "", "", "", "", 0, ""],
    "RAW"
  );
  await bumpLastActivity(jobId);
  return {
    dispatchId,
    jobId,
    dispatchDate: today,
    techsOnSite: [],
    crewSplit: "Solo",
    driver: "",
    dailyDrivingStipend: 0,
    travelDispatchBonus: 0,
    photosComplete: false,
    submittedAt: "",
    signatureUrl: "",
    signedByName: "",
    reportPdfUrl: "",
    customerEmail: "",
    customerRating: 0,
    customerFeedback: "",
  };
}


export async function submitDispatch(opts: {
  dispatchId: string;
  techsOnSite: string[];
  crewSplit: CrewSplit;
  driver: string;
}): Promise<Dispatch> {
  const dispatch = await getDispatch(opts.dispatchId);
  if (!dispatch) throw new Error(`Dispatch not found: ${opts.dispatchId}`);
  const job = await getJob(dispatch.jobId);
  if (!job) throw new Error(`Job not found: ${dispatch.jobId}`);

  const units = await listUnitsForDispatch(dispatch.dispatchId);
  const services = await listServicesForDispatch(dispatch.dispatchId);

  const photosComplete =
    units.length > 0 && units.every((u) => unitHasAllRequiredPhotos(u));

  const dailyStipend = photosComplete ? DAILY_DRIVING_STIPEND : 0;
  const travelBonus =
    isTravelTerritory(job.utilityTerritory) && opts.driver
      ? TRAVEL_DISPATCH_BONUS
      : 0;

  const rowIndex = await findRowIndex(
    TABS.dispatches,
    "A",
    opts.dispatchId
  );
  if (!rowIndex) throw new Error("Dispatch row missing");

  const techsCsv = opts.techsOnSite.join(", ");
  await updateCell(`${TABS.dispatches}!D${rowIndex}`, techsCsv, "RAW");
  await updateCell(`${TABS.dispatches}!E${rowIndex}`, opts.crewSplit, "RAW");
  await updateCell(`${TABS.dispatches}!F${rowIndex}`, opts.driver, "RAW");
  await updateCell(`${TABS.dispatches}!G${rowIndex}`, dailyStipend, "RAW");
  await updateCell(`${TABS.dispatches}!H${rowIndex}`, travelBonus, "RAW");
  await updateCell(
    `${TABS.dispatches}!I${rowIndex}`,
    photosComplete ? "TRUE" : "FALSE",
    "RAW"
  );
  await updateCell(`${TABS.dispatches}!J${rowIndex}`, nowIso(), "RAW");

  await writeAttributions({
    dispatch: { ...dispatch, ...opts, dailyDrivingStipend: dailyStipend, travelDispatchBonus: travelBonus, photosComplete },
    job,
    units,
    services,
  });

  await bumpLastActivity(dispatch.jobId);

  return {
    ...dispatch,
    techsOnSite: opts.techsOnSite,
    crewSplit: opts.crewSplit,
    driver: opts.driver,
    dailyDrivingStipend: dailyStipend,
    travelDispatchBonus: travelBonus,
    photosComplete,
    submittedAt: nowIso(),
  };
}

/** Stamp the customer signature URL + signed-by name on a dispatch row.
 *  customerEmail is optional and written to col N when provided. */
export async function setDispatchSignature(
  dispatchId: string,
  signatureUrl: string,
  signedByName: string,
  customerEmail?: string
): Promise<void> {
  const rowIndex = await findRowIndex(
    TABS.dispatches,
    "A",
    dispatchId
  );
  if (!rowIndex) throw new Error("Dispatch row missing");
  const writes: Promise<void>[] = [
    updateCell(`${TABS.dispatches}!K${rowIndex}`, signatureUrl, "RAW"),
    updateCell(`${TABS.dispatches}!L${rowIndex}`, signedByName, "RAW"),
  ];
  if (customerEmail !== undefined && customerEmail !== "") {
    writes.push(
      updateCell(`${TABS.dispatches}!N${rowIndex}`, customerEmail, "RAW")
    );
  }
  await Promise.all(writes);
}

/** Save customer's post-service rating + optional written feedback. */
export async function setDispatchFeedback(
  dispatchId: string,
  rating: number,
  feedback: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  await Promise.all([
    updateCell(`${TABS.dispatches}!O${rowIndex}`, rating, "RAW"),
    updateCell(`${TABS.dispatches}!P${rowIndex}`, feedback, "RAW"),
  ]);
}

/** Stamp the auto-generated PDF report URL on a dispatch row. */
export async function setDispatchReportPdf(
  dispatchId: string,
  reportPdfUrl: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  await updateCell(
    `${TABS.dispatches}!M${rowIndex}`,
    reportPdfUrl,
    "RAW"
  );
}
