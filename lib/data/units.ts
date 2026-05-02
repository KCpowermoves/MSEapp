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

// Units Serviced columns:
// A=UnitID  B=DispID  C=JobID  D=UnitNum  E=Type  F=SubType
// G=Pre1  H=Pre2  I=Pre3
// J=Post1 K=Post2 L=Post3
// M=Nameplate  N=Filter  O=Additional (CSV)
// P=Make  Q=Model  R=Serial  S=Notes  T=LoggedBy  U=LoggedAt
const PHOTO_COL: Record<Exclude<PhotoSlot, "additional">, string> = {
  pre1: "G",
  pre2: "H",
  pre3: "I",
  post1: "J",
  post2: "K",
  post3: "L",
  nameplate: "M",
  filter: "N",
};
const ADDITIONAL_COL = "O";

function rowToUnit(row: string[]): UnitServiced {
  return {
    unitId: String(row[0] ?? ""),
    dispatchId: String(row[1] ?? ""),
    jobId: String(row[2] ?? ""),
    unitNumberOnJob: Number(row[3] ?? 0),
    unitType: (row[4] as UnitType) || "PTAC",
    unitSubType: (row[5] as UnitSubType) || "Standard tune-up",
    pre1Url: String(row[6] ?? ""),
    pre2Url: String(row[7] ?? ""),
    pre3Url: String(row[8] ?? ""),
    post1Url: String(row[9] ?? ""),
    post2Url: String(row[10] ?? ""),
    post3Url: String(row[11] ?? ""),
    nameplateUrl: String(row[12] ?? ""),
    filterUrl: String(row[13] ?? ""),
    additionalUrls: String(row[14] ?? ""),
    make: String(row[15] ?? ""),
    model: String(row[16] ?? ""),
    serial: String(row[17] ?? ""),
    notes: String(row[18] ?? ""),
    loggedBy: String(row[19] ?? ""),
    loggedAt: String(row[20] ?? ""),
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
    "", "", "",        // pre1, pre2, pre3
    "", "", "",        // post1, post2, post3
    "",                // nameplate
    "",                // filter
    "",                // additional (CSV)
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
    pre1Url: "",
    pre2Url: "",
    pre3Url: "",
    post1Url: "",
    post2Url: "",
    post3Url: "",
    nameplateUrl: "",
    filterUrl: "",
    additionalUrls: "",
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

  if (slot === "additional") {
    // Append to comma-separated list rather than overwrite
    const rows = await readTab(TABS.unitsServiced);
    const offset = rowIndex - 2;
    const existing = String(rows[offset]?.[14] ?? "");
    const next = existing ? `${existing}, ${url}` : url;
    await updateCell(`${TABS.unitsServiced}!${ADDITIONAL_COL}${rowIndex}`, next);
    return;
  }

  const col = PHOTO_COL[slot];
  await updateCell(`${TABS.unitsServiced}!${col}${rowIndex}`, url);
}

export async function getUnit(
  unitId: string
): Promise<UnitServiced | null> {
  const all = await listAllUnits();
  return all.find((u) => u.unitId === unitId) ?? null;
}

// Photo-completeness rule per unit type. PTAC needs pre1, post1,
// nameplate. Standard/Medium/Large need all 3 sides pre and post +
// nameplate. Filter is always optional. Additional is always optional.
export function requiredPhotoSlots(unitType: UnitType): PhotoSlot[] {
  if (unitType === "PTAC") return ["pre1", "post1", "nameplate"];
  return ["pre1", "pre2", "pre3", "post1", "post2", "post3", "nameplate"];
}

export function unitHasAllRequiredPhotos(unit: UnitServiced): boolean {
  const required = requiredPhotoSlots(unit.unitType);
  return required.every((slot) => {
    if (slot === "pre1") return Boolean(unit.pre1Url);
    if (slot === "pre2") return Boolean(unit.pre2Url);
    if (slot === "pre3") return Boolean(unit.pre3Url);
    if (slot === "post1") return Boolean(unit.post1Url);
    if (slot === "post2") return Boolean(unit.post2Url);
    if (slot === "post3") return Boolean(unit.post3Url);
    if (slot === "nameplate") return Boolean(unit.nameplateUrl);
    return true;
  });
}
