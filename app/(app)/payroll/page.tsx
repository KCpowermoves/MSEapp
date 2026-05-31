import Link from "next/link";
import { ArrowRight, CheckCircle2, DollarSign, Eye, Lock } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listAllPayrollPeriods } from "@/lib/data/payroll-periods";
import { computeReportForTech } from "@/lib/payroll/compute";
import { cn, formatCurrency } from "@/lib/utils";
import type { PayrollStatus } from "@/lib/types";

// Tech-facing payroll view — lists only periods that have been
// Approved or Paid, and only for the signed-in tech. Drafts are
// admin-only by design. The tech also sees an "Earning so far"
// preview of any current open period so they can watch totals climb.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PeriodCard {
  periodId: string;
  status: PayrollStatus;
  startDate: string;
  endDate: string;
  label: string;
  grandTotal: number;
  lineItemCount: number;
  approvedAt: string;
  paidAt: string;
}

export default async function TechPayrollPage() {
  const session = await getSession();
  const techName = session.name ?? "";

  const periods = await listAllPayrollPeriods();
  const visible = periods.filter(
    (p) => p.status === "Approved" || p.status === "Paid"
  );

  const cards: PeriodCard[] = [];
  for (const p of visible) {
    const { rollup } = await computeReportForTech({
      techName,
      periodId: p.periodId,
      startDate: p.startDate,
      endDate: p.endDate,
    });
    if (!rollup) continue; // tech had no activity in this period
    cards.push({
      periodId: p.periodId,
      status: p.status,
      startDate: p.startDate,
      endDate: p.endDate,
      label: p.label,
      grandTotal: rollup.grandTotal,
      lineItemCount: rollup.lineItems.length,
      approvedAt: p.approvedAt,
      paidAt: p.paidAt,
    });
  }
  cards.sort((a, b) => b.startDate.localeCompare(a.startDate));

  const lifetimePay = cards.reduce((s, c) => s + c.grandTotal, 0);
  const paidCount = cards.filter((c) => c.status === "Paid").length;

  return (
    <div className="space-y-6">
      <header>
        <div className="text-sm text-mse-muted">My pay</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <DollarSign className="w-7 h-7 text-mse-gold" />
          Commission Report
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-xl">
          Your approved + paid runs. Earnings on this page have been finalized
          — live in-progress earnings show on each job&apos;s screen.
        </p>
      </header>

      {cards.length > 0 && (
        <section className="rounded-2xl bg-gradient-to-br from-mse-navy to-mse-navy-soft text-white p-5 shadow-elevated relative overflow-hidden">
          <div
            className="pointer-events-none absolute -top-10 -right-10 w-48 h-48 rounded-full bg-mse-gold/20 blur-3xl"
            aria-hidden
          />
          <div className="relative">
            <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-mse-gold">
              Lifetime · Approved + Paid
            </div>
            <div className="text-4xl font-bold tracking-tight tabular-nums mt-1 text-white">
              {formatCurrency(lifetimePay)}
            </div>
            <div className="text-xs text-white/80 mt-1 font-medium">
              {cards.length} period{cards.length === 1 ? "" : "s"}
              {paidCount > 0 && (
                <>
                  {" · "}
                  <span className="text-mse-gold font-bold">
                    {paidCount} paid
                  </span>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Commission reports
        </h2>
        {cards.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center">
            <p className="text-sm text-mse-muted">
              No approved pay reports yet. Drafts are still admin-only — once
              your next pay period is approved, it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cards.map((c) => (
              <li key={c.periodId}>
                <Link
                  href={`/payroll/${encodeURIComponent(c.periodId)}`}
                  className={cn(
                    "block bg-white rounded-2xl border-2 border-mse-light hover:border-mse-navy/20",
                    "shadow-card hover:shadow-elevated transition-[border-color,box-shadow]",
                    "p-4 group"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusPill status={c.status} />
                        <span className="text-sm font-bold text-mse-navy truncate">
                          {c.label || prettyRange(c.startDate, c.endDate)}
                        </span>
                      </div>
                      <div className="text-xs text-mse-muted mt-1.5">
                        {prettyRange(c.startDate, c.endDate)} ·{" "}
                        {c.lineItemCount} line item
                        {c.lineItemCount === 1 ? "" : "s"}
                      </div>
                      {c.status === "Paid" && c.paidAt && (
                        <div className="text-[11px] text-emerald-700 font-semibold mt-1 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Paid {formatStamp(c.paidAt)}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xl font-bold text-mse-navy tabular-nums">
                        {formatCurrency(c.grandTotal)}
                      </div>
                      <div className="inline-flex items-center gap-1 text-[11px] text-mse-muted mt-0.5">
                        <Eye className="w-3 h-3" />
                        View
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

      <div className="text-[11px] text-mse-muted text-center pt-2 pb-8 flex items-center justify-center gap-1">
        <Lock className="w-3 h-3" />
        Drafts and other techs&apos; data stay hidden from this view.
      </div>
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
