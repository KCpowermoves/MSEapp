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
  return `${dateStr}_${cust}_${addr}`;
}

export function unitFolderName(unitNumber: number, unitType: string): string {
  const numStr = unitNumber.toString().padStart(3, "0");
  const safeType = unitType.replace(/[^a-zA-Z0-9-]+/g, "_");
  return `Unit-${numStr}_${safeType}`;
}
