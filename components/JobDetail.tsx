"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Wrench,
  Lightbulb,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import { useTodaysCrew } from "@/hooks/useTodaysCrew";
import { cn } from "@/lib/utils";
import type {
  AdditionalService,
  Job,
  UnitServiced,
} from "@/lib/types";

interface Props {
  job: Job;
  todaysDispatchId: string | null;
  todaysUnits: UnitServiced[];
  todaysServices: AdditionalService[];
  activeTechs: string[];
  currentUserName: string;
}

export function JobDetail({
  job,
  todaysUnits,
  todaysServices,
  activeTechs,
  currentUserName,
}: Props) {
  // Hook still runs to seed localStorage with the logged-in tech for
  // the AddUnit / Submit flows downstream — even though we no longer
  // show a crew picker on this page.
  useTodaysCrew(job.jobId, currentUserName);
  const canSubmit = todaysUnits.length > 0 || todaysServices.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <Link
          href="/jobs"
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back to jobs"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
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
        {job.driveFolderUrl && (
          <a
            href={job.driveFolderUrl}
            target="_blank"
            rel="noopener"
            className="p-2 text-mse-muted hover:text-mse-navy"
            aria-label="Open Drive folder"
          >
            <ExternalLink className="w-5 h-5" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}/units/new`}
          className="rounded-2xl bg-white border-2 border-mse-light hover:border-mse-navy/40 active:scale-[0.98] transition-[border-color,transform] p-4 flex flex-col items-center gap-2 shadow-card"
        >
          <Wrench className="w-6 h-6 text-mse-navy" />
          <span className="font-bold text-mse-navy">Add unit</span>
        </Link>
        <Link
          href={`/jobs/${encodeURIComponent(job.jobId)}/services/new`}
          className="rounded-2xl bg-white border-2 border-mse-light hover:border-mse-navy/40 active:scale-[0.98] transition-[border-color,transform] p-4 flex flex-col items-center gap-2 shadow-card"
        >
          <Lightbulb className="w-6 h-6 text-mse-navy" />
          <span className="font-bold text-mse-navy">Add service</span>
        </Link>
      </div>

      {todaysUnits.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2">
            Today&apos;s units
          </h3>
          <ul className="space-y-2">
            {todaysUnits.map((u) => (
              <UnitRow key={u.unitId} unit={u} />
            ))}
          </ul>
        </section>
      )}

      {todaysServices.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2">
            Today&apos;s services
          </h3>
          <ul className="space-y-2">
            {todaysServices.map((s) => (
              <li
                key={s.serviceId}
                className="bg-white rounded-2xl border border-mse-light p-3 flex items-center gap-3 shadow-card"
              >
                <Lightbulb className="w-5 h-5 text-mse-navy shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-mse-navy text-sm">
                    {s.serviceType}
                  </div>
                  <div className="text-xs text-mse-muted">
                    qty {s.quantity}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
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
        Submit dispatch
      </Link>
    </div>
  );
}

function UnitRow({ unit }: { unit: UnitServiced }) {
  const required =
    unit.unitType === "PTAC"
      ? [unit.pre1Url, unit.post1Url, unit.nameplateUrl]
      : [
          unit.pre1Url,
          unit.pre2Url,
          unit.pre3Url,
          unit.post1Url,
          unit.post2Url,
          unit.post3Url,
          unit.nameplateUrl,
        ];
  const requiredFilled = required.filter(Boolean).length;
  const requiredCount = required.length;
  const allUploaded = requiredFilled === requiredCount;
  return (
    <li className="bg-white rounded-2xl border border-mse-light p-3 flex items-center gap-3 shadow-card">
      {allUploaded ? (
        <CheckCircle2 className="w-6 h-6 text-mse-gold shrink-0" />
      ) : (
        <CircleDashed className="w-6 h-6 text-mse-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-mse-navy text-sm truncate">
          Unit {String(unit.unitNumberOnJob).padStart(3, "0")} · {unit.unitType}
        </div>
        <div className="text-xs text-mse-muted truncate">
          {unit.unitSubType}
        </div>
      </div>
      <div
        className={cn(
          "px-2 py-1 rounded-full text-xs font-bold",
          allUploaded ? "bg-mse-gold/15 text-mse-navy" : "bg-mse-light text-mse-muted"
        )}
      >
        {requiredFilled}/{requiredCount}
      </div>
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

