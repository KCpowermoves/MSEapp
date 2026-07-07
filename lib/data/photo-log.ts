import "server-only";
import { TABS, appendRow, ensureTabExists } from "@/lib/google/sheets";
import { nowIso } from "@/lib/utils";

/**
 * Append-only audit trail for every photo that reaches Drive.
 *
 * Written IMMEDIATELY after the Drive upload succeeds — before the
 * sheet-cell write that makes the photo visible in the app. Sheets
 * appends are atomic (no read-modify-write), so this tab cannot lose
 * rows to races. If a cell write later fails or gets clobbered, the
 * log row still records the Drive file ID and where the photo was
 * meant to land, making every photo recoverable.
 *
 * Logging must NEVER break an upload — all writes are best-effort.
 */

const HEADERS = [
  "Logged At",   // A — ISO timestamp
  "Tech",        // B — who uploaded
  "Job ID",      // C
  "Kind",        // D — unit | service | job-cover | signature | audit-building | audit-item
  "Target ID",   // E — unitId / serviceId / auditId / itemId / dispatchId
  "Slot",        // F — photo slot where applicable
  "Drive File ID", // G
  "Drive URL",   // H
  "Status",      // I — uploaded | sheet-write-failed
  "Note",        // J — error detail for failures
];

export interface PhotoLogEntry {
  tech: string;
  jobId: string;
  kind:
    | "unit"
    | "service"
    | "job-cover"
    | "signature"
    | "audit-building"
    | "audit-item";
  targetId: string;
  slot?: string;
  driveFileId: string;
  driveUrl: string;
  status: "uploaded" | "sheet-write-failed";
  note?: string;
}

export async function logPhotoEvent(entry: PhotoLogEntry): Promise<void> {
  try {
    await ensureTabExists(TABS.photoLog, HEADERS);
    await appendRow(TABS.photoLog, [
      nowIso(),
      entry.tech,
      entry.jobId,
      entry.kind,
      entry.targetId,
      entry.slot ?? "",
      entry.driveFileId,
      entry.driveUrl,
      entry.status,
      entry.note ?? "",
    ]);
  } catch (e) {
    // Best-effort only — a logging failure must never fail the upload.
    console.warn("[photo-log] append failed:", e);
  }
}
