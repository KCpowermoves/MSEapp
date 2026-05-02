"use client";

import {
  bumpDraftAttempt,
  listAllDrafts,
  listPending,
  markFailed,
  markPending,
  markUploading,
  removePhoto,
  rewritePhotoUnitIds,
  setDraftStatus,
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
    // 1) Sync any pending draft units first — photos for those drafts
    //    can't upload until the unit row exists server-side and we know
    //    the real unitId.
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
      // skip photos still pointing at an unsynced draft — next tick will pick
      // them up after the draft syncs
      .filter((p) => !p.unitId || !p.unitId.startsWith("local-"))
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
