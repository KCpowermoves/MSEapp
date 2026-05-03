import "server-only";
import { TABS, appendRow } from "@/lib/google/sheets";
import { nowIso } from "@/lib/utils";

export type LocationEventType =
  | "login"
  | "app-open"
  | "job-create"
  | "unit-save"
  | "dispatch-submit"
  | "permission-denied"
  | "unsupported";

export interface LocationEventInput {
  techName: string;
  type: LocationEventType;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  jobId?: string;
  unitId?: string;
  notes?: string;
}

/**
 * Append a location event row. Best-effort — caller passes whatever
 * coords the browser gave them; failure modes (denied, unsupported,
 * inaccurate) are logged with a typed event so the data is still useful
 * for "this tech declined location, FYI."
 */
export async function recordLocationEvent(
  input: LocationEventInput
): Promise<void> {
  const id = `LOC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await appendRow(
    TABS.locationEvents,
    [
      id,
      nowIso(),
      input.techName ?? "",
      input.type,
      input.lat ?? "",
      input.lng ?? "",
      input.accuracy ?? "",
      input.jobId ?? "",
      input.unitId ?? "",
      input.notes ?? "",
    ],
    "USER_ENTERED"
  );
}
