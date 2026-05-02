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
  blob: Blob;
  filename: string;
  capturedAt: number;
  attempts: number;
  lastError?: string;
  status: "pending" | "uploading" | "failed";
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
  await db.put(STORE_PHOTOS, { ...payload, attempts: 0, status: "pending" });
}

export async function listPending(): Promise<QueuedPhoto[]> {
  const db = await getDb();
  return db.getAll(STORE_PHOTOS);
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE_PHOTOS);
}

export async function markUploading(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE_PHOTOS, id);
  if (!item) return;
  await db.put(STORE_PHOTOS, { ...item, status: "uploading" });
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
  });
}

export async function markPending(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE_PHOTOS, id);
  if (!item) return;
  await db.put(STORE_PHOTOS, { ...item, status: "pending" });
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
  await db.put(STORE_DRAFTS, { ...item, ...patch, status });
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
  });
}

export async function removeDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_DRAFTS, id);
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
  await db.put(STORE_DRAFT_JOBS, { ...item, ...patch, status });
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
  });
}

export async function removeDraftJob(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_DRAFT_JOBS, id);
}
