"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Compact preview panel — accepts URL-driven start/end and shows
// inline totals fetched from the same compute path used by the
// detail page. Reading via URL params means the preview is
// shareable / bookmarkable.

interface PreviewData {
  ok: boolean;
  startDate: string;
  endDate: string;
  techs: Array<{ techName: string; grandTotal: number }>;
  grandTotal: number;
  attributionLineCount: number;
  adjustmentLineCount: number;
}

export function PreviewPanel({
  startDate: initialStart,
  endDate: initialEnd,
}: {
  startDate: string;
  endDate: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Auto-fetch when query params show up (e.g. on initial load or
  // when the user shares a URL).
  useEffect(() => {
    if (!initialStart || !initialEnd) return;
    void fetchPreview(initialStart, initialEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStart, initialEnd]);

  async function fetchPreview(s: string, e: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/payroll/preview?start=${encodeURIComponent(
          s
        )}&end=${encodeURIComponent(e)}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`);
      }
      const json = (await res.json()) as PreviewData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start || !end) return;
    // Update URL so the preview is shareable; also kick off the
    // fetch directly so the user sees it without a router roundtrip.
    const params = new URLSearchParams(sp.toString());
    params.set("start", start);
    params.set("end", end);
    startTransition(() => router.replace(`/admin/payroll?${params.toString()}`));
    void fetchPreview(start, end);
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label className="block">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            Start
          </div>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy"
          />
        </label>
        <label className="block">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
            End
          </div>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy"
          />
        </label>
        <button
          type="submit"
          disabled={!start || !end || loading || isPending}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-bold text-xs",
            "bg-mse-gold/15 text-mse-navy hover:bg-mse-gold/25 active:scale-95",
            "border border-mse-gold/30",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-[background-color,transform]"
          )}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
          Preview
        </button>
      </form>

      {error && (
        <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {data && data.ok && (
        <div className="space-y-2">
          <div className="rounded-xl bg-mse-navy text-white px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider opacity-60 font-semibold">
              Preview total
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatUsd(data.grandTotal)}
            </div>
            <div className="text-[11px] text-white/60 mt-0.5">
              {data.techs.length} tech{data.techs.length === 1 ? "" : "s"} ·{" "}
              {data.attributionLineCount} line item
              {data.attributionLineCount === 1 ? "" : "s"}
            </div>
          </div>
          {data.techs.length > 0 && (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {data.techs.map((t) => (
                <li
                  key={t.techName}
                  className="flex items-center justify-between text-xs px-2 py-1 rounded-md hover:bg-mse-light/50"
                >
                  <span className="text-mse-navy font-semibold truncate">
                    {t.techName}
                  </span>
                  <span className="font-bold tabular-nums text-mse-navy">
                    {formatUsd(t.grandTotal)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="text-[11px] text-mse-muted text-center py-3 italic">
          Pick a date range and hit Preview.
        </div>
      )}
    </div>
  );
}

function formatUsd(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const fixed = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2);
  return `$${fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
