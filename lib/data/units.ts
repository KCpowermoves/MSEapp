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
import type { PhotoSlot, UnitServiced, UnitType } from "@/lib/types";

// Units Serviced columns:
// A=UnitID  B=DispID  C=JobID  D=UnitNum  E=Type  F=(legacy, empty)
// G=Photo1  H=Photo2  I=Photo3
// J=Photo4  K=Photo5  L=Photo6
// M=Nameplate  N=Filter  O=Additional (CSV)
// P=Make  Q=Model  R=Serial  S=Notes  T=LoggedBy  U=LoggedAt
// V=InPre  W=InPost  X=InNameplate  (Split System indoor AH only)
// Y=Label (optional zone/location label, e.g. "Rooftop East", "Suite 201")
const PHOTO_COL: Record<Exclude<PhotoSlot, "additional">, string> = {
  // Simple types (PTAC, Ductless, Water-Source HP, VRV-VRF)
  pre: "G", post: "H",
  // RTU coils
  coil1_pre: "G", coil1_post: "J",
  coil2_pre: "H", coil2_post: "K",
  filter_pre: "N", filter_post: "I",
  // Split System outdoor unit
  out_pre_1: "G", out_pre_2: "H", out_pre_3: "I",
  out_post_1: "J", out_post_2: "K", out_post_3: "L",
  out_nameplate: "M",
  // Split System indoor air handler
  in_pre: "V", in_post: "W", in_nameplate: "X",
  // Shared
  nameplate: "M", filter: "N",
};
const ADDITIONAL_COL = "O";

function rowToUnit(row: string[]): UnitServiced {
  return {
    unitId: String(row[0] ?? ""),
    dispatchId: String(row[1] ?? ""),
    jobId: String(row[2] ?? ""),
    unitNumberOnJob: Number(row[3] ?? 0),
    unitType: (row[4] as UnitType) || "PTAC",
    // row[5] = legacy SubType column (ignored)
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
    inPreUrl: String(row[21] ?? ""),
    inPostUrl: String(row[22] ?? ""),
    inNameplateUrl: String(row[23] ?? ""),
    label: String(row[24] ?? ""),
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
  label: string;
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
    "",                // F: legacy SubType column (empty for new records)
    "", "", "",        // G H I: photo slots 1-3
    "", "", "",        // J K L: photo slots 4-6
    "",                // M: nameplate
    "",                // N: filter
    "",                // O: additional (CSV)
    opts.make,
    opts.model,
    opts.serial,
    opts.notes,
    opts.loggedBy,
    isoNow,
    "", "", "",        // V W X: Split System indoor AH photos
    opts.label,        // Y: location/zone label
  ]);
  await bumpLastActivity(opts.jobId);
  return {
    unitId,
    dispatchId: opts.dispatchId,
    jobId: opts.jobId,
    unitNumberOnJob: opts.unitNumberOnJob,
    unitType: opts.unitType,
    pre1Url: "", pre2Url: "", pre3Url: "",
    post1Url: "", post2Url: "", post3Url: "",
    nameplateUrl: "", filterUrl: "", additionalUrls: "",
    inPreUrl: "", inPostUrl: "", inNameplateUrl: "",
    label: opts.label,
    make: opts.make,
    model: opts.model,
    serial: opts.serial,
    notes: opts.notes,
    loggedBy: opts.loggedBy,
    loggedAt: isoNow,
  };
}

export async function updateUnit(opts: {
  unitId: string;
  unitType?: UnitType;
  label?: string;
  make?: string;
  model?: string;
  serial?: string;
  notes?: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.unitsServiced, "A", opts.unitId);
  if (!rowIndex) throw new Error(`Unit not found: ${opts.unitId}`);
  const updates: Promise<void>[] = [];
  if (opts.unitType !== undefined)
    updates.push(updateCell(`${TABS.unitsServiced}!E${rowIndex}`, opts.unitType));
  if (opts.label !== undefined)
    updates.push(updateCell(`${TABS.unitsServiced}!Y${rowIndex}`, opts.label));
  if (opts.make !== undefined)
    updates.push(updateCell(`${TABS.unitsServiced}!P${rowIndex}`, opts.make));
  if (opts.model !== undefined)
    updates.push(updateCell(`${TABS.unitsServiced}!Q${rowIndex}`, opts.model));
  if (opts.serial !== undefined)
    updates.push(updateCell(`${TABS.unitsServiced}!R${rowIndex}`, opts.serial));
  if (opts.notes !== undefined)
    updates.push(updateCell(`${TABS.unitsServiced}!S${rowIndex}`, opts.notes));
  await Promise.all(updates);
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

const SIMPLE_TYPES: UnitType[] = ["PTAC / Ductless"];
const RTU_TYPES: UnitType[] = ["RTU-S", "RTU-M", "RTU-L"];

export function requiredPhotoSlots(unitType: UnitType): PhotoSlot[] {
  if (SIMPLE_TYPES.includes(unitType)) return ["pre", "post", "nameplate"];
  if (RTU_TYPES.includes(unitType))
    return ["coil1_pre", "coil1_post", "coil2_pre", "coil2_post", "nameplate", "filter_pre", "filter_post"];
  // Split System — 11 required
  return [
    "out_pre_1", "out_pre_2", "out_pre_3",
    "out_post_1", "out_post_2", "out_post_3",
    "out_nameplate", "in_pre", "in_post", "in_nameplate", "filter",
  ];
}

function urlForSlot(unit: UnitServiced, slot: PhotoSlot): string {
  switch (slot) {
    case "pre": case "out_pre_1": case "coil1_pre": return unit.pre1Url;
    case "post": case "out_pre_2": case "coil2_pre": return unit.pre2Url;
    case "out_pre_3": case "filter_post": return unit.pre3Url;
    case "out_post_1": case "coil1_post": return unit.post1Url;
    case "out_post_2": case "coil2_post": return unit.post2Url;
    case "out_post_3": return unit.post3Url;
    case "nameplate": case "out_nameplate": return unit.nameplateUrl;
    case "filter": case "filter_pre": return unit.filterUrl;
    case "in_pre": return unit.inPreUrl;
    case "in_post": return unit.inPostUrl;
    case "in_nameplate": return unit.inNameplateUrl;
    default: return "";
  }
}

export function unitHasAllRequiredPhotos(unit: UnitServiced): boolean {
  return requiredPhotoSlots(unit.unitType).every((slot) =>
    Boolean(urlForSlot(unit, slot))
  );
}

export function unitPhotoCounts(unit: UnitServiced): {
  uploaded: number;
  required: number;
} {
  const slots = requiredPhotoSlots(unit.unitType);
  const uploaded = slots.filter((s) => Boolean(urlForSlot(unit, s))).length;
  return { uploaded, required: slots.length };
}

export function photoUrlForSlot(unit: UnitServiced, slot: PhotoSlot): string {
  return urlForSlot(unit, slot);
}
