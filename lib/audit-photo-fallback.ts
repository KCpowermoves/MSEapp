"use client";

import { enqueuePhoto } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";

/** Thrown when the server actively rejected the upload (4xx). Retrying
 *  the same bytes can't succeed, so these are NOT queued. */
export class UploadRejectedError extends Error {}

/**
 * Upload an audit photo directly, falling back to the IndexedDB queue
 * when the network or server flakes. Audit photos used to be
 * fire-and-forget — any timeout or 5xx silently lost the photo. Now a
 * failed direct attempt lands in the same retry queue unit photos use.
 *
 * Returns the Drive URL on a direct success, or `{ url: null,
 * queued: true }` when the photo was queued for background upload.
 */
export async function uploadAuditPhotoWithFallback(opts: {
  file: File;
  jobId: string;
  kind: "audit-building" | "audit-item";
  auditId?: string;
  itemId?: string;
  slot: string;
}): Promise<{ url: string | null; queued: boolean }> {
  const fd = new FormData();
  fd.append("file", opts.file);
  fd.append("jobId", opts.jobId);
  if (opts.auditId) fd.append("auditId", opts.auditId);
  if (opts.itemId) fd.append("itemId", opts.itemId);
  fd.append("kind", opts.kind);
  fd.append("slot", opts.slot);

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 45_000);
    let res: Response;
    try {
      res = await fetch("/api/upload", {
        method: "POST",
        body: fd,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const body = (await res.json().catch(() => ({}))) as {
      url?: string;
      error?: string;
    };
    if (res.ok && body.url) return { url: body.url, queued: false };
    if (res.status >= 400 && res.status < 500) {
      throw new UploadRejectedError(
        body.error ?? `Upload rejected (${res.status})`
      );
    }
    // 5xx / malformed response — fall through to the queue.
  } catch (e) {
    if (e instanceof UploadRejectedError) throw e;
    // Network error / timeout — fall through to the queue.
  }

  await enqueuePhoto({
    id: `${opts.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: opts.jobId,
    unitId: null,
    serviceId: null,
    photoSlot: opts.slot,
    kind: opts.kind,
    auditId: opts.auditId,
    itemId: opts.itemId,
    blob: opts.file,
    filename: opts.file.name || `${opts.slot}-${Date.now()}.jpg`,
    capturedAt: Date.now(),
  });
  kickWorker();
  return { url: null, queued: true };
}
