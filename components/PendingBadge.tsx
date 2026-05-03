"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  HardDrive,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  useLocalBackups,
  usePendingCount,
  usePendingList,
} from "@/hooks/useUploadQueue";
import {
  forceRetryAllFailedPhotos,
  forceRetryPhoto,
  removePhoto,
  setPhotoRetention,
} from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { cn } from "@/lib/utils";

export function PendingBadge() {
  const pending = usePendingCount();
  const { items: backups } = useLocalBackups();
  const [open, setOpen] = useState(false);

  // Show nothing if there's no queue activity AND no local backup.
  if (pending === 0 && backups.length === 0) return null;

  const hasPending = pending > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-medium",
          "active:scale-95 transition-[transform,background-color]",
          hasPending
            ? "bg-mse-gold/15 text-mse-gold border border-mse-gold/30 hover:bg-mse-gold/20"
            : "bg-white/10 text-white/80 border border-white/20 hover:bg-white/15"
        )}
        aria-label={
          hasPending
            ? `${pending} pending uploads`
            : `${backups.length} photos backed up locally`
        }
      >
        {hasPending ? (
          <>
            <CloudUpload className="w-4 h-4" />
            <span>{pending} pending</span>
          </>
        ) : (
          <>
            <HardDrive className="w-4 h-4" />
            <span>{backups.length} saved</span>
          </>
        )}
      </button>
      {open && <QueueInspector onClose={() => setOpen(false)} />}
    </>
  );
}

function QueueInspector({ onClose }: { onClose: () => void }) {
  const items = usePendingList();
  const { items: backups, bytes: backupBytes } = useLocalBackups();
  const failedCount = items.filter(
    (p) => p.status === "failed" || (p.attempts ?? 0) > 0
  ).length;

  const retryAll = async () => {
    await forceRetryAllFailedPhotos();
    kickWorker();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-mse-navy/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-elevated max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-mse-light p-4 flex items-center justify-between gap-2">
          <h2 className="font-bold text-mse-navy">Pending uploads</h2>
          <div className="flex items-center gap-2">
            {failedCount > 0 && (
              <button
                type="button"
                onClick={retryAll}
                className="text-xs font-semibold text-mse-navy bg-mse-gold/15 hover:bg-mse-gold/25 px-3 py-1.5 rounded-lg flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                Retry all
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-mse-muted hover:text-mse-navy"
            >
              Close
            </button>
          </div>
        </div>
        {items.length === 0 && backups.length === 0 ? (
          <div className="p-8 text-center text-mse-muted text-sm">
            No photos in the local queue or backup.
          </div>
        ) : (
          <>
            {items.length > 0 && (
              <ul className="divide-y divide-mse-light">
                {items.map((p) => (
                  <li key={p.id} className="p-4 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate text-mse-navy">
                        {p.filename}
                      </div>
                      <div className="text-xs text-mse-muted">
                        {p.status === "failed" ? (
                          <span className="text-mse-red flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span className="truncate" title={p.lastError}>
                              {p.lastError ?? "Upload failed"} · attempt{" "}
                              {p.attempts}
                            </span>
                          </span>
                        ) : p.status === "uploading" ? (
                          <span className="text-mse-navy font-semibold">
                            Uploading…
                          </span>
                        ) : (
                          <>{ageLabel(p.capturedAt)}</>
                        )}
                      </div>
                    </div>
                    {(p.status === "failed" || (p.attempts ?? 0) > 0) && (
                      <button
                        type="button"
                        onClick={async () => {
                          await forceRetryPhoto(p.id);
                          kickWorker();
                        }}
                        aria-label="Retry now"
                        className="p-2 text-mse-muted hover:text-mse-navy"
                        title="Retry now"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      aria-label="Remove from queue"
                      className="p-2 text-mse-muted hover:text-mse-red"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {backups.length > 0 && (
              <>
                <div className="px-4 pt-4 pb-2 bg-mse-light/30 border-y border-mse-light flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-mse-navy uppercase tracking-wide flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-mse-gold" />
                      Backed up locally
                    </div>
                    <div className="text-[11px] text-mse-muted mt-0.5">
                      {backups.length} photo{backups.length === 1 ? "" : "s"} ·{" "}
                      {formatBytes(backupBytes)} · auto-purges after 14 days
                    </div>
                  </div>
                </div>
                <ul className="divide-y divide-mse-light">
                  {backups.map((p) => (
                    <li
                      key={p.id}
                      className="p-3 flex items-center gap-2 bg-mse-light/10"
                    >
                      <CheckCircle2 className="w-4 h-4 text-mse-gold shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-xs truncate text-mse-navy">
                          {p.filename}
                        </div>
                        <div className="text-[10px] text-mse-muted">
                          uploaded {p.uploadedAt ? ageLabel(p.uploadedAt) : ""}
                          {p.retainLocally && " · pinned"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPhotoRetention(p.id, !p.retainLocally)
                        }
                        aria-label={
                          p.retainLocally
                            ? "Stop saving forever (will auto-purge)"
                            : "Save forever (skip auto-purge)"
                        }
                        title={
                          p.retainLocally
                            ? "Saved forever — won't auto-purge. Tap to release."
                            : "Save forever — keep beyond the 14-day window."
                        }
                        className={cn(
                          "p-2 transition-colors",
                          p.retainLocally
                            ? "text-mse-navy"
                            : "text-mse-muted hover:text-mse-navy"
                        )}
                      >
                        <Save
                          className={cn(
                            "w-3.5 h-3.5",
                            p.retainLocally && "fill-mse-navy/15"
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        aria-label="Delete local copy"
                        title="Delete local copy (Drive copy is unaffected)"
                        className="p-2 text-mse-muted hover:text-mse-red"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ageLabel(t: number): string {
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
