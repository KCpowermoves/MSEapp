"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { PhotoSlot } from "@/lib/types";

const DB_NAME = "mse-field-upload-queue";
const STORE = "photos";
const DB_VERSION = 1;

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

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("by-status", "status");
          store.createIndex("by-job", "jobId");
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueuePhoto(
  payload: Omit<QueuedPhoto, "attempts" | "status">
): Promise<void> {
  const db = await getDb();
  await db.put(STORE, { ...payload, attempts: 0, status: "pending" });
}

export async function listPending(): Promise<QueuedPhoto[]> {
  const db = await getDb();
  return db.getAll(STORE);
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE);
}

export async function markUploading(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE, id);
  if (!item) return;
  await db.put(STORE, { ...item, status: "uploading" });
}

export async function markFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE, id);
  if (!item) return;
  await db.put(STORE, {
    ...item,
    status: "failed",
    attempts: (item.attempts ?? 0) + 1,
    lastError: error,
  });
}

export async function markPending(id: string): Promise<void> {
  const db = await getDb();
  const item = await db.get(STORE, id);
  if (!item) return;
  await db.put(STORE, { ...item, status: "pending" });
}

export async function removePhoto(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}
