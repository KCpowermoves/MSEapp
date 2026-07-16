import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  HandCoins,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn, formatCurrency, todayIsoEastern } from "@/lib/utils";
import { summarizeAllPeriods } from "@/lib/payroll/compute";
import { computeDeferralLedger } from "@/lib/payroll/deferrals";
import { computeFinalizationReport } from "@/lib/payroll/finalization";
import { ensureWeeklyPeriod, mondayOf } from "@/lib/data/payroll-periods";
import { loadAllTechs } from "@/lib/auth";
import { NewPeriodForm } from "@/components/payroll/NewPeriodForm";
import { PreviewPanel } from "@/components/payroll/PreviewPanel";
import { WorklistCard } from "@/components/payroll/WorklistCard";
import { ApproveWeekButton } from "@/components/payroll/ApproveWeekButton";
import type { PayrollStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function PayrollListPage({
  searchParams,
}: {
  searchParams: { start?: string; end?: string };
}) {
  // Live preview of an arbitrary date range without creating a period —
  // the inline preview reads ?start=&end= and computes on the server.
  const previewStart = searchParams.start ?? "";
  const previewEnd = searchParams.end ?? "";

  // ── The weekly close ──────────────────────────────────────────────
  // The admin's Thursday ritual: the most recent COMPLETED Mon–Sun
  // week. The Monday cron normally created it already; ensure() is the
  // idempotent safety net.
  const today = todayIsoEastern();
  const closeWeekAnchor = addDaysIso(mondayOf(today), -7);
  const { period: closeWeek } = await ensureWeeklyPeriod({
    anchorIso: closeWeekAnchor,
    createdBy: "auto (close page)",
  });

  const [summaries, weekReport, ledger, techs] = await Promise.all([
    summarizeAllPeriods(),
    computeFinalizationReport({
      weekStart: closeWeek.startDate,
      weekEnd: closeWeek.endDate,
    }),
    computeDeferralLedger().catch(() => null),
    loadAllTechs(),
  ]);
  const allTechNames = techs
    .filter((t) => t.active)
    .map((t) => t.name)
    .sort();

  const closeSummary = summaries.find(
    (s) => s.period.periodId === closeWeek.periodId
  );
  const olderOpenWeeks = summaries.filter(
    (s) =>
      s.period.periodType === "weekly" &&
      s.period.status === "Draft" &&
      s.period.endDate < closeWeek.startDate
  ).length;
  const readyToRelease = ledger?.totals.readyToRelease ?? 0;
  const releasePairs =
    ledger?.entries.filter((e) => e.clientPaidAt && e.remaining > 0).length ??
    0;

  const totalSaved = summaries.reduce((s, x) => s + x.grandTotal, 0);
  const draftCount = summaries.filter(
    (s) => s.period.status === "Draft"
  ).length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-mse-gold" />
            Commission Report
          </h1>
          <p className="text-sm text-mse-muted mt-1 max-w-xl">
            Run a commission report for any date range. Add adjustments, re-attribute
            units, and export a PDF or CSV when you&apos;re ready to cut checks.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/admin/payroll/releases"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-mse-navy border-2 border-mse-navy hover:bg-mse-navy hover:text-white active:scale-95"
          >
            <HandCoins className="w-4 h-4" />
            2nd-half releases
          </Link>
          <Pill label="Saved periods" value={String(summaries.length)} />
          <Pill label="Drafts" value={String(draftCount)} accent="gold" />
          <Pill
            label="All-time"
            value={formatCurrency(totalSaved)}
            accent="navy"
          />
        </div>
      </header>

      <div className="grid md:grid-cols-[1.4fr_1fr] gap-4 items-start">
        <section className="rounded-2xl bg-white border border-mse-light shadow-card p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 text-mse-navy">
                <CalendarCheck className="w-4 h-4 text-mse-gold" />
                <h2 className="font-bold">This week&apos;s close</h2>
                <StatusPill status={closeWeek.status} />
              </div>
              <p className="text-xs text-mse-muted mt-1">
                {closeWeek.label ||
                  `${closeWeek.startDate} – ${closeWeek.endDate}`}
                {closeWeek.note ? ` · ${closeWeek.note}` : ""}
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-mse-navy tabular-nums">
                {formatCurrency(closeSummary?.grandTotal ?? 0)}
              </div>
              <div className="text-[11px] text-mse-muted">
                {closeSummary?.techCount ?? 0} tech
                {(closeSummary?.techCount ?? 0) === 1 ? "" : "s"} ·{" "}
                {prettyDate(closeWeek.startDate)} →{" "}
                {prettyDate(closeWeek.endDate)}
              </div>
            </div>
          </div>

          {/* Step 1 — finalize the week's work */}
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1.5">
              1 · Finalize the work
            </div>
            {weekReport.jobs.length === 0 ? (
              <div className="rounded-xl border border-mse-light bg-mse-light/20 px-3 py-2.5 text-xs text-mse-navy inline-flex items-center gap-1.5 w-full">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                Every job this week is submitted, photographed, and paying
                correctly.
              </div>
            ) : (
              <div className="space-y-2">
                {weekReport.jobs.map((j) => (
                  <WorklistCard key={j.jobId} job={j} allTechs={allTechNames} />
                ))}
              </div>
            )}
            <Link
              href="/admin/payroll/worklist"
              className="inline-flex items-center gap-1 text-xs font-semibold text-mse-muted hover:text-mse-navy mt-2"
            >
              Full worklist (all weeks)
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Step 2 — release second halves that clients have paid */}
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1.5">
              2 · Release second halves
            </div>
            <Link
              href="/admin/payroll/releases"
              className={cn(
                "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 group",
                readyToRelease > 0
                  ? "border-mse-gold/50 bg-mse-gold/10 hover:bg-mse-gold/15"
                  : "border-mse-light bg-mse-light/20 hover:bg-mse-light/30"
              )}
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-mse-navy">
                <HandCoins className="w-3.5 h-3.5" />
                {readyToRelease > 0
                  ? `${formatCurrency(readyToRelease)} ready to release (${releasePairs} tech-job pair${releasePairs === 1 ? "" : "s"} · clients paid)`
                  : "Nothing waiting — no client-paid second halves to release."}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-mse-muted transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Step 3 — approve and freeze */}
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1.5">
              3 · Approve the report
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {closeWeek.status === "Draft" ? (
                <ApproveWeekButton
                  periodId={closeWeek.periodId}
                  unfinalizedCount={weekReport.jobs.length}
                />
              ) : (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-600/10 border border-emerald-600/20 rounded-xl px-3 py-2.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Week is {closeWeek.status === "Approved" ? "Invoice Approved" : closeWeek.status}
                  {closeWeek.approvedBy ? ` by ${closeWeek.approvedBy}` : ""}.
                </div>
              )}
              <Link
                href={`/admin/payroll/${encodeURIComponent(closeWeek.periodId)}`}
                className="inline-flex items-center gap-1 text-xs font-bold text-mse-navy hover:underline"
              >
                Open full report
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {olderOpenWeeks > 0 && (
              <p className="text-[11px] text-mse-muted mt-2">
                {olderOpenWeeks} older week{olderOpenWeeks === 1 ? "" : "s"}{" "}
                still in Draft — see Saved periods below.
              </p>
            )}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border-2 border-dashed border-mse-light p-5">
            <div className="flex items-center gap-2 text-mse-muted">
              <Sparkles className="w-4 h-4 text-mse-gold" />
              <h2 className="font-bold text-mse-navy">Live preview</h2>
            </div>
            <p className="text-xs text-mse-muted mt-1">
              See what a date range would total without saving anything. URL is
              shareable.
            </p>
            <div className="mt-4">
              <PreviewPanel startDate={previewStart} endDate={previewEnd} />
            </div>
          </section>

          <details className="rounded-2xl bg-white border border-mse-light shadow-card group">
            <summary className="cursor-pointer list-none p-5 flex items-center gap-2 text-mse-navy select-none">
              <Plus className="w-4 h-4 text-mse-gold transition-transform group-open:rotate-45" />
              <span className="font-bold">Advanced: custom period</span>
            </summary>
            <div className="px-5 pb-5">
              <p className="text-xs text-mse-muted -mt-1 mb-4">
                Weekly periods create themselves every Monday. Only use this
                for off-cycle ranges (month-end invoices, one-off
                corrections). Created in <strong>Draft</strong>.
              </p>
              <NewPeriodForm
                existingRanges={summaries.map((s) => ({
                  start: s.period.startDate,
                  end: s.period.endDate,
                }))}
              />
            </div>
          </details>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide">
            Saved periods
          </h2>
          <span className="text-xs text-mse-muted">
            {summaries.length} period{summaries.length === 1 ? "" : "s"}
          </span>
        </div>
        {summaries.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center text-sm text-mse-muted">
            No commission report periods yet. Create your first one above.
          </div>
        ) : (
          <ul className="space-y-2">
            {summaries.map((s) => (
              <li key={s.period.periodId}>
                <Link
                  href={`/admin/payroll/${encodeURIComponent(
                    s.period.periodId
                  )}`}
                  className={cn(
                    "block bg-white rounded-2xl border-2 border-mse-light hover:border-mse-navy/20",
                    "shadow-card hover:shadow-elevated transition-[border-color,box-shadow]",
                    "p-4 group"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusPill status={s.period.status} />
                        <span className="text-sm font-bold text-mse-navy truncate">
                          {s.period.label || `${s.period.startDate} – ${s.period.endDate}`}
                        </span>
                        <span className="text-[11px] text-mse-muted font-mono">
                          {s.period.periodId}
                        </span>
                      </div>
                      <div className="text-xs text-mse-muted mt-1.5 flex items-center gap-2 flex-wrap">
                        <span>
                          {prettyDate(s.period.startDate)} →{" "}
                          {prettyDate(s.period.endDate)}
                        </span>
                        <span>·</span>
                        <span>
                          {s.techCount} tech{s.techCount === 1 ? "" : "s"}
                        </span>
                        <span>·</span>
                        <span>
                          {s.attributionLineCount + s.adjustmentLineCount} line
                          item
                          {s.attributionLineCount + s.adjustmentLineCount === 1
                            ? ""
                            : "s"}
                          {s.adjustmentLineCount > 0 && (
                            <>
                              {" "}
                              <span className="text-mse-gold font-semibold">
                                ({s.adjustmentLineCount} adj)
                              </span>
                            </>
                          )}
                        </span>
                        {s.period.approvedBy && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-mse-gold" />
                              {s.period.approvedBy}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-bold text-mse-navy tabular-nums">
                        {formatCurrency(s.grandTotal)}
                      </div>
                      <div className="inline-flex items-center gap-1 text-[11px] text-mse-muted mt-0.5">
                        Open
                        <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="text-xs text-mse-muted text-center pt-2 pb-8">
        <ClipboardList className="w-3 h-3 inline mr-1" />
        First time? Run{" "}
        <code className="font-mono bg-mse-light px-1 rounded">
          node scripts/init-payroll-tabs.mjs
        </code>{" "}
        to create the Commission Report tabs in the Sheet.
      </div>
    </div>
  );
}

function Pill({
  label,
  value,
  accent = "muted",
}: {
  label: string;
  value: string;
  accent?: "navy" | "gold" | "muted";
}) {
  // Label color is per-accent rather than `opacity-70` so the navy
  // tile gets a high-contrast gold caption instead of low-contrast
  // dim-white — the same brand pattern as the hero stats.
  const tile =
    accent === "navy"
      ? "bg-mse-navy text-white"
      : accent === "gold"
      ? "bg-mse-gold/15 text-mse-navy border border-mse-gold/40"
      : "bg-white border border-mse-light text-mse-navy";
  const labelClass =
    accent === "navy"
      ? "text-mse-gold"
      : accent === "gold"
      ? "text-mse-navy/75"
      : "text-mse-muted";
  return (
    <div className={cn("rounded-xl px-3.5 py-2.5 min-w-[110px]", tile)}>
      <div
        className={cn(
          "text-[11px] uppercase tracking-[0.12em] font-bold",
          labelClass
        )}
      >
        {label}
      </div>
      <div className="font-bold tabular-nums text-lg mt-0.5">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: PayrollStatus }) {
  const styles =
    status === "Approved"
      ? "bg-mse-gold/20 text-mse-navy"
      : status === "Paid"
      ? "bg-emerald-600/15 text-emerald-700"
      : status === "Closed"
      ? "bg-slate-700 text-white"
      : "bg-mse-light text-mse-muted";
  // Commission reports surface the lifecycle as billing language —
  // "Invoice Approved" beats the bare HR-y "Approved" on a sheet
  // people are about to cut checks against.
  const label = status === "Approved" ? "Invoice Approved" : status;
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
        styles
      )}
    >
      {label}
    </span>
  );
}

function prettyDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
