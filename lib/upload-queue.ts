"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { PhotoSlot, UnitType, UtilityTerritory } from "@/lib/types";

const DB_NAME = "mse-field-upload-queue";
const STORE_PHOTOS = "photos";
const STORE_DRAFTS = "drafts";
const STORE_DRAFT_JOBS = "draftJobs";
const DB_VERSION = 3;

export interface QueuedPhoto {
  id: string;
  jobId: string;
  unitId: string | null;
  serviceId: string | null;
  photoSlot: PhotoSlot | "service";
  /** The photo data. Always set when returned by listAllPhotos / listPending.
   *  Internally the blob is serialized to ArrayBuffer + mimeType before
   *  hitting IndexedDB (iOS Safari refuses to structured-clone Blobs into
   *  object stores) and reconstructed on read. */
  blob: Blob;
  filename: string;
  capturedAt: number;
  attempts: number;
  lastError?: string;
  status: "pending" | "uploading" | "failed" | "uploaded";
  /** When the most recent upload attempt completed (success or failure). Used for backoff. */
  lastAttemptAt?: number;
  /** When the current upload was started. Used for stuck-detection. */
  uploadStartedAt?: number;
  /** When the photo was successfully delivered to Drive. Photos in this state
   *  are kept around as a local backup and auto-purged after 14 days. */
  uploadedAt?: number;
  /** When set, the photo will not be auto-purged regardless of age. Lets the
   *  tech "pin" a photo locally for indefinite retention. */
  retainLocally?: boolean;
}

export interface DraftUnit {
  id: string;            // local-{ts}-{rand}, used as the photo queue's unitId until sync
  jobId: string;         // may itself be a local-job- id; gets rewritten when the parent job syncs
  unitType: UnitType;
  label: string;
  make: string;
  model: string;
  serial: string;
  notes: string;
  fallbackUnitNumber: number; // best-guess next number; server reassigns at sync
  createdAt: number;
  status: "pending" | "syncing" | "synced" | "failed";
  realUnitId?: string;    // populated after server sync
  lastError?: string;
  attempts: number;
  /** When the most recent sync attempt completed. */
  lastAttemptAt?: number;
  /** When the current sync was started. Used to recover stuck "syncing" rows. */
  syncStartedAt?: number;
}

export interface DraftJob {
  id: string;             // local-job-{ts}-{rand}, used as jobId by units/photos until sync
  customerName: string;
  siteAddress: string;
  utilityTerritory: UtilityTerritory;
  selfSold: boolean;
  soldBy: string;
  createdAt: number;
  status: "pending" | "syncing" | "synced" | "failed";
  realJobId?: string;     // populated after server sync
  lastError?: string;
  attempts: number;
  /** When the most recent sync attempt completed. */
  lastAttemptAt?: number;
  /** When the current sync was started. Used to recover stuck "syncing" rows. */
  syncStartedAt?: number;
}

// === Blob-in-IndexedDB workaround =========================================
// iOS Safari (and some older WebViews) raise "Error preparing Blob/File data
// to be stored in object store" when you try to db.put() a record containing
// a Blob. Workaround: split the Blob into an ArrayBuffer + its mimeType
// before writing, and reconstruct on read. ArrayBuffer is universally
// structured-cloneable.
interface StoredPhotoShape extends Omit<QueuedPhoto, "blob"> {
  blob?: Blob;          // legacy records may still have this
  blobBuffer?: ArrayBuffer;
  blobType?: string;
}

async function serializeForStorage(
  payload: QueuedPhoto
): Promise<StoredPhotoShape> {
  const buffer = await payload.blob.arrayBuffer();
  const { blob: _omit, ...rest } = payload;
  void _omit;
  return { ...rest, blobBuffer: buffer, blobType: payload.blob.type };
}

