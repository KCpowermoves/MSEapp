import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FolderOpen,
  MapPin,
  Users,
  Wrench,
} from "lucide-react";
import { getCustomerDetail } from "@/lib/admin/customers";
import { buildLibrarySnapshot } from "@/lib/admin/library";
import type { LibraryJobCluster } from "@/lib/admin/library";
import { RenameCustomerButton } from "@/components/admin/RenameCustomerButton";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function CustomerDetailPage({
  params,
}: {
  params: { customerName: string };
}) {
  const customerName = decodeURIComponent(params.customerName);
  const [customer, snapshot] = await Promise.all([
    getCustomerDetail(customerName),
    buildLibrarySnapshot(),
  ]);
  if (!customer) notFound();

  const clustersByJobId = new Map<string, LibraryJobCluster>();
  for (const c of snapshot.clusters) {
    clustersByJobId.set(c.job.jobId, c);
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/customers"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All customers
      </Link>

      <header className="rounded-2xl bg-gradient-to-br from-mse-navy to-mse-navy-soft text-white p-6 shadow-elevated relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-16 -right-16 w-72 h-72 rounded-full bg-mse-gold/20 blur-3xl"
          aria-hidden
        />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 ring-1 ring-inset ring-white/20 flex items-center justify-center text-mse-gold font-bold text-xl shrink-0">
            {initials(customer.customerName)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-mse-gold flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" />
              Customer
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-1">
              <h1 className="text-3xl font-bold tracking-tight">
                {customer.customerName}
              </h1>
              <RenameCustomerButton
                currentName={customer.customerName}
                jobCount={customer.jobCount}
              />
            </div>
            <div className="text-sm font-semibold text-white/85 mt-1 flex items-center gap-2 flex-wrap">
              {customer.utilityTerritories.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-mse-gold" />
                  {customer.utilityTerritories.join(", ")}
                </span>
              )}
              {customer.techNames.length > 0 && (
                <>
                  <span className="text-white/40">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5 text-mse-gold" />
                    {customer.techNames.join(", ")}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-3">
          <Stat label="Jobs" value={customer.jobCount} />
          <Stat label="Units" value={customer.unitCount} />
          <Stat label="Dispatches" value={customer.dispatchCount} />
        </div>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Jobs · most recent first
        </h2>
        <ul className="space-y-3">
          {customer.jobs.map((job) => {
            const cluster = clustersByJobId.get(job.jobId);
            return (
              <li
                key={job.jobId}
                className="bg-white rounded-2xl border border-mse-light shadow-card overflow-hidden"
              >
                <div className="p-4 flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/jobs/${encodeURIComponent(job.jobId)}`}
                      className="font-bold text-mse-navy hover:underline truncate inline-block max-w-full"
                    >
                      {job.siteAddress || "(no address)"}
                    </Link>
                    <div className="text-xs text-mse-muted mt-0.5">
                      {job.jobId} · {formatDate(job.createdDate)}
                      {job.status === "Closed" && (
                        <>
                          {" · "}
                          <span className="text-mse-muted">closed</span>
                        </>
                      )}
                    </div>
                    {cluster && (
                      <div className="text-[11px] text-mse-muted mt-1">
                        <Wrench className="w-3 h-3 inline mr-0.5" />
                        {cluster.units.length} unit
                        {cluster.units.length === 1 ? "" : "s"} ·{" "}
                        {cluster.totalPhotos} photo
                        {cluster.totalPhotos === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                  {job.driveFolderUrl && (
                    <a
                      href={job.driveFolderUrl}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-mse-muted hover:text-mse-navy hover:bg-mse-light/60 transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-[#4285F4]" />
                      Drive
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  )}
                </div>
                {cluster && cluster.totalPhotos > 0 && (
                  <div className="px-4 pb-4">
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5">
                      {cluster.units
                        .flatMap((u) => u.photos)
                        .slice(0, 16)
                        .map((p, i) => (
                          <a
                            key={`${p.fileId}-${i}`}
                            href={`/jobs/${encodeURIComponent(job.jobId)}`}
                            className={cn(
                              "relative aspect-square rounded-lg overflow-hidden border border-mse-light",
                              "hover:border-mse-navy/40 active:scale-[0.97]",
                              "transition-[border-color,transform]"
                            )}
                            title={p.slotLabel}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/photo?fileId=${encodeURIComponent(
                                p.fileId
                              )}&w=200`}
                              alt={p.slotLabel}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          </a>
                        ))}
                    </div>
                    {cluster.totalPhotos > 16 && (
                      <div className="text-[11px] text-mse-muted text-right mt-2">
                        + {cluster.totalPhotos - 16} more — open the job for the
                        rest.
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/10 ring-1 ring-inset ring-white/20 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-mse-gold">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1 text-white">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
