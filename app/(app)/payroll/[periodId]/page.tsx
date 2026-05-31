import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { computeReportForTech } from "@/lib/payroll/compute";
import { cn, formatCurrency } from "@/lib/utils";
import type { PayrollStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function TechPayrollDetailPage({
  params,
}: {
  params: { periodId: string };
}) {
  const periodId = decodeURIComponent(params.periodId);
  const session = await getSession();
  const techName = session.name ?? "";

  const period = await getPayrollPeriod(periodId);
  if (!period) notFound();
  // Draft periods are admin-only — bounce techs back to the list.
  if (period.status === "Draft") {
    redirect("/payroll");
  }

  const { rollup } = await computeReportForTech({
    techName,
    periodId,
    startDate: period.startDate,
    endDate: period.endDate,
  });

  // If the tech had no activity in this period, route back to the list
  // so they don't see someone else's totals.
  if (!rollup) {
    redirect("/payroll");
  }

  const titleText = period.label?.trim() || prettyRange(period.startDate, period.endDate);

  return (
    <div className="space-y-6 pb-8">
      <Link
        href="/payroll"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All my periods
      </Link>

      <header className="rounded-2xl bg-gradient-to-br from-mse-navy to-mse-navy-soft text-white p-5 shadow-elevated relative overflow-hidden">
        <div
          className={cn(
            "pointer-events-none absolute -top-12 -right-12 w-60 h-60 rounded-full blur-3xl",
            period.status === "Paid" ? "bg-emerald-500/25" : "bg-mse-gold/25"
          )}
          aria-hidden
        />
        <div className="relative flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-mse-gold">
              Commission Report Period · {period.periodId}
            </div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">
              {titleText}
            </h1>
            <div className="text-sm font-semibold text-white/85 mt-1">
              {prettyRange(period.startDate, period.endDate)}
            </div>
          </div>
          <StatusPill status={period.status} />
        </div>

        <div className="relative mt-5">
          <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-mse-gold">
            Your total
          </div>
          <div className="text-5xl font-bold tabular-nums tracking-tight text-white mt-1">
            {formatCurrency(rollup.grandTotal)}
          </div>
          {period.status === "Paid" && period.paidAt && (
            <div className="inline-flex items-center gap-1 text-xs text-mse-gold mt-1 font-bold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Paid {formatStamp(period.paidAt)}
            </div>
          )}
        </div>

        <div className="relative mt-5 flex flex-wrap gap-2">
          <a
            href={`/api/payroll/periods/${encodeURIComponent(
              periodId
            )}/export?format=pdf`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-95 text-xs font-bold transition-[background-color,transform]"
          >
            <Download className="w-3.5 h-3.5" />
            Download my PDF
          </a>
          <a
            href={`/api/payroll/periods/${encodeURIComponent(
              periodId
            )}/export?format=csv`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 active:scale-95 text-xs font-bold text-white transition-[background-color,transform]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            CSV
          </a>
        </div>
      </header>

      {/* Subtotal chips — gives the tech an at-a-glance breakdown */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Service", value: rollup.subtotals.service },
          { label: "Sales (paid)", value: rollup.subtotals.salesPaid },
          { label: "Sales (pending)", value: rollup.subtotals.salesPending },
          { label: "Standalone", value: rollup.subtotals.standalone },
          { label: "Daily Stipend", value: rollup.subtotals.dailyStipend },
          { label: "Travel Bonus", value: rollup.subtotals.travelBonus },
          { label: "Adjustments", value: rollup.subtotals.adjustments },
        ]
          .filter((c) => c.value !== 0)
          .map((c) => (
            <div
              key={c.label}
              className={cn(
                "rounded-xl p-3 border",
                c.value < 0
                  ? "bg-mse-red/5 border-mse-red/20"
                  : c.label === "Adjustments"
                  ? "bg-mse-gold/10 border-mse-gold/30"
                  : "bg-white border-mse-light"
              )}
            >
              <div className="text-[10px] uppercase tracking-wider font-semibold text-mse-muted">
                {c.label}
              </div>
              <div
                className={cn(
                  "text-lg font-bold tabular-nums mt-0.5",
                  c.value < 0 ? "text-mse-red" : "text-mse-navy"
                )}
              >
                {formatCurrency(c.value)}
              </div>
            </div>
          ))}
      </section>

      {/* Line items */}
      <section className="bg-white rounded-2xl border border-mse-light shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-mse-light flex items-center justify-between">
          <h2 className="font-bold text-mse-navy">Line items</h2>
          <span className="text-[11px] text-mse-muted">
            {rollup.lineItems.length} entries
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mse-muted bg-mse-light/40">
                <th className="text-left py-2 px-3 font-semibold">Date</th>
                <th className="text-left py-2 px-3 font-semibold">
                  Customer / Job
                </th>
                <th className="text-left py-2 px-3 font-semibold">Type</th>
                <th className="text-left py-2 px-3 font-semibold">
                  Description
                </th>
                <th className="text-right py-2 px-3 font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rollup.lineItems.map((it) => {
                const isAdj = it.source === "adjustment";
                const negative = it.amount < 0;
                return (
                  <tr
                    key={`${it.source}-${it.id}`}
                    className={cn(
                      "border-t border-mse-light/60 align-top",
                      isAdj && "bg-mse-gold/5"
                    )}
                  >
                    <td className="py-2 px-3 text-xs text-mse-muted tabular-nums whitespace-nowrap">
                      {it.date || "—"}
                    </td>
                    <td className="py-2 px-3 max-w-[180px]">
                      <div className="text-mse-navy text-sm font-semibold truncate">
                        {it.customerName || (isAdj ? "—" : it.jobId || "—")}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-xs">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded-md font-bold",
                          isAdj
                            ? "bg-mse-gold/20 text-mse-navy"
                            : "bg-mse-light text-mse-muted"
                        )}
                      >
                        {it.lineType}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-mse-muted max-w-[280px]">
                      {it.description || "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 px-3 text-right font-bold tabular-nums whitespace-nowrap",
                        negative ? "text-mse-red" : "text-mse-navy"
                      )}
                    >
                      {formatCurrency(it.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-mse-navy bg-mse-light/30">
                <td
                  colSpan={4}
                  className="py-3 px-3 text-right text-xs font-bold text-mse-muted uppercase tracking-wider"
                >
                  Total
                </td>
                <td className="py-3 px-3 text-right text-xl font-bold text-mse-navy tabular-nums">
                  {formatCurrency(rollup.grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <p className="text-[11px] text-mse-muted text-center">
        Questions about a line? Reach out to admin — adjustments go through
        the dashboard so the audit trail stays clean.
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: PayrollStatus }) {
  const styles =
    status === "Paid"
      ? "bg-emerald-500 text-white"
      : "bg-mse-gold text-mse-navy";
  const label = status === "Approved" ? "Invoice Approved" : status;
  return (
    <span
      className={cn(
        "px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
        styles
      )}
    >
      {label}
    </span>
  );
}

function prettyRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  };
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return `${start} – ${end}`;
  }
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString(
    "en-US",
    opts
  )}`;
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
