"use client";

import { useEffect, useState } from "react";
import {
  ExternalLink,
  File as FileIcon,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Lazy-loaded Drive folder browser embedded on the admin job detail
// page. Lists every file in the job's Drive folder with thumbnails
// for images + PDFs, lightweight rows for other types. Click → opens
// in Drive in a new tab. The same files are already accessible via
// the "Google Drive" folder link, but inline thumbnails make scanning
// a job's evidence trail much faster than tabbing out.

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink: string;
  thumbnailLink: string;
  isFolder: boolean;
  isImage: boolean;
  isPdf: boolean;
}

interface Props {
  folderId: string;
  folderUrl?: string;
}

export function JobDriveFiles({ folderId, folderUrl }: Props) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/drive/list-folder?folderId=${encodeURIComponent(folderId)}`
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        files?: DriveFile[];
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      setFiles(body.files ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load");
      setFiles(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!folderId) return;
    void fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  if (!folderId) return null;

  // Group: images first (rendered as a grid), then PDFs, then other.
  const images = (files ?? []).filter((f) => f.isImage);
  const docs = (files ?? []).filter((f) => f.isPdf);
  const other = (files ?? []).filter(
    (f) => !f.isImage && !f.isPdf && !f.isFolder
  );
  const folders = (files ?? []).filter((f) => f.isFolder);

  return (
    <section className="rounded-2xl bg-white border border-mse-light shadow-card overflow-hidden">
      <header className="px-4 py-3 border-b border-mse-light/70 flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-[#4285F4] shrink-0" />
        <h2 className="font-bold text-mse-navy flex-1 min-w-0">
          Drive folder
        </h2>
        {files && (
          <span className="text-xs text-mse-muted">
            {files.length} item{files.length === 1 ? "" : "s"}
          </span>
        )}
        <button
          type="button"
          onClick={fetchFiles}
          disabled={loading}
          className="p-1.5 rounded-md text-mse-muted hover:text-mse-navy hover:bg-mse-light"
          aria-label="Refresh"
          title="Refresh"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="w-3.5 h-3.5" />
          )}
        </button>
        {folderUrl && (
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-mse-muted hover:text-mse-navy hover:bg-mse-light/60 transition-colors"
          >
            Open in Drive
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        )}
      </header>

      <div className="p-4">
        {error && (
          <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2 mb-3">
            {error}
          </div>
        )}

        {loading && !files && (
          <div className="py-8 flex items-center justify-center text-mse-muted text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading folder…
          </div>
        )}

        {files && files.length === 0 && !loading && (
          <div className="py-6 text-center text-sm text-mse-muted">
            Folder is empty.
          </div>
        )}

        {files && files.length > 0 && (
          <div className="space-y-4">
            {folders.length > 0 && (
              <Group label={`Subfolders (${folders.length})`}>
                <ul className="space-y-1">
                  {folders.map((f) => (
                    <FileRow key={f.id} file={f} />
                  ))}
                </ul>
              </Group>
            )}

            {images.length > 0 && (
              <Group label={`Photos (${images.length})`}>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                  {images.map((f) => (
                    <ImageTile key={f.id} file={f} />
                  ))}
                </div>
              </Group>
            )}

            {docs.length > 0 && (
              <Group label={`Documents (${docs.length})`}>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {docs.map((f) => (
                    <DocTile key={f.id} file={f} />
                  ))}
                </div>
              </Group>
            )}

            {other.length > 0 && (
              <Group label={`Other (${other.length})`}>
                <ul className="space-y-1">
                  {other.map((f) => (
                    <FileRow key={f.id} file={f} />
                  ))}
                </ul>
              </Group>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] font-bold text-mse-muted mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}

function ImageTile({ file }: { file: DriveFile }) {
  return (
    <a
      href={file.webViewLink}
      target="_blank"
      rel="noopener"
      title={file.name}
      className={cn(
        "relative aspect-square rounded-lg overflow-hidden border border-mse-light bg-mse-light",
        "hover:border-mse-navy/40 active:scale-[0.97]",
        "transition-[border-color,transform] group"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photo?fileId=${encodeURIComponent(file.id)}&w=320`}
        alt={file.name}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-6 px-1.5 pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="text-white text-[10px] font-bold truncate">
          {file.name}
        </div>
      </div>
    </a>
  );
}

function DocTile({ file }: { file: DriveFile }) {
  return (
    <a
      href={file.webViewLink}
      target="_blank"
      rel="noopener"
      title={file.name}
      className={cn(
        "block rounded-xl border-2 border-mse-light bg-white p-3",
        "hover:border-mse-navy/30 active:scale-[0.98]",
        "transition-[border-color,transform]"
      )}
    >
      <div className="flex items-start gap-2">
        <div className="w-10 h-10 rounded-lg bg-[#E53935]/8 ring-1 ring-inset ring-[#E53935]/20 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-[#E53935]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-mse-navy truncate">
            {file.name}
          </div>
          <div className="text-[10px] text-mse-muted mt-0.5">
            PDF · {formatSize(file.size)} · {formatDate(file.modifiedTime)}
          </div>
        </div>
      </div>
    </a>
  );
}

function FileRow({ file }: { file: DriveFile }) {
  const Icon = file.isFolder ? FolderOpen : file.isImage ? ImageIcon : FileIcon;
  return (
    <li>
      <a
        href={file.webViewLink}
        target="_blank"
        rel="noopener"
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-mse-light/60 transition-colors text-sm"
      >
        <Icon
          className={cn(
            "w-4 h-4 shrink-0",
            file.isFolder ? "text-[#4285F4]" : "text-mse-muted"
          )}
        />
        <span className="text-mse-navy truncate flex-1">{file.name}</span>
        <span className="text-[10px] text-mse-muted shrink-0">
          {formatDate(file.modifiedTime)}
        </span>
        <ExternalLink className="w-3 h-3 text-mse-muted shrink-0" />
      </a>
    </li>
  );
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
