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
import { CrewPicker } from "@/components/CrewPicker";
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
}

export function JobDetail({
  job,
  todaysUnits,
  todaysServices,
  activeTechs,
}: Props) {
  const { crew, setCrew, hydrated } = useTodaysCrew(job.jobId);
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
          <div className="flex items-center gap-2 mt-2">
            <TerritoryPill territory={job.utilityTerritory} />
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

      <section className="bg-mse-light/60 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-mse-navy">Today&apos;s crew</h2>
          {hydrated && crew.length > 0 && (
            <span className="text-xs text-mse-muted">{crew.length} on site</span>
          )}
        </div>
        <CrewPicker
          multi
          options={activeTechs}
          value={crew}
          onChange={setCrew}
        />
      </section>

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
  const filled = [
    unit.prePhotoUrl,
    unit.postPhotoUrl,
    unit.cleanPhotoUrl,
    unit.nameplatePhotoUrl,
    unit.filterPhotoUrl,
  ].filter(Boolean).length;
  const allUploaded = filled === 5;
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
          {unit.selfSold && unit.soldBy ? ` · sold by ${unit.soldBy}` : ""}
        </div>
      </div>
      <div
        className={cn(
          "px-2 py-1 rounded-full text-xs font-bold",
          allUploaded ? "bg-mse-gold/15 text-mse-navy" : "bg-mse-light text-mse-muted"
        )}
      >
        {filled}/5
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

