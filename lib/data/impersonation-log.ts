import "server-only";
import { TABS, appendRow, readTab } from "@/lib/google/sheets";
import { nextImpersonationLogId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";

export type ImpersonationEventType = "Start" | "Exit";

export interface ImpersonationLogEntry {
  logId: string;
  timestamp: string;
  eventType: ImpersonationEventType;
  adminTechId: string;
  adminName: string;
  targetTechId: string;
  targetName: string;
  notes: string;
}

function rowToEntry(row: string[]): ImpersonationLogEntry {
  return {
    logId: String(row[0] ?? ""),
    timestamp: String(row[1] ?? ""),
    eventType: (row[2] as ImpersonationEventType) || "Start",
    adminTechId: String(row[3] ?? ""),
    adminName: String(row[4] ?? ""),
    targetTechId: String(row[5] ?? ""),
    targetName: String(row[6] ?? ""),
    notes: String(row[7] ?? ""),
  };
}

export async function listImpersonationLog(
  opts: { fresh?: boolean } = {}
): Promise<ImpersonationLogEntry[]> {
  const rows = await readTab(TABS.impersonationLog, opts);
  return rows.filter((r) => r[0]).map(rowToEntry);
}

/**
 * Recent N entries, most recent first. Used by the /admin/techs page.
 */
export async function listRecentImpersonations(
  limit = 10
): Promise<ImpersonationLogEntry[]> {
  const all = await listImpersonationLog();
  return all
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

export async function logImpersonationEvent(opts: {
  eventType: ImpersonationEventType;
  adminTechId: string;
  adminName: string;
  targetTechId: string;
  targetName: string;
  notes?: string;
}): Promise<void> {
  const logId = await nextImpersonationLogId();
  await appendRow(TABS.impersonationLog, [
    logId,
    nowIso(),
    opts.eventType,
    opts.adminTechId,
    opts.adminName,
    opts.targetTechId,
    opts.targetName,
    opts.notes ?? "",
  ]);
}
