"use client";

import { useState } from "react";
import { CloudUpload, AlertTriangle, Trash2 } from "lucide-react";
import { usePendingCount, usePendingList } from "@/hooks/useUploadQueue";
import { removePhoto } from "@/lib/upload-queue";
import { cn } from "@/lib/utils";

export function PendingBadge() {
  const count = usePendingCount();
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 px-3 h-9 rounded-full",
          "bg-mse-gold/15 text-mse-gold border border-mse-gold/30",
          "text-sm font-medium",
          "hover:bg-mse-gold/20 active:scale-95 transition-[transform,background-color]"
        )}
      >
        <CloudUpload className="w-4 h-4" />
        <span>{count} pending</span>
      </button>
      {open && <QueueInspector onClose={() => setOpen(false)} />}
    </>
  );
}

function QueueInspector({ onClose }: { onClose: () => void }) {
  const items = usePendingList();
  return (
    <div
      className="fixed inset-0 z-50 bg-mse-navy/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-elevated max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-mse-light p-4 flex items-center justify-between">
          <h2 className="font-bold text-mse-navy">Pending uploads</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-mse-muted hover:text-mse-navy"
          >
            Close
          </button>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center text-mse-muted text-sm">
            All photos uploaded.
          </div>
        ) : (
          <ul className="divide-y divide-mse-light">
            {items.map((p) => (
              <li key={p.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate text-mse-navy">
                    {p.filename}
                  </div>
                  <div className="text-xs text-mse-muted">
                    {p.status === "failed" ? (
                      <span className="text-mse-red flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {p.lastError ?? "Upload failed"} · attempt {p.attempts}
                      </span>
                    ) : (
                      <>{ageLabel(p.capturedAt)}</>
                    )}
                  </div>
                </div>
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
      </div>
    </div>
  );
}

function ageLabel(t: number): string {
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}
