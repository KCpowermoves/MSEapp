import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardList } from "lucide-react";
import { computeFinalizationReport } from "@/lib/payroll/finalization";
import { loadAllTechs } from "@/lib/auth";
import { WorklistCard } from "@/components/payroll/WorklistCard";

export const dynamic = "force-dynamic";

// Global finalization worklist — every job with a payroll problem since
// the split-pay epoch, most recent first. Read-only detection; the
// Finalize button on each card is where money can move.

export default async function WorklistPage() {
  const [report, techs] = await Promise.all([
    computeFinalizationReport(),
    loadAllTechs(),
  ]);
  const allTechNames = techs
    .filter((t) => t.active)
    .map((t) => t.name)
    .sort();

  const c = report.counts;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link
            href="/admin/payroll"
            className="inline-flex items-center gap-1 text-xs font-semibold text-mse-muted hover:text-mse-navy"
          >
            <ArrowLeft className="w-3 h-3" />
            Commission Report
          </Link>
          <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2 mt-1">
            <ClipboardList className="w-7 h-7 text-mse-gold" />
            Finalization worklist
          </h1>
          <p className="text-sm text-mse-muted mt-1 max-w-xl">
            Jobs with payroll problems: never submitted, paid $0, missing
            photos, or an unfinished audit. Fix the pay or wave a job off —
            either way it&apos;s stamped finalized and drops off this list.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-mse-muted">
          <span>
            <strong className="text-mse-navy">{c.jobs}</strong> job
            {c.jobs === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>
            <strong className="text-mse-navy">{c.dispatches}</strong> problem
            day{c.dispatches === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {report.jobs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-mse-light p-10 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
          <div className="font-bold text-mse-navy mt-2">All clear</div>
          <p className="text-sm text-mse-muted mt-1">
            Every job since the week of Jul 6 is submitted, photographed, and
            paying correctly.
          </p>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {report.jobs.map((j) => (
            <WorklistCard key={j.jobId} job={j} allTechs={allTechNames} />
          ))}
        </div>
      )}
    </div>
  );
}
