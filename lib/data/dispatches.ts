import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readRange,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextDispatchId } from "@/lib/id-generators";
import { bumpLastActivity, getJob } from "@/lib/data/jobs";
import {
  listUnitsForDispatch,
  unitHasAllRequiredPhotos,
} from "@/lib/data/units";
import { listServicesForDispatch } from "@/lib/data/services";
import {
  writeAttributions,
  deletePayAttributionRowsForDispatch,
  appendLateStipendRows,
} from "@/lib/data/pay-attribution";
import { nowIso, todayIsoDate } from "@/lib/utils";
import {
  DAILY_DRIVING_STIPEND,
  TRAVEL_DISPATCH_BONUS,
  isTravelTerritory,
} from "@/lib/pay-rates";
import type { CrewSplit, Dispatch } from "@/lib/types";

// Sheets may return dates as ISO strings, US-locale strings, or serial
// numbers (days since 1899-12-30) depending on cell formatting and the
// valueInputOption used to write them. Normalize all three to YYYY-MM-DD.
function normalizeDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (typeof raw === "number") return serialToIso(raw);
  const s = String(raw).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 25000 && n < 100000) return serialToIso(n);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return s;
}

function serialToIso(serial: number): string {
  // Sheets epoch: 1899-12-30 (preserves the Lotus 1-2-3 leap-year bug)
  const ms = (serial - 25569) * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function rowToDispatch(row: string[]): Dispatch {
  const techsCsv = String(row[3] ?? "");
  return {
    dispatchId: String(row[0] ?? ""),
    jobId: String(row[1] ?? ""),
    dispatchDate: normalizeDate(row[2]),
    techsOnSite: techsCsv ? techsCsv.split(",").map((s) => s.trim()).filter(Boolean) : [],
    crewSplit: (row[4] as CrewSplit) || "Solo",
    driver: String(row[5] ?? ""),
    dailyDrivingStipend: Number(row[6] ?? 0),
    travelDispatchBonus: Number(row[7] ?? 0),
    photosComplete: String(row[8] ?? "").toUpperCase() === "TRUE",
    submittedAt: String(row[9] ?? ""),
    signatureUrl: String(row[10] ?? ""),
    signedByName: String(row[11] ?? ""),
    reportPdfUrl: String(row[12] ?? ""),
    customerEmail: String(row[13] ?? ""),
    customerRating: Number(row[14] ?? 0) || 0,
    customerFeedback: String(row[15] ?? ""),
    reportEmailedAt: String(row[16] ?? ""),
    marketingConsent: String(row[17] ?? "").toUpperCase() === "TRUE",
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

export async function listDispatchesForJob(
  jobId: string
): Promise<Dispatch[]> {
  const all = await listAllDispatches();
  return all.filter((d) => d.jobId === jobId);
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

/** Most recent dispatch on a job for the given date, regardless of
 *  whether it's been submitted. Used by the post-submit customer
 *  confirmation + feedback screens, which run AFTER the dispatch is
 *  finalized and therefore can't use findDraftDispatch. */
export async function findDispatchByDate(
  jobId: string,
  date: string
): Promise<Dispatch | null> {
  const all = await listAllDispatches();
  const matches = all.filter(
    (d) => d.jobId === jobId && d.dispatchDate === date
  );
  if (matches.length === 0) return null;
  // Prefer the latest submitted one, falling back to any match.
  matches.sort((a, b) =>
    (b.submittedAt || "").localeCompare(a.submittedAt || "")
  );
  return matches[0];
}

export async function ensureDraftDispatch(
  jobId: string
): Promise<Dispatch> {
  const today = todayIsoDate();
  const existing = await findDraftDispatch(jobId, today);
  if (existing) return existing;

  const dispatchId = await nextDispatchId();
  await appendRow(
    TABS.dispatches,
    [dispatchId, jobId, today, "", "Solo", "", 0, 0, "FALSE", "", "", "", "", "", 0, "", "", "FALSE"],
    "RAW"
  );
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
    signatureUrl: "",
    signedByName: "",
    reportPdfUrl: "",
    customerEmail: "",
    customerRating: 0,
    customerFeedback: "",
    reportEmailedAt: "",
    marketingConsent: false,
  };
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
    units.length > 0 && units.every((u) => unitHasAllRequiredPhotos(u));

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
  await updateCell(`${TABS.dispatches}!D${rowIndex}`, techsCsv, "RAW");
  await updateCell(`${TABS.dispatches}!E${rowIndex}`, opts.crewSplit, "RAW");
  await updateCell(`${TABS.dispatches}!F${rowIndex}`, opts.driver, "RAW");
  await updateCell(`${TABS.dispatches}!G${rowIndex}`, dailyStipend, "RAW");
  await updateCell(`${TABS.dispatches}!H${rowIndex}`, travelBonus, "RAW");
  await updateCell(
    `${TABS.dispatches}!I${rowIndex}`,
    photosComplete ? "TRUE" : "FALSE",
    "RAW"
  );
  await updateCell(`${TABS.dispatches}!J${rowIndex}`, nowIso(), "RAW");

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

/**
 * Late-photo reconciliation. photosComplete + the daily driving stipend
 * are stamped once at submit time — if a photo was still uploading (or
 * stuck in the tech's offline queue) when the dispatch was submitted,
 * the dispatch row froze at FALSE and the crew silently lost the
 * stipend even after the photo eventually landed.
 *
 * Called fire-and-forget after every successful unit-photo upload (via
 * tryRenderPdfIfReady). Idempotent: no-ops unless the dispatch is
 * submitted, currently marked incomplete, and every unit now has all
 * required photos. Back-fills the missing Daily Stipend attribution
 * rows (skipping any tech who already has one for this dispatch).
 */
const refreshLocks = new Map<string, Promise<boolean>>();

export async function refreshPhotosCompleteIfNeeded(
  dispatchId: string
): Promise<boolean> {
  // Per-dispatch in-process lock: multiple photos of the same dispatch
  // finishing at once (the common trigger) serialize here instead of
  // racing the check below.
  const prev = refreshLocks.get(dispatchId) ?? Promise.resolve(false);
  const run = prev.then(
    () => doRefreshPhotosComplete(dispatchId),
    () => doRefreshPhotosComplete(dispatchId)
  );
  const tail = run.then(
    (v) => v,
    () => false
  );
  refreshLocks.set(dispatchId, tail);
  void tail.then(() => {
    if (refreshLocks.get(dispatchId) === tail) refreshLocks.delete(dispatchId);
  });
  return run;
}

async function doRefreshPhotosComplete(dispatchId: string): Promise<boolean> {
  const dispatch = await getDispatch(dispatchId);
  if (!dispatch || !dispatch.submittedAt || dispatch.photosComplete) {
    return false;
  }
  const units = await listUnitsForDispatch(dispatchId);
  const complete =
    units.length > 0 && units.every((u) => unitHasAllRequiredPhotos(u));
  if (!complete) return false;

  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) return false;

  // Fresh single-cell re-read of photosComplete right before acting —
  // the getDispatch above can be up to 30s stale, and another instance
  // may have completed this reconciliation already.
  const freshFlag = await readRange(`${TABS.dispatches}!I${rowIndex}`, {
    fresh: true,
  });
  if (String(freshFlag[0]?.[0] ?? "").toUpperCase() === "TRUE") {
    return false;
  }

  await updateCell(`${TABS.dispatches}!I${rowIndex}`, "TRUE", "RAW");
  await updateCell(
    `${TABS.dispatches}!G${rowIndex}`,
    DAILY_DRIVING_STIPEND,
    "RAW"
  );

  // Never write money into locked books. If the payroll period that
  // covers this dispatch date is already past Draft, skip the
  // attribution rows and leave an audit-log entry for the admin to
  // add a manual adjustment instead.
  const lockedPeriod = await findLockedPeriodCovering(dispatch.dispatchDate);
  if (lockedPeriod) {
    const { logPayrollAction } = await import("@/lib/data/payroll-log");
    await logPayrollAction({
      admin: "system",
      action: "adjustment-create",
      periodId: lockedPeriod.periodId,
      target: dispatchId,
      detail:
        `SKIPPED stipend back-fill: photos for ${dispatchId} (${dispatch.dispatchDate}) ` +
        `completed after period was ${lockedPeriod.status}. Add a manual ` +
        `Daily Stipend adjustment ($${DAILY_DRIVING_STIPEND}/tech: ${dispatch.techsOnSite.join(", ")}) if owed.`,
    });
    console.warn(
      `[dispatch] late stipend for ${dispatchId} NOT auto-written — period ${lockedPeriod.periodId} is ${lockedPeriod.status}; logged for manual review`
    );
    return true;
  }

  await appendLateStipendRows({
    dispatchId,
    dispatchDate: dispatch.dispatchDate,
    techsOnSite: dispatch.techsOnSite,
    stipend: DAILY_DRIVING_STIPEND,
  });
  console.log(
    `[dispatch] late photos completed ${dispatchId} — photosComplete flipped TRUE, stipend back-filled`
  );
  return true;
}

/** The payroll period covering this date, if it's already locked
 *  (anything past Draft). Lazy import avoids a module cycle. */
async function findLockedPeriodCovering(
  dateIso: string
): Promise<{ periodId: string; status: string } | null> {
  try {
    const { listAllPayrollPeriods } = await import(
      "@/lib/data/payroll-periods"
    );
    const periods = await listAllPayrollPeriods();
    const hit = periods.find(
      (p) =>
        p.status !== "Draft" &&
        p.startDate <= dateIso &&
        dateIso <= p.endDate
    );
    return hit ? { periodId: hit.periodId, status: hit.status } : null;
  } catch {
    // Payroll tabs may not exist yet — treat as unlocked.
    return null;
  }
}

/** Stamp the customer signature URL + signed-by name on a dispatch row.
 *  customerEmail is optional and written to col N when provided. */
export async function setDispatchSignature(
  dispatchId: string,
  signatureUrl: string,
  signedByName: string,
  customerEmail?: string
): Promise<void> {
  const rowIndex = await findRowIndex(
    TABS.dispatches,
    "A",
    dispatchId
  );
  if (!rowIndex) throw new Error("Dispatch row missing");
  const writes: Promise<void>[] = [
    updateCell(`${TABS.dispatches}!K${rowIndex}`, signatureUrl, "RAW"),
    updateCell(`${TABS.dispatches}!L${rowIndex}`, signedByName, "RAW"),
  ];
  if (customerEmail !== undefined && customerEmail !== "") {
    writes.push(
      updateCell(`${TABS.dispatches}!N${rowIndex}`, customerEmail, "RAW")
    );
  }
  await Promise.all(writes);
}

/** Save the crew + split on a draft dispatch BEFORE final submission.
 *  Called from /api/jobs when the tech picks crew at job creation,
 *  and from any future "edit crew" affordance on the submit page.
 *  Doesn't touch submittedAt — the dispatch stays a draft until the
 *  full submitDispatch flow runs. */
export async function setDispatchCrew(
  dispatchId: string,
  techsOnSite: string[],
  crewSplit: CrewSplit
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  const techsCsv = techsOnSite.join(", ");
  await Promise.all([
    updateCell(`${TABS.dispatches}!D${rowIndex}`, techsCsv, "RAW"),
    updateCell(`${TABS.dispatches}!E${rowIndex}`, crewSplit, "RAW"),
  ]);
}

/** Stamp the timestamp when the auto-email actually went out. Used as
 *  a guard so concurrent send paths (PDF render auto-send + feedback
 *  step send) don't double-email the customer. */
export async function setDispatchEmailed(
  dispatchId: string,
  emailedAtIso: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  await updateCell(`${TABS.dispatches}!Q${rowIndex}`, emailedAtIso, "RAW");
}

/** Save customer's marketing-consent decision (before/after photos +
 *  story usable on the MSE site/social). Defaults to false. */
export async function setDispatchMarketingConsent(
  dispatchId: string,
  consent: boolean
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  await updateCell(
    `${TABS.dispatches}!R${rowIndex}`,
    consent ? "TRUE" : "FALSE",
    "RAW"
  );
}

/** Save customer's post-service rating + optional written feedback. */
export async function setDispatchFeedback(
  dispatchId: string,
  rating: number,
  feedback: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  await Promise.all([
    updateCell(`${TABS.dispatches}!O${rowIndex}`, rating, "RAW"),
    updateCell(`${TABS.dispatches}!P${rowIndex}`, feedback, "RAW"),
  ]);
}

/** Stamp the auto-generated PDF report URL on a dispatch row. */
export async function setDispatchReportPdf(
  dispatchId: string,
  reportPdfUrl: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) throw new Error("Dispatch row missing");
  await updateCell(
    `${TABS.dispatches}!M${rowIndex}`,
    reportPdfUrl,
    "RAW"
  );
}

// ─────────────────────────────────────────────────────────────────────
// Auto-finalize helpers
//
// In v2 the tech doesn't tap "Submit job" anymore. The dispatch closes
// itself via two paths that converge on the same submitDispatch call:
//
//   1. When the tech moves on (loads /jobs or a different job's page),
//      any of their other open drafts from today auto-close. Fire-and-
//      forget so it never blocks navigation.
//
//   2. Vercel cron at 01:00 UTC (≈ 8–9pm ET) sweeps every remaining
//      draft and finalizes it regardless of photo state. Catches
//      anything the navigation trigger missed (tech closed the app,
//      lost signal, etc.).
//
// Both paths are idempotent — submittedAt empty is the only "needs
// finalizing" signal, and submitDispatch stamps it atomically. A draft
// that races between paths just gets one winner; the second pass sees
// submittedAt populated and skips.
// ─────────────────────────────────────────────────────────────────────

/**
 * Finalize this tech's open drafts from today on jobs OTHER than the
 * one they're currently on. Triggered fire-and-forget from server
 * components on page load — `exceptJobId` is the job they just landed
 * on (or null when they're at /jobs).
 *
 * Filters by tech presence in techsOnSite so multi-crew dispatches
 * only finalize when ANY listed tech moves on — simple rule that
 * works for the solo-tech 99% case. Multi-tech jobs lean on the cron.
 */
export async function autoFinalizeOpenDraftsForTech(
  techName: string,
  options?: {
    exceptJobId?: string | null;
    /** When set, only finalize drafts on this specific job. */
    onlyJobId?: string;
    /** When set, only finalize the single dispatch with this ID. */
    onlyDispatchId?: string;
  }
): Promise<{ finalized: string[]; errors: string[]; finalizedCount?: number }> {
  const today = todayIsoDate();
  const all = await listAllDispatches();
  const candidates = all.filter(
    (d) =>
      !d.submittedAt &&
      d.dispatchDate === today &&
      d.techsOnSite.includes(techName) &&
      d.jobId !== options?.exceptJobId &&
      (options?.onlyJobId === undefined || d.jobId === options.onlyJobId) &&
      (options?.onlyDispatchId === undefined || d.dispatchId === options.onlyDispatchId)
  );

  const finalized: string[] = [];
  const errors: string[] = [];
  for (const draft of candidates) {
    try {
      await submitDispatch({
        dispatchId: draft.dispatchId,
        techsOnSite: draft.techsOnSite,
        crewSplit: draft.crewSplit,
        driver: draft.driver,
      });
      finalized.push(draft.dispatchId);
    } catch (e) {
      console.warn(
        `[auto-finalize] failed for ${draft.dispatchId}:`,
        e instanceof Error ? e.message : e
      );
      errors.push(draft.dispatchId);
    }
  }
  return { finalized, errors, finalizedCount: finalized.length };
}

/**
 * Finalize every open draft from today and prior days. Called by the
 * nightly cron. Per Kevin's spec: drafts with zero photos are
 * finalized anyway — photos still in the IndexedDB upload queue on
 * the tech's device will land in Drive whenever the device next
 * syncs, the dispatch row just needs to be officially closed so pay
 * attribution runs.
 */
export async function autoFinalizeAllStaleDrafts(): Promise<{
  finalized: string[];
  errors: string[];
}> {
  const today = todayIsoDate();
  const all = await listAllDispatches();
  const candidates = all.filter(
    (d) => !d.submittedAt && d.dispatchDate && d.dispatchDate <= today
  );

  const finalized: string[] = [];
  const errors: string[] = [];
  for (const draft of candidates) {
    try {
      await submitDispatch({
        dispatchId: draft.dispatchId,
        techsOnSite: draft.techsOnSite,
        crewSplit: draft.crewSplit,
        driver: draft.driver,
      });
      finalized.push(draft.dispatchId);
    } catch (e) {
      console.warn(
        `[cron-finalize] failed for ${draft.dispatchId}:`,
        e instanceof Error ? e.message : e
      );
      errors.push(draft.dispatchId);
    }
  }
  return { finalized, errors };
}

/**
 * Inverse of submitDispatch (the finalize step) — deletes the Pay
 * Attribution rows that were written when this dispatch was finalized,
 * then clears Dispatches.submittedAt so the dispatch becomes a draft
 * again. Used by /api/jobs/[jobId]/reopen.
 *
 * Idempotent: if the dispatch isn't finalized (submittedAt is empty),
 * or the dispatch doesn't exist, this is a no-op.
 */
export async function unfinalizeDispatch(dispatchId: string): Promise<void> {
  if (!dispatchId) return;

  const rowIndex = await findRowIndex(TABS.dispatches, "A", dispatchId);
  if (!rowIndex) return; // dispatch not found — no-op

  const dispatch = await getDispatch(dispatchId);
  if (!dispatch?.submittedAt) return; // already unfinalized — idempotent no-op

  // 1. Delete Pay Attribution rows for this dispatch.
  await deletePayAttributionRowsForDispatch(dispatchId);

  // 2. Clear submittedAt — col J (index 9 in rowToDispatch).
  await updateCell(`${TABS.dispatches}!J${rowIndex}`, "", "RAW");
}
