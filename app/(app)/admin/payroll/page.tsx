import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardList, DollarSign, Plus, Sparkles } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { summarizeAllPeriods } from "@/lib/payroll/compute";
import { NewPeriodForm } from "@/components/payroll/NewPeriodForm";
import { PreviewPanel } from "@/components/payroll/PreviewPanel";
import type { PayrollStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PayrollListPage({
  searchParams,
}: {
  searchParams: { start?: string; end?: string };
}) {
  // Live preview of an arbitrary date range without creating a period —
  // the inline preview reads ?start=&end= and computes on the server.
  const previewStart = searchParams.start ?? "";
  const previewEnd = searchParams.end ?? "";

  const summaries = await summarizeAllPeriods();

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
        <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2 text-mse-navy">
            <Plus className="w-4 h-4 text-mse-gold" />
            <h2 className="font-bold">Run a new commission report period</h2>
          </div>
          <p className="text-xs text-mse-muted mt-1">
            Pick a date range. Period is created in <strong>Draft</strong> so
            you can add adjustments before approving.
          </p>
          <div className="mt-4">
            <NewPeriodForm />
          </div>
        </section>

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
