"use client";

import { CloudOff, CloudUpload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useDraftUnits } from "@/hooks/useDraftUnits";
import { cn } from "@/lib/utils";
import type { DraftUnit } from "@/lib/upload-queue";

/**
 * Renders the entire "Units" section, including its header. The header
 * only appears if there are either server-rendered units or local drafts
 * to show. Lets the JobDetail page show no header on a fresh empty job
 * while still showing one as soon as the tech creates anything (online
 * or offline).
 */
export function UnitsSection({
  jobId,
  hasServerUnits,
  children,
}: {
  jobId: string;
  hasServerUnits: boolean;
  children: React.ReactNode;
}) {
  const drafts = useDraftUnits(jobId);
  if (!hasServerUnits && drafts.length === 0) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2">
        Units
      </h3>
      <ul className="space-y-2">
        {children}
        {drafts.map((d) => (
          <DraftRow key={d.id} draft={d} />
        ))}
      </ul>
    </section>
  );
}

function DraftRow({ draft }: { draft: DraftUnit }) {
  const displayName =
    draft.label?.trim() ||
    `Unit ${String(draft.fallbackUnitNumber).padStart(3, "0")}`;
  return (
    <li className="bg-white rounded-2xl border border-mse-light p-3 flex items-center gap-3 shadow-card opacity-90">
      <StatusIcon status={draft.status} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-mse-navy text-sm truncate">
          {displayName} · {draft.unitType}
        </div>
        <div className="text-xs text-mse-muted truncate">
          <StatusText draft={draft} />
        </div>
      </div>
      <div className="px-2 py-1 rounded-full text-xs font-bold bg-mse-gold/15 text-mse-navy">
        Draft
      </div>
    </li>
  );
}

function StatusIcon({ status }: { status: DraftUnit["status"] }) {
  switch (status) {
    case "synced":
      return <CheckCircle2 className="w-6 h-6 text-mse-gold shrink-0" />;
    case "syncing":
      return (
        <CloudUpload className="w-6 h-6 text-mse-navy shrink-0 animate-pulse" />
      );
    case "failed":
      return <AlertTriangle className="w-6 h-6 text-mse-red shrink-0" />;
    default:
      return <CloudOff className="w-6 h-6 text-mse-muted shrink-0" />;
  }
}

function StatusText({ draft }: { draft: DraftUnit }) {
  switch (draft.status) {
    case "synced":
      return <span className="text-mse-gold font-semibold">Synced — refreshing</span>;
    case "syncing":
      return <span className="text-mse-navy font-semibold">Syncing now…</span>;
    case "failed":
      return (
        <span
          className={cn(
            "text-mse-red font-semibold inline-flex items-center gap-1",
            "max-w-full truncate"
          )}
          title={draft.lastError}
        >
          Sync failed · {draft.lastError ?? "will retry"}
        </span>
      );
    default:
      return (
        <span className="text-mse-muted">
          Saved offline — will sync when online
        </span>
      );
  }
}