function rehydrate(stored: StoredPhotoShape): QueuedPhoto {
  // Already in old shape (a real Blob on the record) — return as-is.
  if (stored.blob && !stored.blobBuffer) {
    return stored as unknown as QueuedPhoto;
  }
  const blob = new Blob([stored.blobBuffer ?? new ArrayBuffer(0)], {
    type: stored.blobType || "image/jpeg",
  });
  return { ...stored, blob } as QueuedPhoto;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const photos = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
          photos.createIndex("by-status", "status");
          photos.createIndex("by-job", "jobId");
        }
        if (oldVersion < 2) {
          const drafts = db.createObjectStore(STORE_DRAFTS, { keyPath: "id" });
          drafts.createIndex("by-job", "jobId");
          drafts.createIndex("by-status", "status");
        }
        if (oldVersion < 3) {
          const draftJobs = db.createObjectStore(STORE_DRAFT_JOBS, {
            keyPath: "id",
          });
          draftJobs.createIndex("by-status", "status");
        }
      },
    });
  }
  return dbPromise;
}

// === Photo queue ===

export async function enqueuePhoto(
  payload: Omit<QueuedPhoto, "attempts" | "status">
): Promise<void> {
  const db = await getDb();
  const full: QueuedPhoto = {
    ...payload,
    attempts: 0,
    status: "pending",
  };
  const stored = await serializeForStorage(full);
  await db.put(STORE_PHOTOS, stored);
}

/** Every photo in the local store, regardless of status. */
export async function listAllPhotos(): Promise<QueuedPhoto[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE_PHOTOS)) as StoredPhotoShape[];
  return all.map(rehydrate);
}

/** Photos in pending/uploading/failed states (i.e. anything not yet on Drive). */
export async function listPending(): Promise<QueuedPhoto[]> {
  const all = await listAllPhotos();
  return all.filter((p) => p.status !== "uploaded");
}

/** Photos that successfully uploaded to Drive but are still kept locally
 *  as a recovery backup. Sorted newest first. */
export async function listUploadedBackups(): Promise<QueuedPhoto[]> {
  const all = await listAllPhotos();
  return all
    .filter((p) => p.status === "uploaded")
    .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
}

/** Count of photos still trying to reach Drive. The badge in the header
 *  uses this — uploaded backups don't count, so the badge stays clean. */
export async function pendingCount(): Promise<number> {
  const list = await listPending();
  return list.length;
}

/** Total bytes used across all photo blobs in IndexedDB. Used to surface
 *  storage usage to the tech in the inspector. */
export async function localStorageUsedBytes(): Promise<number> {
  const all = await listAllPhotos();
  let bytes = 0;
  for (const p of all) bytes += p.blob.size;
  return bytes;
}

export async function markUploading(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE_PHOTOS, id);
  if (!item) return;
  await db.put(STORE_PHOTOS, {
    ...item,
    status: "uploading",
    uploadStartedAt: Date.now(),
  });
}

export async function markFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE_PHOTOS, id);
  if (!item) return;
  await db.put(STORE_PHOTOS, {
    ...item,
    status: "failed",
    attempts: (item.attempts ?? 0) + 1,
    lastError: error,
    lastAttemptAt: Date.now(),
  });
}

export async function markPending(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE_PHOTOS, id);
  if (!item) return;
  await db.put(STORE_PHOTOS, { ...item, status: "pending" });
}

/**
 * Manual force-retry — clears attempt count + error and puts the photo
 * back in pending so the worker picks it up immediately, even if it had
 * exceeded the max-attempts cap.
 */
export async function forceRetryPhoto(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE_PHOTOS, id);
  if (!item) return;
  await db.put(STORE_PHOTOS, {
    ...item,
    status: "pending",
    attempts: 0,
    lastError: undefined,
    lastAttemptAt: undefined,
    uploadStartedAt: undefined,
  });
}

export async function forceRetryAllFailedPhotos(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const all = (await tx.store.getAll()) as QueuedPhoto[];
  let n = 0;
  for (const p of all) {
    if (p.status === "failed" || (p.attempts ?? 0) >= 1) {
      await tx.store.put({
        ...p,
        status: "pending",
        attempts: 0,
        lastError: undefined,
        lastAttemptAt: undefined,
        uploadStartedAt: undefined,
      });
      n++;
    }
  }
  await tx.done;
  return n;
}

export async function removePhoto(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_PHOTOS, id);
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_PHOTOS);
}

/**
 * Mark a photo as successfully uploaded to Drive but keep its blob in
 * IndexedDB as a local backup. The auto-purge job will remove it after
 * the configured retention window unless retainLocally is set.
 */
