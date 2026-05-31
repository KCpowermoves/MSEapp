import { Readable } from "stream";
import { env } from "@/lib/env";
import { getDriveClient } from "@/lib/google/auth";

export interface CreatedFolder {
  id: string;
  url: string;
}

export interface UploadedFile {
  id: string;
  url: string;
}

export async function createFolder(
  name: string,
  parentId: string
): Promise<CreatedFolder> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });
  const id = res.data.id!;
  await ensureAnyoneCanView(id);
  return { id, url: res.data.webViewLink ?? folderUrl(id) };
}

export async function getOrCreateFolder(
  name: string,
  parentId: string
): Promise<CreatedFolder> {
  const drive = getDriveClient();
  const escapedName = name.replace(/'/g, "\\'");
  const q = `name='${escapedName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({
    q,
    fields: "files(id, webViewLink)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = list.data.files?.[0];
  if (existing?.id) {
    return {
      id: existing.id,
      url: existing.webViewLink ?? folderUrl(existing.id),
    };
  }
  return createFolder(name, parentId);
}

export async function uploadImage(opts: {
  folderId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
}): Promise<UploadedFile> {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name: opts.filename,
      parents: [opts.folderId],
    },
    media: {
      mimeType: opts.mimeType,
      body: Readable.from(opts.body),
    },
    fields: "id, webViewLink, webContentLink",
    supportsAllDrives: true,
  });
  const id = res.data.id!;
  await ensureAnyoneCanView(id);
  return { id, url: res.data.webViewLink ?? fileUrl(id) };
}

/** Upload a PDF (or any binary) to a Drive folder. */
export async function uploadFile(opts: {
  folderId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
}): Promise<UploadedFile> {
  // Same shape as uploadImage — kept as a separate name for clarity.
  return uploadImage(opts);
}

async function ensureAnyoneCanView(fileId: string): Promise<void> {
  const drive = getDriveClient();
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { type: "anyone", role: "reader" },
      supportsAllDrives: true,
    });
  } catch {
    // permission may already exist; ignore
  }
}

export function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function fileUrl(id: string): string {
  return `https://drive.google.com/file/d/${id}/view`;
}

export interface DriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink: string;
  // Drive returns short-lived signed thumbnail URLs that work without
  // auth for world-readable files. Stable enough for a few hours of
  // client-side caching.
  thumbnailLink: string;
  isFolder: boolean;
  isImage: boolean;
  isPdf: boolean;
}

/**
 * List the immediate children of a Drive folder, sorted newest first.
 * Returns at most `pageSize` files (default 200). Filters out trashed
 * items. Safe for shared-drive folders.
 */
export async function listFolderFiles(
  folderId: string,
  opts: { pageSize?: number } = {}
): Promise<DriveFileSummary[]> {
  if (!folderId) return [];
  const drive = getDriveClient();
  const q = `'${folderId}' in parents and trashed = false`;
  const res = await drive.files.list({
    q,
    fields:
      "files(id, name, mimeType, size, modifiedTime, webViewLink, thumbnailLink)",
    orderBy: "modifiedTime desc",
    pageSize: Math.min(opts.pageSize ?? 200, 1000),
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = res.data.files ?? [];
  return files
    .filter((f) => Boolean(f.id))
    .map((f) => {
      const mt = f.mimeType ?? "";
      return {
        id: f.id!,
        name: f.name ?? "(untitled)",
        mimeType: mt,
        size: Number(f.size ?? 0) || 0,
        modifiedTime: f.modifiedTime ?? "",
        webViewLink: f.webViewLink ?? fileUrl(f.id!),
        thumbnailLink: f.thumbnailLink ?? "",
        isFolder: mt === "application/vnd.google-apps.folder",
        isImage: mt.startsWith("image/"),
        isPdf: mt === "application/pdf",
      };
    });
}

export function getRootFolderId(): string {
  return env.googleDriveRootFolderId();
}

export function shortAddress(address: string, maxLen = 30): string {
  return address
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen);
}

export function jobFolderName(opts: {
  customerName: string;
  siteAddress: string;
  createdDate: Date;
}): string {
  const dateStr = opts.createdDate.toISOString().slice(0, 10);
  const cust = opts.customerName.replace(/[^a-zA-Z0-9 ]+/g, "").trim();
  const addr = shortAddress(opts.siteAddress);
  return addr ? `${dateStr}_${cust}_${addr}` : `${dateStr}_${cust}`;
}

