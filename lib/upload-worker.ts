"use client";

import {
  listPending,
  markFailed,
  markPending,
  markUploading,
  removePhoto,
  type QueuedPhoto,
} from "@/lib/upload-queue";

const POLL_MS = 5000;
const MAX_CONCURRENCY = 1;

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

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
  const res = await fetch("/api/upload", { method: "POST", body: formData });
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
}

async function tick() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    schedule();
    return;
  }
  try {
    const pending = await listPending();
    const drainable = pending
      .filter((p) => p.status !== "uploading")
      .filter((p) => (p.attempts ?? 0) < 6)
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
    for (const p of pending.filter((x) => x.status === "failed")) {
      const ageSec = (Date.now() - p.capturedAt) / 1000;
      const backoffSec = Math.min(300, 30 * Math.pow(2, (p.attempts ?? 1) - 1));
      if (ageSec >= backoffSec) {
        await markPending(p.id);
      }
    }
  } catch (e) {
    // swallow — try again next tick
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
