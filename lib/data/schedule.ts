import "server-only";
import {
  TABS,
  appendRow,
  ensureTabExists,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nowIso } from "@/lib/utils";

/**
 * Scheduled visits — the dispatch calendar. One row per planned visit:
 * a job, a date, an optional start time, and the assigned crew. Techs
 * see their own upcoming visits on /schedule; admins manage the week
 * on /admin/schedule.
 *
 * Deliberately independent of Dispatches (which record work actually
 * submitted): a visit is a plan, a dispatch is what happened.
 */

const HEADERS = [
  "ScheduleId",  // A — VISIT-YYYY-NNNN
  "JobId",       // B
  "Date",        // C — YYYY-MM-DD
  "StartTime",   // D — HH:mm 24h, optional
  "DurationMins",// E — optional
  "Techs",       // F — comma-separated tech names
  "Notes",       // G
  "Status",      // H — Scheduled | Cancelled
  "CreatedBy",   // I
  "CreatedAt",   // J
  "UpdatedBy",   // K
  "UpdatedAt",   // L
  "EstUnits",    // M — estimated HVAC units to clean
  "AuditRequired", // N — TRUE / FALSE
];

async function ensureScheduleTab(): Promise<void> {
  await ensureTabExists(TABS.schedule, HEADERS);
}

export type VisitStatus = "Scheduled" | "Cancelled";

export interface ScheduledVisit {
  scheduleId: string;
  jobId: string;
  date: string;      // YYYY-MM-DD
  startTime: string; // "HH:mm" or ""
  durationMins: number;
  techs: string[];
  notes: string;
  status: VisitStatus;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  /** Estimated HVAC units to clean on this visit. 0 = none (e.g. an
   *  audit-only visit). */
  estUnits: number;
  /** Whether an energy audit is required on this visit. */
  auditRequired: boolean;
}

function normalizeDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number") {
    const ms = (raw - 25569) * 86_400_000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s;
}

function rowToVisit(row: string[]): ScheduledVisit {
  return {
    scheduleId: String(row[0] ?? ""),
    jobId: String(row[1] ?? ""),
    date: normalizeDate(row[2]),
    startTime: String(row[3] ?? ""),
    durationMins: Number(row[4] ?? 0) || 0,
    techs: String(row[5] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: String(row[6] ?? ""),
    status: String(row[7] ?? "") === "Cancelled" ? "Cancelled" : "Scheduled",
    createdBy: String(row[8] ?? ""),
    createdAt: String(row[9] ?? ""),
    updatedBy: String(row[10] ?? ""),
    updatedAt: String(row[11] ?? ""),
    estUnits: Number(row[12] ?? 0) || 0,
    auditRequired: String(row[13] ?? "").toUpperCase() === "TRUE",
  };
}

export async function listAllVisits(): Promise<ScheduledVisit[]> {
  try {
    const rows = await readTab(TABS.schedule);
    return rows.filter((r) => r[0]).map(rowToVisit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) {
      // Tab doesn't exist yet — provision lazily and report empty.
      await ensureScheduleTab().catch(() => {});
      return [];
    }
    console.warn("[schedule] read failed:", msg);
    return [];
  }
}

/** Visits in an inclusive date range, Scheduled first then Cancelled,
 *  ordered by date + start time. */
export async function listVisitsInRange(opts: {
  startIso: string;
  endIso: string;
}): Promise<ScheduledVisit[]> {
  const all = await listAllVisits();
  return all
    .filter((v) => v.date >= opts.startIso && v.date <= opts.endIso)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.startTime || "99").localeCompare(b.startTime || "99")
    );
}

/** A tech's upcoming visits (today onward), Scheduled only. */
export async function listUpcomingVisitsForTech(opts: {
  techName: string;
  fromIso: string;
  days?: number;
}): Promise<ScheduledVisit[]> {
  const to = new Date(opts.fromIso + "T00:00:00Z");
  to.setUTCDate(to.getUTCDate() + (opts.days ?? 14));
  const visits = await listVisitsInRange({
    startIso: opts.fromIso,
    endIso: to.toISOString().slice(0, 10),
  });
  return visits.filter(
    (v) => v.status === "Scheduled" && v.techs.includes(opts.techName)
  );
}

