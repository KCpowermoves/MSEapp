"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Download,
  FileSpreadsheet,
  Loader2,
  Lock,
  RotateCcw,
  Users,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { PayrollStatus } from "@/lib/types";

interface Props {
  periodId: string;
  startDate: string;
  endDate: string;
  status: PayrollStatus;
  label: string;
  note: string;
  approvedBy: string;
  approvedAt: string;
  paidBy: string;
  paidAt: string;
  createdBy: string;
  createdAt: string;
  grandTotal: number;
  techCount: number;
  lineItemCount: number;
}

export function PayrollDetailHeader(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStatus = async (next: PayrollStatus, confirmLabel?: string) => {
    if (confirmLabel) {
      if (typeof window !== "undefined" && !window.confirm(confirmLabel)) {
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/payroll/periods/${encodeURIComponent(
          props.periodId
        )}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Status update failed");
    } finally {
      setBusy(false);
    }
  };

  const titleText =
    props.label?.trim() || prettyRange(props.startDate, props.endDate);

  return (
    <header className="rounded-2xl bg-gradient-to-br from-mse-navy to-mse-navy-soft text-white p-6 shadow-elevated relative overflow-hidden">
      {/* Status-tinted radial behind the figure */}
      <div
        className={cn(
          "pointer-events-none absolute -top-16 -right-16 w-72 h-72 rounded-full blur-3xl",
          props.status === "Approved"
            ? "bg-mse-gold/25"
            : props.status === "Paid"
            ? "bg-emerald-500/20"
            : "bg-white/5"
        )}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-white/65 text-[11px] font-bold uppercase tracking-wider">
            <DollarSign className="w-3.5 h-3.5 text-mse-gold" />
            Payroll period
            <span className="text-white/40 font-mono normal-case tracking-normal">
              · {props.periodId}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mt-1">
            {titleText}
          </h1>
          <div className="text-sm text-white/65 mt-1">
            {prettyRange(props.startDate, props.endDate)}
          </div>
          {props.note && (
            <div className="mt-2 text-xs text-white/65 max-w-md italic">
              {props.note}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <StatusPill status={props.status} />
          {props.status === "Approved" && props.approvedBy && (
            <div className="text-[11px] text-white/55 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              by {props.approvedBy}
            </div>
          )}
          {props.status === "Paid" && props.paidBy && (
            <div className="text-[11px] text-white/55 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              paid by {props.paidBy}
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-3 gap-3">
        <Stat icon={<DollarSign className="w-3 h-3" />} label="Total" value={formatCurrency(props.grandTotal)} />
        <Stat icon={<Users className="w-3 h-3" />} label="Techs" value={String(props.techCount)} />
        <Stat icon={<ClipboardList className="w-3 h-3" />} label="Line items" value={String(props.lineItemCount)} />
      </div>

      <div className="relative mt-5 flex flex-wrap gap-2 items-center">
        {/* Status transitions */}
        {props.status === "Draft" && (
          <button
            type="button"
            onClick={() =>
              setStatus(
                "Approved",
                "Approve this period? Adjustments will be locked until you unlock."
              )
            }
            disabled={busy}
            className={primaryBtn(busy)}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Approve
          </button>
        )}
        {props.status === "Approved" && (
          <>
            <button
              type="button"
              onClick={() =>
                setStatus(
                  "Paid",
                  "Mark as Paid? Use this once you've actually cut checks / disbursed."
                )
              }
              disabled={busy}
              className={primaryBtn(busy)}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Mark Paid
            </button>
            <button
              type="button"
              onClick={() =>
                setStatus(
                  "Draft",
                  "Unlock back to Draft? This clears the approval stamp."
                )
              }
              disabled={busy}
              className={secondaryBtn(busy)}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Unlock to edit
            </button>
          </>
        )}
        {props.status === "Paid" && (
          <button
            type="button"
            onClick={() =>
              setStatus(
                "Draft",
                "Unlock back to Draft? Money is already out — only do this for accounting corrections."
              )
            }
            disabled={busy}
            className={secondaryBtn(busy)}
          >
            <Lock className="w-3.5 h-3.5" />
            Unlock (Paid)
          </button>
        )}

        {/* Exports */}
        <div className="grow" />
        <a
          href={`/api/admin/payroll/periods/${encodeURIComponent(
            props.periodId
          )}/export?format=pdf`}
          className={exportBtn()}
        >
          <Download className="w-3.5 h-3.5" />
          PDF
        </a>
        <a
          href={`/api/admin/payroll/periods/${encodeURIComponent(
            props.periodId
          )}/export?format=csv`}
          className={exportBtn()}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          CSV
        </a>
      </div>

      {error && (
        <div className="relative mt-3 text-xs bg-mse-red/20 border border-mse-red/40 text-white rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </header>
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

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/8 px-3 py-2 backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-white/55 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: PayrollStatus }) {
  const styles =
    status === "Approved"
      ? "bg-mse-gold text-mse-navy"
      : status === "Paid"
      ? "bg-emerald-500 text-white"
      : "bg-white/15 text-white";
  return (
    <span
      className={cn(
        "px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
        styles
      )}
    >
      {status}
    </span>
  );
}

function primaryBtn(busy: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold",
    "bg-mse-gold text-mse-navy hover:bg-mse-gold/90 active:scale-95",
    "transition-[background-color,transform]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
    busy && "opacity-60 cursor-wait"
  );
}
function secondaryBtn(busy: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold",
    "bg-white/10 text-white hover:bg-white/15 active:scale-95",
    "transition-[background-color,transform]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
    busy && "opacity-60 cursor-wait"
  );
}
function exportBtn(): string {
  return cn(
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold",
    "bg-white/10 text-white hover:bg-white/15 active:scale-95",
    "transition-[background-color,transform]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
  );
}
