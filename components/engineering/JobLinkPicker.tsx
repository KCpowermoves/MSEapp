"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobHit {
  jobId: string;
  customerName: string;
  siteAddress: string;
  utility: string;
  status: string;
}

interface Props {
  projectId: string;
  linkedJobId: string;
}

export function JobLinkPicker({ projectId, linkedJobId }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JobHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setSearching(true);
    fetch(
      `/api/admin/engineering/jobs-search?q=${encodeURIComponent(query)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setResults((body?.jobs as JobHit[]) ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [query, open]);

  async function link(jobId: string) {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/engineering/${encodeURIComponent(projectId)}/link-job`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        }
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        unitsAdded?: number;
        walkInsAdded?: number;
        nameplatesAdded?: number;
        ocrFilled?: number;
      };
      if (!res.ok) throw new Error(body.error ?? "Link failed");
      const parts = [
        `${body.unitsAdded ?? 0} HVAC unit${body.unitsAdded === 1 ? "" : "s"}`,
      ];
      if (body.walkInsAdded)
        parts.push(
          `${body.walkInsAdded} walk-in${body.walkInsAdded === 1 ? "" : "s"}`
        );
      if (body.nameplatesAdded)
        parts.push(`${body.nameplatesAdded} nameplate photos`);
      let msg = `Pulled ${parts.join(", ")}.`;
      if (body.ocrFilled)
        msg += ` Scanned ${body.ocrFilled} nameplate${
          body.ocrFilled === 1 ? "" : "s"
        } for specs.`;
      setNotice(msg);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed");
    } finally {
      setLinking(false);
    }
  }

  async function unlink() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Unlink this project from the job? Customer info stays, but any HVAC rows pulled from the job's Units Serviced remain — remove them manually if desired."
      )
    ) {
      return;
    }
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/engineering/${encodeURIComponent(projectId)}/link-job`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: "" }),
        }
      );
      if (!res.ok) throw new Error("Unlink failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unlink failed");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="space-y-2">
      {notice && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-[11px] text-emerald-900 font-semibold">
          {notice}
        </div>
      )}
      {linkedJobId ? (
        <div className="flex items-center gap-2 flex-wrap rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
          <Link2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span className="text-xs text-emerald-900 font-semibold">
            Linked to job <span className="font-mono">{linkedJobId}</span>
          </span>
          <div className="grow" />
          <button
            type="button"
            onClick={unlink}
            disabled={linking}
            className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold"
          >
            {linking ? "…" : "Unlink"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-mse-light text-mse-navy hover:border-mse-navy/30"
        >
          <Link2 className="w-3.5 h-3.5" />
          Link to existing MSE job
        </button>
      )}

      {open && (
        <div className="rounded-xl border border-mse-navy/20 bg-white p-3 space-y-2 shadow-elevated">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wider font-bold text-mse-muted">
              Pick a job
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 text-mse-muted hover:text-mse-navy"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-mse-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by customer, address, or job ID"
              autoFocus
              className="w-full pl-8 pr-3 py-2 rounded-md border border-mse-light bg-white text-xs focus:outline-none focus:border-mse-navy"
            />
          </div>
          {searching && (
            <div className="text-[11px] text-mse-muted inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> searching…
            </div>
          )}
          {results.length === 0 && !searching && (
            <div className="text-[11px] text-mse-muted italic px-2 py-1">
              No matches.
            </div>
          )}
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {results.map((r) => (
              <li key={r.jobId}>
                <button
                  type="button"
                  onClick={() => link(r.jobId)}
                  disabled={linking}
                  className={cn(
                    "w-full text-left px-2.5 py-2 rounded-md hover:bg-mse-light/60 active:bg-mse-light",
                    "flex items-start gap-2"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-mse-navy truncate">
                      {r.customerName || r.jobId}
                    </div>
                    <div className="text-[10px] text-mse-muted truncate">
                      {r.siteAddress || "no address"}
                    </div>
                    <div className="text-[10px] text-mse-muted font-mono">
                      {r.jobId} · {r.utility}
                    </div>
                  </div>
                  <Link2 className="w-3 h-3 text-mse-muted shrink-0 mt-1" />
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <div className="text-[11px] text-mse-red bg-mse-red/5 rounded px-2 py-1">
              {error}
            </div>
          )}
          <p className="text-[10px] text-mse-muted italic">
            Linking auto-pulls the customer name, site address, and every
            active HVAC unit from that job&apos;s Units Serviced.
          </p>
        </div>
      )}
    </div>
  );
}
