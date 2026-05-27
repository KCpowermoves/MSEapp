"use client";

import {
  ArrowLeft,
  ExternalLink,
  FileText,
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

interface SubmittedToday {
  dispatchId: string;
  hasSignature: boolean;
  reportPdfUrl: string;
}

interface Props {
  job: Job;
  todaysDispatchId: string | null;
  todaysUnits: UnitWithStatus[];
  submittedToday: SubmittedToday | null;
  activeTechs: string[];
  currentUserName: string;
  isAdmin: boolean;
}

export function JobDetail({
  job,
  todaysUnits,
  submittedToday,
  currentUserName,
  isAdmin,
}: Props) {
  useTodaysCrew(job.jobId, currentUserName);
  // Only count un-submitted units toward the Submit button — already-
  // submitted units shouldn't re-enable the submit dispatch flow.
  const pendingUnits = todaysUnits.filter((u) => !u.submitted);
  const hasUnits = todaysUnits.length > 0;
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
        {isAdmin && job.driveFolderUrl && (
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

      {canSubmit ? (
        <a
          href={`/jobs/${encodeURIComponent(job.jobId)}/submit`}
          className={cn(
            "block w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
            "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
          )}
        >
          Submit job
        </a>
      ) : submittedToday ? (
        <section className="rounded-2xl border-2 border-mse-gold/40 bg-mse-gold/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-mse-navy font-bold">
            <CheckCircle2 className="w-5 h-5 text-mse-gold shrink-0" />
            Submitted today
          </div>
          <p className="text-sm text-mse-text leading-relaxed">
            This job was already submitted today.{" "}
            {submittedToday.reportPdfUrl
              ? "The service report is ready."
              : "The service report generates once all photos finish uploading."}
          </p>
          {submittedToday.reportPdfUrl && (
            <a
              href={submittedToday.reportPdfUrl}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-center gap-1.5 text-sm font-semibold text-mse-navy hover:underline"
            >
              <FileText className="w-4 h-4" />
              View service report
            </a>
          )}
          <p className="text-xs text-mse-muted">
            Did more work? Tap <span className="font-semibold">Add unit</span>{" "}
            above — it starts a fresh submission for the extra units.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border-2 border-dashed border-mse-light p-5 text-center">
          <p className="text-sm text-mse-muted">
            {hasUnits
              ? "Nothing left to submit on this job right now."
              : "Add at least one unit, then you can submit the job."}
          </p>
        </section>
      )}
    </div>
  );
}

// Photo-checklist sources per unit type. Drives the "X/Y photos" chip
// on each unit row. Mirrors requiredPhotoSlots in lib/data/units.ts.
function requiredUrlsForType(u: UnitServiced): string[] {
  if (u.unitType === "PTAC / Ductless") {
    return [u.pre1Url, u.pre2Url, u.nameplateUrl];
  }
  if (u.unitType === "Outdoor Split System") {
    return [
      u.pre1Url, u.pre2Url, u.pre3Url,
      u.post1Url, u.post2Url, u.post3Url,
      u.nameplateUrl, u.filterUrl,
    ];
  }
  if (u.unitType === "Indoor Split System") {
    return [u.inPreUrl, u.inPostUrl, u.inNameplateUrl, u.filterUrl];
  }
  if (u.unitType === "Split System") {
    return [
      u.pre1Url, u.pre2Url, u.pre3Url,
      u.post1Url, u.post2Url, u.post3Url,
      u.nameplateUrl, u.filterUrl,
      u.inPreUrl, u.inPostUrl, u.inNameplateUrl,
    ];
  }
  // RTU-S/M/L
  return [
    u.pre1Url, u.pre2Url, u.post1Url, u.post2Url,
    u.nameplateUrl, u.filterUrl, u.pre3Url,
  ];
}

function UnitRow({
  unit,
  jobId,
}: {
  unit: UnitServiced & { submitted: boolean };
  jobId: string;
}) {
  const required: string[] = requiredUrlsForType(unit);
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

