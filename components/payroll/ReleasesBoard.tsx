"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { DeferralLedger } from "@/lib/payroll/deferrals";

interface Props {
  initialLedger: DeferralLedger;
}

/**
 * Two-lane board: jobs whose client has paid (releases ready to
 * approve) and jobs still waiting on payment (with a Client Paid
 * toggle right on the row — one page runs the whole flow).
 */
export function ReleasesBoard({ initialLedger }: Props) {
  const router = useRouter();
  const ledger = initialLedger;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group entries by job so a job's whole crew releases together.
  const byJob = useMemo(() => {
    const map = new Map<
      string,
      { jobId: string; customerName: string; clientPaidAt: string; rows: DeferralLedger["entries"] }
    >();
    for (const e of ledger.entries) {
      if (e.remaining < 0.01) continue;
      const g = map.get(e.jobId) ?? {
        jobId: e.jobId,
        customerName: e.customerName,
        clientPaidAt: e.clientPaidAt,
        rows: [],
      };
      g.rows.push(e);
      map.set(e.jobId, g);
    }
    return Array.from(map.values());
  }, [ledger]);

  const ready = byJob.filter((g) => g.clientPaidAt);
  const waiting = byJob.filter((g) => !g.clientPaidAt);

  async function markClientPaid(jobId: string, paid: boolean) {
    setBusyKey(`paid:${jobId}`);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/jobs/${encodeURIComponent(jobId)}/client-paid`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paid }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyKey(null);
    }
  }

  async function approveJob(jobId: string, rows: DeferralLedger["entries"]) {
    const total = rows.reduce((s, r) => s + r.remaining, 0);
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Release ${formatCurrency(total)} across ${rows.length} tech${rows.length === 1 ? "" : "s"} for this job? It lands on the next Thursday report.`
      )
    ) {
      return;
    }
    setBusyKey(`approve:${jobId}`);
    setError(null);
    try {
      const res = await fetch("/api/admin/payroll/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: rows.map((r) => ({ techName: r.techName, jobId: r.jobId })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        releasedTotal?: number;
        targetPeriodId?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Server error ${res.status}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Totals ────────────────────────────────────────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="Ready to release"
          value={formatCurrency(ledger.totals.readyToRelease)}
          tone="ready"
        />
        <StatCard
          label="Waiting on clients"
          value={formatCurrency(ledger.totals.waitingOnClients)}
          tone="waiting"
        />
        <StatCard
          label="Released to date"
          value={formatCurrency(ledger.totals.released)}
        />
      </section>

      {/* ── Draw shortfalls (Ivan) ───────────────────────────────── */}
      {ledger.shortfalls.length > 0 && (
        <section className="rounded-2xl border-2 border-mse-gold/40 bg-mse-gold/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-mse-gold shrink-0 mt-0.5" />
            <div className="text-sm text-mse-navy">
              <strong>Draw shortfalls to net against releases:</strong>
              <ul className="mt-1 space-y-0.5">
                {ledger.shortfalls.map((s) => (
                  <li key={s.techName}>
                    {s.techName}: {formatCurrency(s.amount)} advanced beyond
                    earnings ({s.weeks.join("; ")}). When approving their
                    releases, add a matching{" "}
                    <strong>deduction</strong> on the period to recoup it.
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-mse-red/30 bg-mse-red/5 text-mse-red text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Ready lane ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Banknote className="w-4 h-4 text-emerald-600" />
          Client paid — ready to release ({ready.length})
        </h2>
        {ready.length === 0 ? (
          <EmptyLane text="Nothing ready. Mark a job Client Paid below when the money lands." />
        ) : (
          <ul className="space-y-2">
            {ready.map((g) => (
              <li
                key={g.jobId}
                className="bg-white rounded-2xl border-2 border-emerald-200 shadow-card p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-bold text-mse-navy truncate">
                      {g.customerName}
                    </div>
                    <div className="text-[11px] text-mse-muted font-mono">
                      {g.jobId} · client paid{" "}
                      {g.clientPaidAt.slice(0, 10)}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {g.rows.map((r) => (
                        <li
                          key={r.techName}
                          className="text-sm text-mse-navy flex items-center gap-2"
                        >
                          <span className="font-semibold">{r.techName}</span>
                          <span className="tabular-nums font-bold">
                            {formatCurrency(r.remaining)}
                          </span>
                          <span className="text-[11px] text-mse-muted">
                            ({r.weeks.join("; ")})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="text-xl font-bold text-mse-navy tabular-nums">
                      {formatCurrency(
                        g.rows.reduce((s, r) => s + r.remaining, 0)
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => approveJob(g.jobId, g.rows)}
                      disabled={busyKey !== null}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold",
                        "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95",
                        "transition-[background-color,transform] shadow-card",
                        busyKey === `approve:${g.jobId}` && "opacity-60 cursor-wait"
                      )}
                    >
                      {busyKey === `approve:${g.jobId}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      Approve release
                    </button>
                    <button
                      type="button"
                      onClick={() => markClientPaid(g.jobId, false)}
                      disabled={busyKey !== null}
                      className="text-[11px] text-mse-muted hover:text-mse-red font-semibold"
                    >
                      Undo Client Paid
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Waiting lane ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-mse-gold" />
          Waiting on client payment ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <EmptyLane text="No outstanding deferrals — every job's second halves are settled or released." />
        ) : (
          <ul className="space-y-2">
            {waiting.map((g) => (
              <li
                key={g.jobId}
                className="bg-white rounded-2xl border border-mse-light shadow-card p-4"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-bold text-mse-navy truncate">
                      {g.customerName}
                    </div>
                    <div className="text-[11px] text-mse-muted font-mono">
                      {g.jobId}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {g.rows.map((r) => (
                        <li
                          key={r.techName}
                          className="text-sm text-mse-navy flex items-center gap-2"
                        >
                          <span className="font-semibold">{r.techName}</span>
                          <span className="tabular-nums">
                            {formatCurrency(r.remaining)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="text-lg font-bold text-mse-muted tabular-nums">
                      {formatCurrency(
                        g.rows.reduce((s, r) => s + r.remaining, 0)
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => markClientPaid(g.jobId, true)}
                      disabled={busyKey !== null}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold",
                        "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
                        "transition-[background-color,transform] shadow-card",
                        busyKey === `paid:${g.jobId}` && "opacity-60 cursor-wait"
                      )}
                    >
                      {busyKey === `paid:${g.jobId}` ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Banknote className="w-3.5 h-3.5" />
                      )}
                      Mark Client Paid
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ready" | "waiting";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 shadow-card",
        tone === "ready"
          ? "bg-emerald-50 border-emerald-200"
          : tone === "waiting"
          ? "bg-mse-gold/10 border-mse-gold/30"
          : "bg-white border-mse-light"
      )}
    >
      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
        {label}
      </div>
      <div className="text-2xl font-bold text-mse-navy tabular-nums mt-0.5">
        {value}
      </div>
    </div>
  );
}

function EmptyLane({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-mse-light p-6 text-center text-sm text-mse-muted">
      {text}
    </div>
  );
}
