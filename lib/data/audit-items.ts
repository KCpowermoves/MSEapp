import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextAuditItemId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type {
  AuditItem,
  AuditItemStatus,
  AuditItemType,
  WaterSourceSubtype,
} from "@/lib/types";

function rowToAuditItem(row: string[]): AuditItem {
  return {
    itemId: String(row[0] ?? ""),
    auditId: String(row[1] ?? ""),
    jobId: String(row[2] ?? ""),
    itemType: (row[3] as AuditItemType) || "Walk-In",
    itemSubtype: (row[4] as WaterSourceSubtype | "") || "",
    itemNumber: Number(row[5] ?? 0),
    label: String(row[6] ?? ""),
    modelLabelPhotoUrl: String(row[7] ?? ""),
    nameplatePhotoUrl: String(row[8] ?? ""),
    fansPhotoUrl: String(row[9] ?? ""),
    tempPhotoUrl: String(row[10] ?? ""),
    wiringPhotoUrl: String(row[11] ?? ""),
    locationPhotoUrl: String(row[12] ?? ""),
    schedulePhotoUrlsCsv: String(row[13] ?? ""),
    controlsPhotoUrl: String(row[14] ?? ""),
    notes: String(row[15] ?? ""),
    loggedBy: String(row[16] ?? ""),
    loggedAt: String(row[17] ?? ""),
    status: (row[18] as AuditItemStatus) || "Active",
  };
}

export async function listAllAuditItems(
  opts: { fresh?: boolean } = {}
): Promise<AuditItem[]> {
  const rows = await readTab(TABS.auditItems, opts);
  return rows.filter((r) => r[0]).map(rowToAuditItem);
}

export async function listAuditItemsForAudit(
  auditId: string,
  opts: { fresh?: boolean } = {}
): Promise<AuditItem[]> {
  const all = await listAllAuditItems(opts);
  return all
    .filter((i) => i.auditId === auditId)
    .sort((a, b) => {
      if (a.itemType !== b.itemType) {
        return a.itemType.localeCompare(b.itemType);
      }
      return a.itemNumber - b.itemNumber;
    });
}

export async function getAuditItem(
  itemId: string
): Promise<AuditItem | null> {
  const all = await listAllAuditItems();
  return all.find((i) => i.itemId === itemId) ?? null;
}

export async function createAuditItem(opts: {
  auditId: string;
  jobId: string;
  itemType: AuditItemType;
  itemSubtype?: WaterSourceSubtype | "";
  itemNumber: number;
  label?: string;
  loggedBy: string;
}): Promise<AuditItem> {
  const itemId = await nextAuditItemId();
  const isoNow = nowIso();
  const subtype = opts.itemSubtype ?? "";
  await appendRow(TABS.auditItems, [
    itemId,           // A
    opts.auditId,     // B
    opts.jobId,       // C
    opts.itemType,    // D
    subtype,          // E
    opts.itemNumber,  // F
    opts.label ?? "", // G
    "", "", "", "", "", "", "", "", // photo URL slots H..O (8 cells)
    "",               // P Notes
    opts.loggedBy,    // Q
    isoNow,           // R
    "Active",         // S
  ]);
  return {
    itemId,
    auditId: opts.auditId,
    jobId: opts.jobId,
    itemType: opts.itemType,
    itemSubtype: subtype,
    itemNumber: opts.itemNumber,
    label: opts.label ?? "",
    modelLabelPhotoUrl: "",
    nameplatePhotoUrl: "",
    fansPhotoUrl: "",
    tempPhotoUrl: "",
    wiringPhotoUrl: "",
    locationPhotoUrl: "",
    schedulePhotoUrlsCsv: "",
    controlsPhotoUrl: "",
    notes: "",
    loggedBy: opts.loggedBy,
    loggedAt: isoNow,
    status: "Active",
  };
}

const ITEM_COLS = {
  itemSubtype: "E",
  itemNumber: "F",
  label: "G",
  modelLabelPhotoUrl: "H",
  nameplatePhotoUrl: "I",
  fansPhotoUrl: "J",
  tempPhotoUrl: "K",
  wiringPhotoUrl: "L",
  locationPhotoUrl: "M",
  schedulePhotoUrlsCsv: "N",
  controlsPhotoUrl: "O",
  notes: "P",
  loggedAt: "R",
  status: "S",
} as const;

export async function setAuditItemField(opts: {
  itemId: string;
  field: keyof typeof ITEM_COLS;
  value: string | number;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.auditItems, "A", opts.itemId);
  if (!rowIndex) throw new Error(`AuditItem not found: ${opts.itemId}`);
  const col = ITEM_COLS[opts.field];
  await updateCell(
    `${TABS.auditItems}!${col}${rowIndex}`,
    String(opts.value)
  );
  // Bump LoggedAt on every change.
  if (opts.field !== "loggedAt") {
    await updateCell(
      `${TABS.auditItems}!${ITEM_COLS.loggedAt}${rowIndex}`,
      nowIso()
    );
  }
}

/**
 * Append a Drive URL to the schedule CSV — used for thermostat
 * schedule photos which support multiple uploads per item.
 */
export async function appendAuditItemSchedulePhoto(opts: {
  itemId: string;
  url: string;
}): Promise<string> {
  const item = await getAuditItem(opts.itemId);
  if (!item) throw new Error(`AuditItem not found: ${opts.itemId}`);
  const existing = item.schedulePhotoUrlsCsv
    ? item.schedulePhotoUrlsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  existing.push(opts.url);
  const csv = existing.join(",");
  await setAuditItemField({
    itemId: opts.itemId,
    field: "schedulePhotoUrlsCsv",
    value: csv,
  });
  return csv;
}

export async function setAuditItemStatus(opts: {
  itemId: string;
  status: AuditItemStatus;
}): Promise<void> {
  await setAuditItemField({
    itemId: opts.itemId,
    field: "status",
    value: opts.status,
  });
}
