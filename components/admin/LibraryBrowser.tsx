"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ExternalLink,
  Filter,
  FolderOpen,
  Pencil,
  Search,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  LibraryJobCluster,
  LibraryPhoto,
  LibrarySnapshot,
  LibraryUnit,
} from "@/lib/admin/library";

interface Props {
  snapshot: LibrarySnapshot;
}

interface ActivePhoto {
  cluster: LibraryJobCluster;
  unit: LibraryUnit;
  index: number;
  photos: LibraryPhoto[];
}

const DATE_PRESETS = [
  { label: "All time", days: 0 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

export function LibraryBrowser({ snapshot }: Props) {
  const [search, setSearch] = useState("");
  const [techFilter, setTechFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [daysFilter, setDaysFilter] = useState<number>(0);
  const [active, setActive] = useState<ActivePhoto | null>(null);

  const filteredClusters = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    const cutoff =
      daysFilter > 0
        ? Date.now() - daysFilter * 24 * 60 * 60 * 1000
        : 0;
    return snapshot.clusters
      .filter((c) => {
        if (lowerSearch) {
          const haystack = [
            c.job.customerName,
            c.job.siteAddress,
            c.job.jobId,
            c.job.utilityTerritory,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(lowerSearch)) return false;
        }
        if (techFilter && !c.techNames.includes(techFilter)) return false;
        if (typeFilter) {
          const hasType = c.units.some((u) => u.unitType === typeFilter);
          if (!hasType) return false;
        }
        if (cutoff > 0) {
          const t = Date.parse(c.lastActivityIso);
          if (Number.isFinite(t) && t < cutoff) return false;
        }
        return true;
      })
      .map((c) => {
        if (!typeFilter) return c;
        return {
          ...c,
          units: c.units.filter((u) => u.unitType === typeFilter),
        };
      });
  }, [snapshot.clusters, search, techFilter, typeFilter, daysFilter]);

  const visiblePhotoCount = useMemo(
    () =>
      filteredClusters.reduce(
        (s, c) => s + c.units.reduce((sub, u) => sub + u.photos.length, 0),
        0
      ),
    [filteredClusters]
  );

  const clearAll = () => {
    setSearch("");
    setTechFilter("");
    setTypeFilter("");
    setDaysFilter(0);
  };

  const hasFilters =
    Boolean(search) || Boolean(techFilter) || Boolean(typeFilter) || daysFilter > 0;

  return (
    <>
      {/* ── Filter bar ───────────────────────────────────────────── */}
      <section className="rounded-2xl bg-white border border-mse-light shadow-card p-3 space-y-3">
        <div className="flex items-stretch gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-mse-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, address, job ID…"
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
            />
          </div>
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          >
            <option value="">All techs</option>
            {snapshot.techList.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
          >
            <option value="">All unit types</option>
            {snapshot.unitTypeList.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-mse-muted hover:text-mse-navy hover:bg-mse-light/60"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.12em] font-bold text-mse-muted">
            <CalendarDays className="w-3 h-3 inline mr-0.5" />
            Window
          </span>
          {DATE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setDaysFilter(p.days)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-[background-color,border-color,color]",
                daysFilter === p.days
                  ? "bg-mse-navy border-mse-navy text-white"
                  : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
              )}
            >
              {p.label}
            </button>
          ))}
          <div className="grow" />
          <span className="text-[11px] text-mse-muted">
            <Filter className="w-3 h-3 inline mr-0.5" />
            {filteredClusters.length} job{filteredClusters.length === 1 ? "" : "s"}
            {" · "}
            {visiblePhotoCount} photo{visiblePhotoCount === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      {/* ── Job clusters ────────────────────────────────────────── */}
      {filteredClusters.length === 0 ? (
        <section className="rounded-2xl border-2 border-dashed border-mse-light p-10 text-center text-sm text-mse-muted">
          {hasFilters
            ? "Nothing matches those filters."
            : "No jobs with photos yet."}
        </section>
      ) : (
        <div className="space-y-4">
          {filteredClusters.map((c) => (
            <JobClusterCard
              key={c.job.jobId}
              cluster={c}
              onOpen={(unit, index) =>
                setActive({ cluster: c, unit, index, photos: unit.photos })
              }
            />
          ))}
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────── */}
      {active && (
        <Lightbox
          active={active}
          onClose={() => setActive(null)}
          onPrev={() =>
            setActive((cur) =>
              cur ? { ...cur, index: Math.max(0, cur.index - 1) } : cur
            )
          }
          onNext={() =>
            setActive((cur) =>
              cur
                ? {
                    ...cur,
                    index: Math.min(cur.photos.length - 1, cur.index + 1),
                  }
                : cur
            )
          }
        />
      )}
    </>
  );
}

function JobClusterCard({
  cluster,
  onOpen,
}: {
  cluster: LibraryJobCluster;
  onOpen: (unit: LibraryUnit, index: number) => void;
}) {
  const date = formatDate(cluster.lastActivityIso);
  return (
    <section className="rounded-2xl bg-white border border-mse-light shadow-card overflow-hidden">
      <header className="px-4 py-3 border-b border-mse-light/70 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <Link
            href={`/jobs/${encodeURIComponent(cluster.job.jobId)}`}
            className="font-bold text-mse-navy hover:underline truncate inline-block max-w-full"
          >
            {cluster.job.customerName}
          </Link>
          <div className="text-xs text-mse-muted mt-0.5 truncate">
            {cluster.job.siteAddress || "no address"} · {cluster.job.jobId}
          </div>
          <div className="text-[11px] text-mse-muted mt-1 flex items-center gap-2 flex-wrap">
            <span>{date}</span>
            <span className="text-mse-light">·</span>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              {cluster.techNames.join(", ") || "—"}
            </span>
            <span className="text-mse-light">·</span>
            <span>
              {cluster.units.length} unit{cluster.units.length === 1 ? "" : "s"}
            </span>
            <span className="text-mse-light">·</span>
            <span>
              {cluster.totalPhotos} photo{cluster.totalPhotos === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {cluster.job.driveFolderUrl && (
          <a
            href={cluster.job.driveFolderUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-mse-muted hover:text-mse-navy hover:bg-mse-light/60 transition-colors shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#4285F4]" />
            Drive
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        )}
      </header>
      <div className="p-3 space-y-3">
        {cluster.units.map((u) => (
          <UnitPhotoRow
            key={u.unitId}
            unit={u}
            jobId={cluster.job.jobId}
            onOpen={(index) => onOpen(u, index)}
          />
        ))}
      </div>
    </section>
  );
}

function UnitPhotoRow({
  unit,
  jobId,
  onOpen,
}: {
  unit: LibraryUnit;
  jobId: string;
  onOpen: (index: number) => void;
}) {
  if (unit.photos.length === 0) return null;
  const displayName = unit.label?.trim()
    ? unit.label
    : `Unit ${String(unit.unitNumberOnJob).padStart(3, "0")}`;
  return (
    <div>
      <div className="text-[11px] text-mse-muted mb-1.5 flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-mse-navy text-xs">
          {displayName} · {unit.unitType}
        </span>
        {unit.make && <span>· {unit.make}</span>}
        {unit.model && (
          <span className="font-mono text-[10px]">· {unit.model}</span>
        )}
        {unit.loggedBy && <span>· logged by {unit.loggedBy}</span>}
        <Link
          href={`/jobs/${encodeURIComponent(jobId)}/units/${encodeURIComponent(unit.unitId)}/edit`}
          className="inline-flex items-center gap-0.5 text-[10px] text-mse-muted hover:text-mse-navy font-bold uppercase tracking-wide"
          title="Edit unit"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-1.5">
        {unit.photos.map((p, i) => (
          <PhotoTile
            key={`${p.fileId}-${i}`}
            photo={p}
            onClick={() => onOpen(i)}
          />
        ))}
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  onClick,
}: {
  photo: LibraryPhoto;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={photo.slotLabel}
      className={cn(
        "relative aspect-square rounded-lg overflow-hidden border border-mse-light bg-mse-light",
        "hover:border-mse-navy/40 active:scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
        "transition-[border-color,transform] group"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photo?fileId=${encodeURIComponent(photo.fileId)}&w=320`}
        alt={photo.slotLabel}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-6 px-1.5 pb-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="text-white text-[10px] font-bold truncate">
          {photo.slotLabel}
        </div>
      </div>
    </button>
  );
}

function Lightbox({
  active,
  onClose,
  onPrev,
  onNext,
}: {
  active: ActivePhoto;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const photo = active.photos[active.index];
  const total = active.photos.length;
  const displayName = active.unit.label?.trim()
    ? active.unit.label
    : `Unit ${String(active.unit.unitNumberOnJob).padStart(3, "0")}`;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-start justify-between p-3 text-white">
        <div className="min-w-0">
          <div className="font-bold truncate">
            {active.cluster.job.customerName}
          </div>
          <div className="text-xs text-white/70 truncate">
            {displayName} · {active.unit.unitType} · {photo.slotLabel}
            {" · "}
            {active.index + 1} of {total}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={photo.url}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white"
          >
            Open in Drive
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-4">
        {active.index > 0 && (
          <button
            type="button"
            onClick={onPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Previous"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/photo?fileId=${encodeURIComponent(photo.fileId)}&w=1200`}
          alt={photo.slotLabel}
          className="max-w-full max-h-full object-contain rounded-md shadow-elevated"
        />
        {active.index < total - 1 && (
          <button
            type="button"
            onClick={onNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Next"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
