"use client";

import {
  bumpDraftAttempt,
  bumpDraftJobAttempt,
  listAllDraftJobs,
  listAllDrafts,
  listPending,
  markFailed,
  markPending,
  markUploading,
  removePhoto,
  rewriteJobIds,
  rewritePhotoUnitIds,
  setDraftJobStatus,
  setDraftStatus,
  type DraftJob,
  type DraftUnit,
  type QueuedPhoto,
} from "@/lib/upload-queue";

const POLL_MS = 5000;
const MAX_CONCURRENCY = 1;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

const UPLOAD_TIMEOUT_MS = 45_000;
const SYNC_TIMEOUT_MS = 30_000;
const STUCK_UPLOAD_THRESHOLD_MS = 60_000;       // since uploadStartedAt
const STUCK_SYNCING_THRESHOLD_MS = 5 * 60_000;  // since syncStartedAt
const PHOTO_MAX_ATTEMPTS = 12;
const DRAFT_MAX_ATTEMPTS = 12;

/** Backoff schedule (in seconds) keyed by attempt number. After N attempts,
 * wait this many seconds since the last attempt before retrying again. */
function backoffSeconds(attempts: number): number {
  // 30s, 60s, 2m, 4m, 5m, 5m, 5m, ...
  return Math.min(300, 30 * Math.pow(2, Math.max(0, attempts - 1)));
}

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = SYNC_TIMEOUT_MS, ...rest } = init;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function syncDraftJob(draft: DraftJob): Promise<void> {
  await setDraftJobStatus(draft.id, "syncing");
  try {
    const res = await fetchWithTimeout("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: draft.customerName,
        siteAddress: draft.siteAddress,
        utilityTerritory: draft.utilityTerritory,
        selfSold: draft.selfSold,
        soldBy: draft.soldBy,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const job = await res.json();
    const realJobId = job?.jobId as string | undefined;
    if (!realJobId) throw new Error("Server returned no jobId");

    await setDraftJobStatus(draft.id, "synced", { realJobId });
    await rewriteJobIds(draft.id, realJobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await bumpDraftJobAttempt(draft.id, msg);
    throw e;
  }
}

async function syncPendingDraftJobs(): Promise<void> {
  const drafts = await listAllDraftJobs();
  const now = Date.now();
  for (const d of drafts) {
    if (d.status === "synced") continue;
    if ((d.attempts ?? 0) >= DRAFT_MAX_ATTEMPTS) continue;

    // Recover drafts left in "syncing" state by a page reload mid-sync.
    if (d.status === "syncing") {
      const startedAt = d.syncStartedAt ?? d.lastAttemptAt ?? d.createdAt;
      if (now - startedAt < STUCK_SYNCING_THRESHOLD_MS) continue;
      // Treat as failed so backoff applies.
      await bumpDraftJobAttempt(d.id, "Sync abandoned — retrying");
      continue;
    }

    // Honor backoff for failed drafts.
    if (d.status === "failed") {
      const last = d.lastAttemptAt ?? d.createdAt;
      const elapsedSec = (now - last) / 1000;
      if (elapsedSec < backoffSeconds(d.attempts ?? 1)) continue;
    }

    try {
      await syncDraftJob(d);
    } catch {
      // bumpDraftJobAttempt already recorded the error; keep going
    }
  }
}

async function syncDraftUnit(draft: DraftUnit): Promise<void> {
  await setDraftStatus(draft.id, "syncing");
  try {
    const res = await fetchWithTimeout("/api/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: draft.jobId,
        unitType: draft.unitType,
        label: draft.label,
        make: draft.make,
        model: draft.model,
        serial: draft.serial,
        notes: draft.notes,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    const realUnitId = data.unit?.unitId as string | undefined;
    if (!realUnitId) throw new Error("Server returned no unitId");

    await setDraftStatus(draft.id, "synced", { realUnitId });
    await rewritePhotoUnitIds(draft.id, realUnitId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await bumpDraftAttempt(draft.id, msg);
    throw e;
  }
}

async function syncPendingDrafts(): Promise<void> {
  const drafts = await listAllDrafts();
  const now = Date.now();
  for (const d of drafts) {
    if (d.status === "synced") continue;
    if ((d.attempts ?? 0) >= DRAFT_MAX_ATTEMPTS) continue;
    // Skip if parent job is still local — will retry next tick after the
    // parent job syncs and rewriteJobIds bumps this row to a real id.
    if (d.jobId.startsWith("local-job-")) continue;

    // Recover drafts left in "syncing" state by a page reload mid-sync.
    if (d.status === "syncing") {
      const startedAt = d.syncStartedAt ?? d.lastAttemptAt ?? d.createdAt;
      if (now - startedAt < STUCK_SYNCING_THRESHOLD_MS) continue;
      await bumpDraftAttempt(d.id, "Sync abandoned — retrying");
      continue;
    }

    if (d.status === "failed") {
      const last = d.lastAttemptAt ?? d.createdAt;
      const elapsedSec = (now - last) / 1000;
      if (elapsedSec < backoffSeconds(d.attempts ?? 1)) continue;
    }

    try {
      await syncDraftUnit(d);
    } catch {
      // bumpDraftAttempt already recorded the error; keep going
    }
  }
}

async function uploadOne(item: QueuedPhoto) {
  await markUploading(item.id);
  const formData = new FormData();
  formData.append("file", item.blob, item.filename);
  formData.append("jobId", item.jobId);
  if (item.unitId) formData.append("unitId", item.unitId);
  if (item.serviceId) formData.append("serviceId", item.serviceId);
  if (item.photoSlot && item.photoSlot !== "service") {
    formData.append("slot", item.photoSlot);
  }
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {}
      await markFailed(item.id, msg);
      return;
    }
    await removePhoto(item.id);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function tick() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    schedule();
    return;
  }
  try {
    // 1a) Sync any offline-created jobs first. Until the job row exists
    //     server-side, units that reference its local- id can't sync.
    await syncPendingDraftJobs();

    // 1b) Sync any pending draft units — photos for those drafts can't
    //     upload until the unit row exists server-side and we know the
    //     real unitId. (rewriteJobIds above ensures these now have real
    //     jobIds where applicable.)
    await syncPendingDrafts();

    // 2) Drain photo queue.
    const pending = await listPending();
    const now = Date.now();

    // Recover photos stuck in "uploading" (page reloaded mid-upload, or
    // network silently dropped). Use uploadStartedAt — NOT capturedAt,
    // which would falsely flag any photo taken more than the threshold
    // ago as stuck on the very first attempt.
    for (const p of pending) {
      if (p.status !== "uploading") continue;
      const startedAt = p.uploadStartedAt ?? p.lastAttemptAt ?? 0;
      if (startedAt > 0 && now - startedAt > STUCK_UPLOAD_THRESHOLD_MS) {
        await markFailed(p.id, "Upload stuck — retrying");
      }
    }

    const fresh = await listPending();
    const drainable = fresh
      .filter((p) => p.status === "pending")
      .filter((p) => (p.attempts ?? 0) < PHOTO_MAX_ATTEMPTS)
      // skip photos still pointing at an unsynced draft job OR draft unit —
      // next tick will pick them up after the parent record syncs
      .filter((p) => !p.unitId || !p.unitId.startsWith("local-"))
      .filter((p) => !p.jobId || !p.jobId.startsWith("local-job-"))
      .slice(0, MAX_CONCURRENCY - inFlight);

    for (const item of drainable) {
      inFlight++;
      uploadOne(item)
        .catch(async (e) => {
          await markFailed(item.id, e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          inFlight--;
        });
    }

    // Schedule retries on failed photos. Backoff against lastAttemptAt
    // (NOT capturedAt — that's when the photo was taken, which can be
    // arbitrarily far in the past for offline-captured photos and would
    // trivially exceed every backoff threshold immediately).
    for (const p of fresh.filter((x) => x.status === "failed")) {
      if ((p.attempts ?? 0) >= PHOTO_MAX_ATTEMPTS) continue;
      const lastAttempt = p.lastAttemptAt ?? p.capturedAt ?? 0;
      const elapsedSec = (now - lastAttempt) / 1000;
      if (elapsedSec >= backoffSeconds(p.attempts ?? 1)) {
        await markPending(p.id);
      }
    }
  } catch (e) {
    console.warn("upload worker tick error", e);
  } finally {
    schedule();
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(tick, POLL_MS);
}

export function startUploadWorker() {
  if (typeof window === "undefined" || started) return;
  started = true;
  const onOnline = () => {
    if (timer) clearTimeout(timer);
    tick();
  };
  const onVis = () => {
    if (document.visibilityState === "visible") {
      if (timer) clearTimeout(timer);
      tick();
    }
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVis);
  schedule();
}

export function kickWorker() {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  tick();
}
