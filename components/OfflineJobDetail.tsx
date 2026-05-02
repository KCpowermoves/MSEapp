"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CloudOff,
  CloudUpload,
  AlertTriangle,
  CheckCircle2,
  Wrench,
} from "lucide-react";
import { useDraftUnits } from "@/hooks/useDraftUnits";
import { getDraftJob, type DraftJob } from "@/lib/upload-queue";
import { cn } from "@/lib/utils";

/**
 * Renders a job-detail screen for an offline draft job (jobId starts
 * with "local-job-"). The job row doesn't exist server-side yet — the
 * background worker will sync it and then redirect via router.refresh.
 *
 * Add Unit links to /jobs/[localJobId]/units/new which itself routes
 * through the offline-aware add-unit shell so the unit drafts get
 * keyed against this local jobId until the parent syncs.
 */
export function OfflineJobDetail({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<DraftJob | null>(null);
  const [loaded, setLoaded] = useState(false);
  const drafts = useDraftUnits(jobId);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const j = await getDraftJob(jobId).catch(() => null);
      if (!cancelled) {
        setJob(j);
        setLoaded(true);
        // If the job has been synced, the worker will have stamped
        // realJobId; redirect there so the user sees the real version.
        if (j?.status === "synced" && j.realJobId) {
          window.location.replace(
            `/jobs/${encodeURIComponent(j.realJobId)}`
          );
        }
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [jobId]);

  if (!loaded) return null;

  if (!job) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.assign("/jobs")}
            className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
            aria-label="Back to jobs"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-mse-navy">Offline draft</h1>
        </div>
        <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center">
          <p className="text-mse-muted">
            This offline draft is no longer on this device.
          </p>
          <p className="text-xs text-mse-muted mt-1">
            It may have synced and the real job opened in another tab, or it
            was created on a different device.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => window.location.assign("/jobs")}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back to jobs"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-mse-navy truncate">
            {job.customerName}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <TerritoryPill territory={job.utilityTerritory} />
            {job.selfSold && job.soldBy && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-mse-gold/15 text-mse-navy">
                Self-sold · {job.soldBy}
              </span>
            )}
            <span className="text-xs text-mse-muted font-mono">
              offline draft
            </span>
          </div>
        </div>
      </div>

      <SyncBanner job={job} />

      <div className="grid grid-cols-1 gap-3">
        <a
          href={`/jobs/${encodeURIComponent(jobId)}/units/new`}
          className="rounded-2xl bg-mse-navy hover:bg-mse-navy-soft active:scale-[0.98] transition-[background-color,transform] p-5 flex items-center justify-center gap-2 shadow-elevated text-white"
        >
          <Wrench className="w-6 h-6" />
          <span className="font-bold text-lg">Add unit</span>
        </a>
      </div>

      {drafts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2">
            Units
          </h3>
          <ul className="space-y-2">
            {drafts.map((d) => {
              const displayName =
                d.label?.trim() ||
                `Unit ${String(d.fallbackUnitNumber).padStart(3, "0")}`;
              return (
                <li
                  key={d.id}
                  className="bg-white rounded-2xl border border-mse-light p-3 flex items-center gap-3 shadow-card"
                >
                  <CloudOff className="w-6 h-6 text-mse-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-mse-navy text-sm truncate">
                      {displayName} · {d.unitType}
                    </div>
                    <div className="text-xs text-mse-muted truncate">
                      Saved offline — syncs when online
                    </div>
                  </div>
                  <div className="px-2 py-1 rounded-full text-xs font-bold bg-mse-gold/15 text-mse-navy">
                    Draft
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SyncBanner({ job }: { job: DraftJob }) {
  switch (job.status) {
    case "synced":
      return (
        <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-4 py-3 text-sm text-mse-navy flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-mse-gold shrink-0" />
          <span>Synced — redirecting to the real job…</span>
        </div>
      );
    case "syncing":
      return (
        <div className="rounded-xl bg-mse-navy/10 border border-mse-navy/20 px-4 py-3 text-sm text-mse-navy flex items-center gap-2">
          <CloudUpload className="w-5 h-5 text-mse-navy animate-pulse shrink-0" />
          <span>Syncing job…</span>
        </div>
      );
    case "failed":
      return (
        <div className="rounded-xl bg-mse-red/10 border border-mse-red/20 px-4 py-3 text-sm text-mse-red flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>
            Sync failed — {job.lastError ?? "will retry automatically"}.
          </span>
        </div>
      );
    default:
      return (
        <div className="rounded-xl bg-mse-gold/15 border border-mse-gold/30 px-4 py-3 text-sm text-mse-navy flex items-center gap-2">
          <CloudOff className="w-5 h-5 text-mse-muted shrink-0" />
          <span>
            Saved offline — will sync the moment you&apos;re back online.
          </span>
        </div>
      );
  }
}

function TerritoryPill({ territory }: { territory: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-mse-navy/10 text-mse-navy">
      {territory}
    </span>
  );
}
