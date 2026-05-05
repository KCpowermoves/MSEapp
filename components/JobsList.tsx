"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { ageInDays, cn } from "@/lib/utils";
import type { Job, UtilityTerritory } from "@/lib/types";

interface JobStats {
  pendingUnits: number;
  photosUploaded: number;
  photosRequired: number;
}

interface Props {
  jobs: Job[];
  statsByJob: Record<string, JobStats>;
}

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export function JobsList({ jobs, statsByJob }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [territoryFilter, setTerritoryFilter] = useState<UtilityTerritory | null>(
    null
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (territoryFilter && j.utilityTerritory !== territoryFilter) return false;
      if (!q) return true;
      return (
        j.customerName.toLowerCase().includes(q) ||
        (j.siteAddress ?? "").toLowerCase().includes(q)
      );
    });
  }, [jobs, query, territoryFilter]);

  // ── Pull-to-refresh -------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const PULL_THRESHOLD = 80;

  const onTouchStart = (e: React.TouchEvent) => {
    // Only initiate PTR when scrolled to top
    if ((window.scrollY || document.documentElement.scrollTop) > 0) return;
    startYRef.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const dy = e.touches[0].clientY - startYRef.current;
    if (dy <= 0) {
      setPullDistance(0);
      return;
    }
    // Dampen the pull so it feels rubbery
    setPullDistance(Math.min(120, dy * 0.5));
  };
  const onTouchEnd = async () => {
    const triggered = pullDistance >= PULL_THRESHOLD;
    startYRef.current = null;
    if (!triggered) {
      setPullDistance(0);
      return;
    }
    setRefreshing(true);
    setPullDistance(50);
    try {
      router.refresh();
      // Brief delay so the user actually sees the spinner
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="space-y-3"
    >
      {/* PTR indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center text-mse-muted text-xs"
          style={{ height: `${Math.max(pullDistance, refreshing ? 50 : 0)}px` }}
        >
          {refreshing ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Refreshing…
            </span>
          ) : pullDistance >= PULL_THRESHOLD ? (
            <span className="inline-flex items-center gap-1.5 text-mse-navy font-semibold">
              <RefreshCw className="w-4 h-4" />
              Release to refresh
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw
                className="w-4 h-4"
                style={{
                  transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 270}deg)`,
                }}
              />
              Pull to refresh
            </span>
          )}
        </div>
      )}

      {/* Search input */}
      {jobs.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mse-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search business or address…"
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-mse-muted hover:text-mse-navy"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Territory chips */}
      {jobs.length > 3 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setTerritoryFilter(null)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
              territoryFilter === null
                ? "bg-mse-navy text-white"
                : "bg-mse-light text-mse-muted hover:bg-mse-light/70"
            )}
          >
            All
          </button>
          {TERRITORIES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() =>
                setTerritoryFilter(territoryFilter === t ? null : t)
              }
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-colors",
                territoryFilter === t
                  ? "bg-mse-navy text-white"
                  : "bg-mse-light text-mse-muted hover:bg-mse-light/70"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center">
          {jobs.length === 0 ? (
            <>
              <p className="text-mse-muted">No active jobs.</p>
              <p className="text-xs text-mse-muted mt-1">
                Tap the button below to create your first one.
              </p>
            </>
          ) : (
            <>
              <p className="text-mse-muted">No jobs match.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setTerritoryFilter(null);
                }}
                className="text-xs font-semibold text-mse-navy underline mt-2"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((j) => {
            const age = Math.floor(
              ageInDays(j.lastActivityDate || j.createdDate)
            );
            const stats = statsByJob[j.jobId];
            return (
              <li key={j.jobId}>
                <a
                  href={`/jobs/${encodeURIComponent(j.jobId)}`}
                  className="block bg-white rounded-2xl border border-mse-light p-4 shadow-card hover:shadow-elevated active:scale-[0.99] transition-[transform,box-shadow]"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-mse-navy truncate">
                        {j.customerName}
                      </div>
                      {j.siteAddress && (
                        <div className="text-sm text-mse-muted truncate flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 shrink-0" />
                          {j.siteAddress}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <TerritoryPill territory={j.utilityTerritory} />
                        <span className="text-xs text-mse-muted">
                          {age === 0 ? "today" : `${age}d ago`}
                        </span>
                        {stats && stats.pendingUnits > 0 && (
                          <PhotoStatusPill stats={stats} />
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-mse-muted shrink-0 mt-1" />
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PhotoStatusPill({ stats }: { stats: JobStats }) {
  const { pendingUnits, photosUploaded, photosRequired } = stats;
  const allDone = photosRequired > 0 && photosUploaded === photosRequired;
  const unitWord = pendingUnits === 1 ? "unit" : "units";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        allDone ? "bg-mse-gold/15 text-mse-navy" : "bg-mse-red/10 text-mse-red"
      )}
    >
      {allDone ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <Camera className="w-3 h-3" />
      )}
      {pendingUnits} {unitWord} · {photosUploaded}/{photosRequired}
    </span>
  );
}

function TerritoryPill({ territory }: { territory: string }) {
  const colors: Record<string, string> = {
    BGE: "bg-mse-navy/10 text-mse-navy",
    PEPCO: "bg-mse-navy/10 text-mse-navy",
    Delmarva: "bg-mse-gold/15 text-mse-navy",
    SMECO: "bg-mse-gold/15 text-mse-navy",
  };
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-medium",
        colors[territory] ?? "bg-mse-light text-mse-text"
      )}
    >
      {territory}
    </span>
  );
}