export async function markUploaded(id: string): Promise<void> {
  const db = await getDb();
  const item = (await db.get(STORE_PHOTOS, id)) as QueuedPhoto | undefined;
  if (!item) return;
  await db.put(STORE_PHOTOS, {
    ...item,
    status: "uploaded",
    uploadedAt: Date.now(),
    lastError: undefined,
  });
}

export async function setPhotoRetention(
  id: string,
  retain: boolean
): Promise<void> {
  const db = await getDb();
  const item = (await db.get(STORE_PHOTOS, id)) as QueuedPhoto | undefined;
  if (!item) return;
  await db.put(STORE_PHOTOS, { ...item, retainLocally: retain });
}

/**
 * Remove uploaded photos older than the retention window (default 14 days).
 * Skips photos with retainLocally === true. Returns the number purged.
 */
export async function purgeOldBackups(
  retentionDays: number = 14
): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const db = await getDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const all = (await tx.store.getAll()) as QueuedPhoto[];
  let n = 0;
  for (const p of all) {
    if (p.status !== "uploaded") continue;
    if (p.retainLocally) continue;
    if ((p.uploadedAt ?? 0) > cutoff) continue;
    await tx.store.delete(p.id);
    n++;
  }
  await tx.done;
  return n;
}

/**
 * Replace the unitId on every photo currently keyed to oldId.
 * Called by the worker after a draft unit is synced and we know the real unitId.
 */
export async function rewritePhotoUnitIds(
  oldId: string,
  newId: string
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const all = (await tx.store.getAll()) as QueuedPhoto[];
  for (const p of all) {
    if (p.unitId === oldId) {
      await tx.store.put({ ...p, unitId: newId });
    }
  }
  await tx.done;
}

// === Draft units ===

export async function enqueueDraftUnit(
  payload: Omit<DraftUnit, "attempts" | "status">
): Promise<void> {
  const db = await getDb();
  await db.put(STORE_DRAFTS, { ...payload, attempts: 0, status: "pending" });
}

export async function listDraftsForJob(jobId: string): Promise<DraftUnit[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE_DRAFTS)) as DraftUnit[];
  return all.filter((d) => d.jobId === jobId);
}

export async function listAllDrafts(): Promise<DraftUnit[]> {
  const db = await getDb();
  return db.getAll(STORE_DRAFTS);
}

export async function getDraft(id: string): Promise<DraftUnit | null> {
  const db = await getDb();
  const item = (await db.get(STORE_DRAFTS, id)) as DraftUnit | undefined;
  return item ?? null;
}

export async function setDraftStatus(
  id: string,
  status: DraftUnit["status"],
  patch: Partial<DraftUnit> = {}
): Promise<void> {
  const db = await getDb();
  const item = (await db.get(STORE_DRAFTS, id)) as DraftUnit | undefined;
  if (!item) return;
  const stamped: Partial<DraftUnit> = { ...patch };
  if (status === "syncing") stamped.syncStartedAt = Date.now();
  if (status === "synced" || status === "failed") {
    stamped.lastAttemptAt = Date.now();
  }
  await db.put(STORE_DRAFTS, { ...item, ...stamped, status });
}

export async function bumpDraftAttempt(
  id: string,
  error: string
): Promise<void> {
  const db = await getDb();
  const item = (await db.get(STORE_DRAFTS, id)) as DraftUnit | undefined;
  if (!item) return;
  await db.put(STORE_DRAFTS, {
    ...item,
    status: "failed",
    attempts: (item.attempts ?? 0) + 1,
    lastError: error,
    lastAttemptAt: Date.now(),
  });
}

export async function removeDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_DRAFTS, id);
}

/** Reset every failed/exhausted draft unit back to pending so the worker
 *  picks it up on the next tick. Returns how many were reset. */
export async function forceRetryAllFailedDrafts(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(STORE_DRAFTS, "readwrite");
  const all = (await tx.store.getAll()) as DraftUnit[];
  let n = 0;
  for (const d of all) {
    if (d.status === "synced") continue;
    if (d.status === "failed" || (d.attempts ?? 0) > 0) {
      await tx.store.put({
        ...d,
        status: "pending",
        attempts: 0,
        lastError: undefined,
        lastAttemptAt: undefined,
        syncStartedAt: undefined,
      });
      n++;
    }
  }
  await tx.done;
  return n;
}

