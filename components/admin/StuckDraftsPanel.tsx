"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StuckRow {
  dispatchId: string;
  jobId: string;
  customerName: string;
  techNames: string[];
  dispatchDate: string;
  ageDays: number;
}

interface Props {
  rows: StuckRow[];
}

export function StuckDraftsPanel({ rows }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function forceFinalize(dispatchId: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Force-finalize this dispatch? Writes pay attribution rows as if the tech tapped Job Complete."
      )
    ) {
      return;
    }
    setBusyId(dispatchId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/dispatches/${encodeURIComponent(dispatchId)}/finalize`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-mse-light bg-white p-5">
        <h2 className="text-sm font-bold text-mse-navy uppercase tracking-wider">
          Stuck Drafts
        </h2>
        <p className="text-xs text-mse-muted mt-2">
          No dispatches stuck in Draft for more than 48 hours.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border-2 border-mse-red/30 bg-mse-red/5 p-5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-mse-red" />
        <h2 className="text-sm font-bold text-mse-red uppercase tracking-wider">
          Stuck Drafts ({rows.length})
        </h2>
      </div>
      <p className="text-xs text-mse-muted mt-1">
        Dispatches still Draft after 48+ hours. Force-finalize writes their pay attribution rows.
      </p>
      {error && (
        <div className="mt-3 text-[11px] text-mse-red bg-white border border-mse-red/40 rounded px-3 py-2">
          {error}
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li
            key={r.dispatchId}
            className="bg-white rounded-xl border border-mse-light p-3 flex items-center justify-between gap-2 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <div className="font-bold text-mse-navy text-sm truncate">
                {r.customerName}
              </div>
              <div className="text-[11px] text-mse-muted mt-0.5">
                {r.techNames.join(", ")} · {r.dispatchDate} · {r.ageDays}d old
              </div>
            </div>
            <button
              type="button"
              onClick={() => forceFinalize(r.dispatchId)}
              disabled={busyId !== null}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold",
                "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
                busyId === r.dispatchId && "opacity-60"
              )}
            >
              {busyId === r.dispatchId ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : null}
              Force finalize
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
