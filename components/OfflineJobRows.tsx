"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  CloudUpload,
  MapPin,
} from "lucide-react";
import { useDraftJobs } from "@/hooks/useDraftJobs";
import type { DraftJob } from "@/lib/upload-queue";

/**
 * Renders any offline-only draft jobs above the server-rendered jobs
 * list. Once a draft syncs, the hook removes it from IDB and triggers
 * router.refresh so the real row takes its place.
 */
export function OfflineJobRows() {
  const drafts = useDraftJobs();
  if (drafts.length === 0) return null;
  return (
    <ul className="space-y-2 mb-2">
      {drafts.map((d) => (
        <li key={d.id}>
          <a
            href={`/jobs/${encodeURIComponent(d.id)}`}
            className="block bg-white rounded-2xl border border-mse-light p-4 shadow-card hover:shadow-elevated active:scale-[0.99] transition-[transform,box-shadow]"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-mse-navy truncate flex items-center gap-2">
                  <span className="truncate">{d.customerName}</span>
                  <DraftBadge status={d.status} />
                </div>
                {d.siteAddress && (
                  <div className="text-sm text-mse-muted truncate flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {d.siteAddress}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-mse-navy/10 text-mse-navy">
                    {d.utilityTerritory}
                  </span>
                  <SyncStatusText draft={d} />
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-mse-muted shrink-0 mt-1" />
            </div>
          </a>
        </li>
      ))}
    </ul>
  );
}

function DraftBadge({ status }: { status: DraftJob["status"] }) {
  switch (status) {
    case "synced":
      return (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-mse-gold/15 text-mse-navy shrink-0 inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> synced
        </span>
      );
    case "syncing":
      return (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-mse-navy/10 text-mse-navy shrink-0 inline-flex items-center gap-1">
          <CloudUpload className="w-2.5 h-2.5 animate-pulse" /> syncing
        </span>
      );
    case "failed":
      return (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-mse-red/10 text-mse-red shrink-0 inline-flex items-center gap-1">
          <AlertTriangle className="w-2.5 h-2.5" /> retry
        </span>
      );
    default:
      return (
        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-mse-gold/15 text-mse-navy shrink-0 inline-flex items-center gap-1">
          <CloudOff className="w-2.5 h-2.5" /> offline
        </span>
      );
  }
}

function SyncStatusText({ draft }: { draft: DraftJob }) {
  switch (draft.status) {
    case "synced":
      return (
        <span className="text-xs text-mse-gold font-semibold">
          synced — refreshing
        </span>
      );
    case "syncing":
      return <span className="text-xs text-mse-navy font-semibold">syncing now…</span>;
    case "failed":
      return (
        <span
          className="text-xs text-mse-red font-semibold truncate"
          title={draft.lastError}
        >
          {draft.lastError ?? "sync failed — will retry"}
        </span>
      );
    default:
      return (
        <span className="text-xs text-mse-muted">
          saved offline · syncs when online
        </span>
      );
  }
}
