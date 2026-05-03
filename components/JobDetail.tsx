"use client";

import {
  ArrowLeft,
  ExternalLink,
  FolderOpen,
  Pencil,
  Wrench,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import { useTodaysCrew } from "@/hooks/useTodaysCrew";
import { UnitsSection } from "@/components/LocalDraftRows";
import { cn } from "@/lib/utils";
import type {
  Job,
  UnitServiced,
} from "@/lib/types";

type UnitWithStatus = UnitServiced & { submitted: boolean };

interface Props {
  job: Job;
  todaysDispatchId: string | null;
  todaysUnits: UnitWithStatus[];
  activeTechs: string[];
  currentUserName: string;
}

export function JobDetail({
  job,
  todaysUnits,
  currentUserName,
}: Props) {
  useTodaysCrew(job.jobId, currentUserName);
  // Only count un-submitted units toward the Submit button — already-
  // submitted units shouldn't re-enable the submit dispatch flow.
  const pendingUnits = todaysUnits.filter((u) => !u.submitted);
  const canSubmit = pendingUnits.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <a
          href="/jobs"
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back to jobs"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-mse-navy truncate">
            {job.customerName}
          </h1>
          <div className="text-sm text-mse-muted truncate">{job.siteAddress}</div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <TerritoryPill territory={job.utilityTerritory} />
            {job.selfSold && job.soldBy && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-mse-gold/15 text-mse-navy">
                Self-sold · {job.soldBy}
              </span>
            )}
            <span className="text-xs text-mse-muted font-mono">{job.jobId}</span>
          </div>
        </div>
        <a
          href={`/jobs/${encodeURIComponent(job.jobId)}/edit`}
          className="p-2 text-mse-muted hover:text-mse-navy"
          aria-label="Edit job"
        >
          <Pencil className="w-4 h-4" />
        </a>
        {job.driveFolderUrl && (
          <a
            href={job.driveFolderUrl}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-mse-muted hover:text-mse-navy hover:bg-mse-light/60 transition-colors text-xs font-semibold shrink-0"
            aria-label="Open Google Drive folder"
          >
            <FolderOpen className="w-4 h-4 text-[#4285F4]" />
            <span className="hidden sm:inline">Google Drive</span>
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <a
          href={`/jobs/${encodeURIComponent(job.jobId)}/units/new`}
          className="rounded-2xl bg-mse-navy hover:bg-mse-navy-soft active:scale-[0.98] transition-[background-color,transform] p-5 flex items-center justify-center gap-2 shadow-elevated text-white"
        >
          <Wrench className="w-6 h-6" />
          <span className="font-bold text-lg">Add unit</span>
        </a>
      </div>

      <UnitsSection jobId={job.jobId} hasServerUnits={todaysUnits.length > 0}>
        {todaysUnits.map((u) => (
          <UnitRow key={u.unitId} unit={u} jobId={job.jobId} />
        ))}
      </UnitsSection>

      <a
        href={`/jobs/${encodeURIComponent(job.jobId)}/submit`}
        aria-disabled={!canSubmit}
        onClick={(e) => {
          if (!canSubmit) e.preventDefault();
        }}
        className={cn(
          "block w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
          canSubmit
            ? "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
            : "bg-mse-light text-mse-muted cursor-not-allowed"
        )}
      >
        Submit job
      </a>
    </div>
  );
}

const SIMPLE_TYPES = ["PTAC / Ductless"];

function UnitRow({
  unit,
  jobId,
}: {
  unit: UnitServiced & { submitted: boolean };
  jobId: string;
}) {
  const required: string[] = SIMPLE_TYPES.includes(unit.unitType)
    ? [unit.pre1Url, unit.pre2Url, unit.nameplateUrl]
    : unit.unitType === "Split System"
    ? [
        unit.pre1Url, unit.pre2Url, unit.pre3Url,
        unit.post1Url, unit.post2Url, unit.post3Url,
        unit.nameplateUrl, unit.filterUrl,
        unit.inPreUrl, unit.inPostUrl, unit.inNameplateUrl,
      ]
    : // RTU types
      [unit.pre1Url, unit.pre2Url, unit.post1Url, unit.post2Url,
       unit.nameplateUrl, unit.filterUrl, unit.pre3Url];
  const requiredFilled = required.filter(Boolean).length;
  const requiredCount = required.length;
  const allUploaded = requiredFilled === requiredCount;
  const displayName = unit.label?.trim()
    ? unit.label
    : `Unit ${String(unit.unitNumberOnJob).padStart(3, "0")}`;
  return (
    <li
      className={cn(
        "bg-white rounded-2xl border border-mse-light p-3 flex items-center gap-3 shadow-card",
        unit.submitted && "opacity-70"
      )}
    >
      {allUploaded ? (
        <CheckCircle2 className="w-6 h-6 text-mse-gold shrink-0" />
      ) : (
        <CircleDashed className="w-6 h-6 text-mse-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-mse-navy text-sm truncate flex items-center gap-2">
          <span className="truncate">
            {displayName} · {unit.unitType}
          </span>
          {unit.submitted && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-mse-navy/10 text-mse-navy shrink-0">
              Submitted
            </span>
          )}
        </div>
        {unit.make && (
          <div className="text-xs text-mse-muted truncate">{unit.make}</div>
        )}
      </div>
      <div
        className={cn(
          "px-2 py-1 rounded-full text-xs font-bold",
          allUploaded ? "bg-mse-gold/15 text-mse-navy" : "bg-mse-light text-mse-muted"
        )}
      >
        {requiredFilled}/{requiredCount}
      </div>
      <a
        href={`/jobs/${encodeURIComponent(jobId)}/units/${encodeURIComponent(unit.unitId)}/edit`}
        className="p-1.5 text-mse-muted hover:text-mse-navy"
        aria-label="Edit unit"
      >
        <Pencil className="w-4 h-4" />
      </a>
    </li>
  );
}

function TerritoryPill({ territory }: { territory: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-mse-navy/10 text-mse-navy">
      {territory}
    </span>
  );
}

