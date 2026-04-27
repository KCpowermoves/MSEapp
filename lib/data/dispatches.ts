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
import { listUnitsForDispatch } from "@/lib/data/units";
import { listServicesForDispatch } from "@/lib/data/services";
import { writeAttributions } from "@/lib/data/pay-attribution";
import { nowIso, todayIsoDate } from "@/lib/utils";
import {
  DAILY_DRIVING_STIPEND,
  TRAVEL_DISPATCH_BONUS,
  isTravelTerritory,
} from "@/lib/pay-rates";
import type { CrewSplit, Dispatch } from "@/lib/types";

function rowToDispatch(row: string[]): Dispatch {
  const techsCsv = String(row[3] ?? "");
  return {
    dispatchId: String(row[0] ?? ""),
    jobId: String(row[1] ?? ""),
    dispatchDate: String(row[2] ?? ""),
    techsOnSite: techsCsv ? techsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [],
    crewSplit: (row[4] as CrewSplit) || "Solo",
    driver: String(row[5] ?? ""),
    dailyDrivingStipend: Number(row[6] ?? 0),
    travelDispatchBonus: Number(row[7] ?? 0),
    photosComplete: String(row[8] ?? "").toUpperCase() === "TRUE",
    submittedAt: String(row[9] ?? ""),
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

export async function ensureDraftDispatch(
  jobId: string
): Promise<Dispatch> {
  const today = todayIsoDate();
  const existing = await findDraftDispatch(jobId, today);
  if (existing) return existing;

  const dispatchId = await nextDispatchId();
  await appendRow(TABS.dispatches, [
    dispatchId,
    jobId,
    today,
    "",
    "Solo",
    "",
    0,
    0,
    "FALSE",
    "",
  ]);
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
  };
}

function unitHasAllPhotos(u: {
  prePhotoUrl: string;
  postPhotoUrl: string;
  cleanPhotoUrl: string;
  nameplatePhotoUrl: string;
  filterPhotoUrl: string;
}): boolean {
  return Boolean(
    u.prePhotoUrl &&
      u.postPhotoUrl &&
      u.cleanPhotoUrl &&
      u.nameplatePhotoUrl &&
      u.filterPhotoUrl
  );
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
    units.length > 0 && units.every((u) => unitHasAllPhotos(u));

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
  await updateCell(`${TABS.dispatches}!D${rowIndex}`, techsCsv);
  await updateCell(`${TABS.dispatches}!E${rowIndex}`, opts.crewSplit);
  await updateCell(`${TABS.dispatches}!F${rowIndex}`, opts.driver);
  await updateCell(`${TABS.dispatches}!G${rowIndex}`, dailyStipend);
  await updateCell(`${TABS.dispatches}!H${rowIndex}`, travelBonus);
  await updateCell(
    `${TABS.dispatches}!I${rowIndex}`,
    photosComplete ? "TRUE" : "FALSE"
  );
  await updateCell(`${TABS.dispatches}!J${rowIndex}`, nowIso());

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