/**
 * Replace the jobId on every queued draft unit AND every queued photo
 * currently keyed to oldJobId. Called by the worker after a draft job
 * has been synced and we know the real jobId.
 */
export async function rewriteJobIds(
  oldJobId: string,
  newJobId: string
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([STORE_DRAFTS, STORE_PHOTOS], "readwrite");
  const drafts = (await tx.objectStore(STORE_DRAFTS).getAll()) as DraftUnit[];
  for (const d of drafts) {
    if (d.jobId === oldJobId) {
      await tx.objectStore(STORE_DRAFTS).put({ ...d, jobId: newJobId });
    }
  }
  const photos = (await tx.objectStore(STORE_PHOTOS).getAll()) as QueuedPhoto[];
  for (const p of photos) {
    if (p.jobId === oldJobId) {
      await tx.objectStore(STORE_PHOTOS).put({ ...p, jobId: newJobId });
    }
  }
  await tx.done;
}

// === Draft jobs ===

export async function enqueueDraftJob(
  payload: Omit<DraftJob, "attempts" | "status">
): Promise<void> {
  const db = await getDb();
  await db.put(STORE_DRAFT_JOBS, { ...payload, attempts: 0, status: "pending" });
}

export async function listAllDraftJobs(): Promise<DraftJob[]> {
  const db = await getDb();
  return db.getAll(STORE_DRAFT_JOBS);
}

export async function getDraftJob(id: string): Promise<DraftJob | null> {
  const db = await getDb();
  const item = (await db.get(STORE_DRAFT_JOBS, id)) as DraftJob | undefined;
  return item ?? null;
}

export async function setDraftJobStatus(
  id: string,
  status: DraftJob["status"],
  patch: Partial<DraftJob> = {}
): Promise<void> {
  const db = await getDb();
  const item = (await db.get(STORE_DRAFT_JOBS, id)) as DraftJob | undefined;
  if (!item) return;
  const stamped: Partial<DraftJob> = { ...patch };
  if (status === "syncing") stamped.syncStartedAt = Date.now();
  if (status === "synced" || status === "failed") {
    stamped.lastAttemptAt = Date.now();
  }
  await db.put(STORE_DRAFT_JOBS, { ...item, ...stamped, status });
}

export async function bumpDraftJobAttempt(
  id: string,
  error: string
): Promise<void> {
  const db = await getDb();
  const item = (await db.get(STORE_DRAFT_JOBS, id)) as DraftJob | undefined;
  if (!item) return;
  await db.put(STORE_DRAFT_JOBS, {
    ...item,
    status: "failed",
    attempts: (item.attempts ?? 0) + 1,
    lastError: error,
    lastAttemptAt: Date.now(),
  });
}

export async function removeDraftJob(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_DRAFT_JOBS, id);
}

/** Reset every failed/exhausted draft job back to pending. */
export async function forceRetryAllFailedDraftJobs(): Promise<number> {
  const db = await getDb();
  const tx = db.transaction(STORE_DRAFT_JOBS, "readwrite");
  const all = (await tx.store.getAll()) as DraftJob[];
  let n = 0;
  for (const d of all) {
    if (d.status === "synced") continue;
    if (d.status === "failed" || (d.attempts ?? 0) > 0) {
      await tx.store.put({
        ...d,
        status: "pending",
        attempts: 0,
        lastError: undefined,
        lastAttemptAt: undefined,
        syncStartedAt: undefined,
      });
      n++;
    }
  }
  await tx.done;
  return n;
}

/** "Try everything again" — combines force-retry of jobs, units, and
 *  photos. Returns how many of each were reset. */
export async function forceRetryEverything(): Promise<{
  jobs: number;
  units: number;
  photos: number;
}> {
  const [jobs, units, photos] = await Promise.all([
    forceRetryAllFailedDraftJobs(),
    forceRetryAllFailedDrafts(),
    forceRetryAllFailedPhotos(),
  ]);
  return { jobs, units, photos };
}
