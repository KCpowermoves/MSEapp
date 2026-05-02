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
const STUCK_UPLOAD_THRESHOLD_MS = 90_000;
const DRAFT_MAX_ATTEMPTS = 6;

async function syncDraftJob(draft: DraftJob): Promise<void> {
  await setDraftJobStatus(draft.id, "syncing");
  try {
    const res = await fetch("/api/jobs", {
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
    // Cascade: rewrite the local-job- id to the real one on every queued
    // draft unit AND every photo so they target the now-existing job.
    await rewriteJobIds(draft.id, realJobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await bumpDraftJobAttempt(draft.id, msg);
    throw e;
  }
}

async function syncPendingDraftJobs(): Promise<void> {
  const drafts = await listAllDraftJobs();
  for (const d of drafts) {
    if (d.status === "synced") continue;
    if (d.status === "syncing") continue;
    if ((d.attempts ?? 0) >= DRAFT_MAX_ATTEMPTS) continue;
    try {
      await syncDraftJob(d);
    } catch {
      // logged via bumpDraftJobAttempt; keep going
    }
  }
}

async function syncDraftUnit(draft: DraftUnit): Promise<void> {
  await setDraftStatus(draft.id, "syncing");
  try {
    const res = await fetch("/api/units", {
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

    // Mark draft synced and rewrite all queued photos that reference the temp id
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
  for (const d of drafts) {
    if (d.status === "synced") continue;
    if (d.status === "syncing") continue;
    if ((d.attempts ?? 0) >= DRAFT_MAX_ATTEMPTS) continue;
    // Skip if parent job is still a local- draft. Will retry next tick
    // after the parent job syncs and rewriteJobIds updates this row.
    if (d.jobId.startsWith("local-job-")) continue;
    try {
      await syncDraftUnit(d);
    } catch {
      // already logged via bumpDraftAttempt; continue with next draft
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

    // 2) Drain photo queue (only photos whose unitId is real, not local-)
    const pending = await listPending();
    const now = Date.now();
    for (const p of pending) {
      if (
        p.status === "uploading" &&
        now - (p.capturedAt ?? 0) > STUCK_UPLOAD_THRESHOLD_MS
      ) {
        await markFailed(p.id, "Upload stuck — retrying");
      }
    }
    const fresh = await listPending();
    const drainable = fresh
      .filter((p) => p.status !== "uploading")
      .filter((p) => (p.attempts ?? 0) < 6)
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
    // Schedule retries on items that failed (back-off-style)
    for (const p of fresh.filter((x) => x.status === "failed")) {
      const ageSec = (Date.now() - p.capturedAt) / 1000;
      const backoffSec = Math.min(300, 30 * Math.pow(2, (p.attempts ?? 1) - 1));
      if (ageSec >= backoffSec) {
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
