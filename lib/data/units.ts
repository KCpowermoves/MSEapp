import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextUnitId } from "@/lib/id-generators";
import { bumpLastActivity } from "@/lib/data/jobs";
import { nowIso } from "@/lib/utils";
import type {
  PhotoSlot,
  UnitServiced,
  UnitSubType,
  UnitType,
} from "@/lib/types";

const PHOTO_COL: Record<PhotoSlot, string> = {
  pre: "G",
  post: "H",
  clean: "I",
  nameplate: "J",
  filter: "K",
};

function rowToUnit(row: string[]): UnitServiced {
  return {
    unitId: String(row[0] ?? ""),
    dispatchId: String(row[1] ?? ""),
    jobId: String(row[2] ?? ""),
    unitNumberOnJob: Number(row[3] ?? 0),
    unitType: (row[4] as UnitType) || "PTAC",
    unitSubType: (row[5] as UnitSubType) || "Standard tune-up",
    prePhotoUrl: String(row[6] ?? ""),
    postPhotoUrl: String(row[7] ?? ""),
    cleanPhotoUrl: String(row[8] ?? ""),
    nameplatePhotoUrl: String(row[9] ?? ""),
    filterPhotoUrl: String(row[10] ?? ""),
    make: String(row[11] ?? ""),
    model: String(row[12] ?? ""),
    serial: String(row[13] ?? ""),
    notes: String(row[14] ?? ""),
    loggedBy: String(row[15] ?? ""),
    loggedAt: String(row[16] ?? ""),
  };
}

export async function listAllUnits(): Promise<UnitServiced[]> {
  const rows = await readTab(TABS.unitsServiced);
  return rows.filter((r) => r[0]).map(rowToUnit);
}

export async function listUnitsForDispatch(
  dispatchId: string
): Promise<UnitServiced[]> {
  const all = await listAllUnits();
  return all.filter((u) => u.dispatchId === dispatchId);
}

export async function listUnitsForJob(
  jobId: string
): Promise<UnitServiced[]> {
  const all = await listAllUnits();
  return all.filter((u) => u.jobId === jobId);
}

export async function nextUnitNumberOnJob(
  jobId: string
): Promise<number> {
  const units = await listUnitsForJob(jobId);
  const max = units.reduce(
    (m, u) => (u.unitNumberOnJob > m ? u.unitNumberOnJob : m),
    0
  );
  return max + 1;
}

export async function createUnit(opts: {
  dispatchId: string;
  jobId: string;
  unitNumberOnJob: number;
  unitType: UnitType;
  unitSubType: UnitSubType;
  make: string;
  model: string;
  serial: string;
  notes: string;
  loggedBy: string;
}): Promise<UnitServiced> {
  const unitId = await nextUnitId();
  const isoNow = nowIso();
  await appendRow(TABS.unitsServiced, [
    unitId,
    opts.dispatchId,
    opts.jobId,
    opts.unitNumberOnJob,
    opts.unitType,
    opts.unitSubType,
    "",
    "",
    "",
    "",
    "",
    opts.make,
    opts.model,
    opts.serial,
    opts.notes,
    opts.loggedBy,
    isoNow,
  ]);
  await bumpLastActivity(opts.jobId);
  return {
    unitId,
    dispatchId: opts.dispatchId,
    jobId: opts.jobId,
    unitNumberOnJob: opts.unitNumberOnJob,
    unitType: opts.unitType,
    unitSubType: opts.unitSubType,
    prePhotoUrl: "",
    postPhotoUrl: "",
    cleanPhotoUrl: "",
    nameplatePhotoUrl: "",
    filterPhotoUrl: "",
    make: opts.make,
    model: opts.model,
    serial: opts.serial,
    notes: opts.notes,
    loggedBy: opts.loggedBy,
    loggedAt: isoNow,
  };
}

export async function setUnitPhotoUrl(
  unitId: string,
  slot: PhotoSlot,
  url: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.unitsServiced, "A", unitId);
  if (!rowIndex) throw new Error(`Unit not found: ${unitId}`);
  const col = PHOTO_COL[slot];
  await updateCell(`${TABS.unitsServiced}!${col}${rowIndex}`, url);
}

export async function getUnit(
  unitId: string
): Promise<UnitServiced | null> {
  const all = await listAllUnits();
  return all.find((u) => u.unitId === unitId) ?? null;
}