let seq = 0;
async function nextScheduleId(): Promise<string> {
  // Timestamp + counter — no read round-trip, collision-proof enough
  // for a single office scheduling visits.
  seq = (seq + 1) % 1000;
  return `VISIT-${Date.now()}${String(seq).padStart(3, "0")}`;
}

export async function createVisit(opts: {
  jobId: string;
  date: string;
  startTime: string;
  durationMins: number;
  techs: string[];
  notes: string;
  estUnits: number;
  auditRequired: boolean;
  createdBy: string;
}): Promise<ScheduledVisit> {
  await ensureScheduleTab();
  const scheduleId = await nextScheduleId();
  const createdAt = nowIso();
  await appendRow(TABS.schedule, [
    scheduleId,
    opts.jobId,
    opts.date,
    opts.startTime,
    opts.durationMins || "",
    opts.techs.join(", "),
    opts.notes,
    "Scheduled",
    opts.createdBy,
    createdAt,
    "",
    "",
    opts.estUnits || "",
    opts.auditRequired ? "TRUE" : "FALSE",
  ]);
  return {
    scheduleId,
    jobId: opts.jobId,
    date: opts.date,
    startTime: opts.startTime,
    durationMins: opts.durationMins,
    techs: opts.techs,
    notes: opts.notes,
    status: "Scheduled",
    createdBy: opts.createdBy,
    createdAt,
    updatedBy: "",
    updatedAt: "",
    estUnits: opts.estUnits,
    auditRequired: opts.auditRequired,
  };
}

export async function updateVisit(opts: {
  scheduleId: string;
  patch: Partial<
    Pick<
      ScheduledVisit,
      | "date"
      | "startTime"
      | "durationMins"
      | "techs"
      | "notes"
      | "status"
      | "estUnits"
      | "auditRequired"
    >
  >;
  updatedBy: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.schedule, "A", opts.scheduleId);
  if (!rowIndex) throw new Error(`Visit not found: ${opts.scheduleId}`);
  const p = opts.patch;
  const writes: Array<Promise<void>> = [];
  if (p.date !== undefined)
    writes.push(updateCell(`${TABS.schedule}!C${rowIndex}`, p.date, "RAW"));
  if (p.startTime !== undefined)
    writes.push(updateCell(`${TABS.schedule}!D${rowIndex}`, p.startTime, "RAW"));
  if (p.durationMins !== undefined)
    writes.push(
      updateCell(`${TABS.schedule}!E${rowIndex}`, p.durationMins || "", "RAW")
    );
  if (p.techs !== undefined)
    writes.push(
      updateCell(`${TABS.schedule}!F${rowIndex}`, p.techs.join(", "), "RAW")
    );
  if (p.notes !== undefined)
    writes.push(updateCell(`${TABS.schedule}!G${rowIndex}`, p.notes, "RAW"));
  if (p.status !== undefined)
    writes.push(updateCell(`${TABS.schedule}!H${rowIndex}`, p.status, "RAW"));
  if (p.estUnits !== undefined)
    writes.push(
      updateCell(`${TABS.schedule}!M${rowIndex}`, p.estUnits || "", "RAW")
    );
  if (p.auditRequired !== undefined)
    writes.push(
      updateCell(
        `${TABS.schedule}!N${rowIndex}`,
        p.auditRequired ? "TRUE" : "FALSE",
        "RAW"
      )
    );
  writes.push(
    updateCell(`${TABS.schedule}!K${rowIndex}`, opts.updatedBy, "RAW"),
    updateCell(`${TABS.schedule}!L${rowIndex}`, nowIso(), "RAW")
  );
  await Promise.all(writes);
}
