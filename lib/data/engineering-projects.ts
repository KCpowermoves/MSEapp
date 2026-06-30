import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextEngineeringProjectId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type {
  EngineeringLocation,
  EngineeringProject,
  EngineeringProjectStatus,
  EngineeringProjectType,
  EngineeringUtility,
  HvacUnitInput,
  MonthlyBill,
  WalkInUnitInput,
} from "@/lib/types";

function parseJsonArray<T>(raw: string): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function numberOrZero(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToProject(row: string[]): EngineeringProject {
  return {
    projectId: String(row[0] ?? ""),
    createdAt: String(row[1] ?? ""),
    createdBy: String(row[2] ?? ""),
    updatedAt: String(row[3] ?? ""),
    status: (row[4] as EngineeringProjectStatus) || "Draft",
    customerName: String(row[5] ?? ""),
    siteAddress: String(row[6] ?? ""),
    utility: (row[7] as EngineeringUtility) || "BGE",
    projectType: (row[8] as EngineeringProjectType) || "Small",
    projectSubtype: String(row[9] ?? ""),
    squareFootage: numberOrZero(row[10]),
    location: (row[11] as EngineeringLocation) || "BWI",
    annualKwh: numberOrZero(row[12]),
    engineeringFeeOverride: numberOrNull(row[13]),
    sensorCostOverride: numberOrNull(row[14]),
    monthlyBills: parseJsonArray<MonthlyBill>(String(row[15] ?? "")),
    hvacUnits: parseJsonArray<HvacUnitInput>(String(row[16] ?? "")),
    walkInUnits: parseJsonArray<WalkInUnitInput>(String(row[17] ?? "")),
    notes: String(row[18] ?? ""),
  };
}

export async function listAllEngineeringProjects(
  opts: { fresh?: boolean } = {}
): Promise<EngineeringProject[]> {
  const rows = await readTab(TABS.engineeringProjects, opts);
  return rows
    .filter((r) => r[0])
    .map(rowToProject)
    .filter((p) => p.status !== "Deleted");
}

export async function getEngineeringProject(
  projectId: string,
  opts: { fresh?: boolean } = {}
): Promise<EngineeringProject | null> {
  const all = await listAllEngineeringProjects(opts);
  const hit = all.find((p) => p.projectId === projectId);
  if (hit) return hit;
  if (!opts.fresh) {
    const fresh = await listAllEngineeringProjects({ fresh: true });
    return fresh.find((p) => p.projectId === projectId) ?? null;
  }
  return null;
}

export async function createEngineeringProject(opts: {
  customerName: string;
  utility: EngineeringUtility;
  location: EngineeringLocation;
  createdBy: string;
}): Promise<EngineeringProject> {
  const projectId = await nextEngineeringProjectId();
  const isoNow = nowIso();
  await appendRow(TABS.engineeringProjects, [
    projectId,
    isoNow,
    opts.createdBy,
    isoNow,
    "Draft",
    opts.customerName,
    "", // site address
    opts.utility,
    "Small", // project type default
    "Building Tune-up", // project subtype default
    0, // sq ft
    opts.location,
    0, // annual kwh
    "", // eng fee override
    "", // sensor cost override
    "[]", // monthly bills
    "[]", // hvac units
    "[]", // walk-in units
    "", // notes
  ]);
  return {
    projectId,
    createdAt: isoNow,
    createdBy: opts.createdBy,
    updatedAt: isoNow,
    status: "Draft",
    customerName: opts.customerName,
    siteAddress: "",
    utility: opts.utility,
    projectType: "Small",
    projectSubtype: "Building Tune-up",
    squareFootage: 0,
    location: opts.location,
    annualKwh: 0,
    engineeringFeeOverride: null,
    sensorCostOverride: null,
    monthlyBills: [],
    hvacUnits: [],
    walkInUnits: [],
    notes: "",
  };
}

const PROJECT_COLS = {
  updatedAt: "D",
  status: "E",
  customerName: "F",
  siteAddress: "G",
  utility: "H",
  projectType: "I",
  projectSubtype: "J",
  squareFootage: "K",
  location: "L",
  annualKwh: "M",
  engineeringFeeOverride: "N",
  sensorCostOverride: "O",
  monthlyBills: "P",
  hvacUnits: "Q",
  walkInUnits: "R",
  notes: "S",
} as const;

export async function updateEngineeringProject(opts: {
  projectId: string;
  customerName?: string;
  siteAddress?: string;
  utility?: EngineeringUtility;
  projectType?: EngineeringProjectType;
  projectSubtype?: string;
  squareFootage?: number;
  location?: EngineeringLocation;
  annualKwh?: number;
  engineeringFeeOverride?: number | null;
  sensorCostOverride?: number | null;
  monthlyBills?: MonthlyBill[];
  hvacUnits?: HvacUnitInput[];
  walkInUnits?: WalkInUnitInput[];
  status?: EngineeringProjectStatus;
  notes?: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(
    TABS.engineeringProjects,
    "A",
    opts.projectId
  );
  if (!rowIndex)
    throw new Error(`Engineering project not found: ${opts.projectId}`);
  const isoNow = nowIso();
  const updates: Promise<void>[] = [];
  function setCell(col: string, value: string | number) {
    updates.push(
      updateCell(`${TABS.engineeringProjects}!${col}${rowIndex}`, value)
    );
  }
  // UpdatedAt always bumps.
  setCell(PROJECT_COLS.updatedAt, isoNow);
  if (opts.status !== undefined) setCell(PROJECT_COLS.status, opts.status);
  if (opts.customerName !== undefined)
    setCell(PROJECT_COLS.customerName, opts.customerName);
  if (opts.siteAddress !== undefined)
    setCell(PROJECT_COLS.siteAddress, opts.siteAddress);
  if (opts.utility !== undefined) setCell(PROJECT_COLS.utility, opts.utility);
  if (opts.projectType !== undefined)
    setCell(PROJECT_COLS.projectType, opts.projectType);
  if (opts.projectSubtype !== undefined)
    setCell(PROJECT_COLS.projectSubtype, opts.projectSubtype);
  if (opts.squareFootage !== undefined)
    setCell(PROJECT_COLS.squareFootage, opts.squareFootage);
  if (opts.location !== undefined)
    setCell(PROJECT_COLS.location, opts.location);
  if (opts.annualKwh !== undefined)
    setCell(PROJECT_COLS.annualKwh, opts.annualKwh);
  if (opts.engineeringFeeOverride !== undefined)
    setCell(
      PROJECT_COLS.engineeringFeeOverride,
      opts.engineeringFeeOverride === null
        ? ""
        : opts.engineeringFeeOverride
    );
  if (opts.sensorCostOverride !== undefined)
    setCell(
      PROJECT_COLS.sensorCostOverride,
      opts.sensorCostOverride === null ? "" : opts.sensorCostOverride
    );
  if (opts.monthlyBills !== undefined)
    setCell(PROJECT_COLS.monthlyBills, JSON.stringify(opts.monthlyBills));
  if (opts.hvacUnits !== undefined)
    setCell(PROJECT_COLS.hvacUnits, JSON.stringify(opts.hvacUnits));
  if (opts.walkInUnits !== undefined)
    setCell(PROJECT_COLS.walkInUnits, JSON.stringify(opts.walkInUnits));
  if (opts.notes !== undefined) setCell(PROJECT_COLS.notes, opts.notes);
  await Promise.all(updates);
}

export async function softDeleteEngineeringProject(
  projectId: string
): Promise<void> {
  await updateEngineeringProject({ projectId, status: "Deleted" });
}
