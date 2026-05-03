import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  DollarSign,
  ExternalLink,
  MapPin,
  Wrench,
} from "lucide-react";
import { getSession, loadActiveTechs } from "@/lib/auth";
import { listAllJobs } from "@/lib/data/jobs";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllUnits, unitPhotoCounts } from "@/lib/data/units";
import { TABS, readTab } from "@/lib/google/sheets";
import { ageInDays, formatCurrency, todayIsoDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const session = await getSession();
  if (!session.techId) redirect("/login");
  if (!session.isAdmin) redirect("/jobs");

  const [
    jobs,
    dispatches,
    units,
    techs,
    payAttribRows,
    locationRows,
  ] = await Promise.all([
    listAllJobs(),
    listAllDispatches(),
    listAllUnits(),
    loadActiveTechs(),
    readTab(TABS.payAttribution),
    readTab(TABS.locationEvents).catch(() => []),
  ]);

  const today = todayIsoDate();
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().slice(0, 10);
  });

  // ── This-week pay rollup per tech ─────────────────────────────────────
  interface TechRow {
    name: string;
    payThisWeek: number;
    unitsThisWeek: number;
    payToday: number;
    unitsToday: number;
    lastSeenAt?: string;
    lastSeenLat?: number;
    lastSeenLng?: number;
  }
  const techMap = new Map<string, TechRow>();
  for (const t of techs) {
    techMap.set(t.name, {
      name: t.name,
      payThisWeek: 0,
      unitsThisWeek: 0,
      payToday: 0,
      unitsToday: 0,
    });
  }

  for (const r of payAttribRows) {
    const date = String(r[1] ?? "").slice(0, 10);
    const techName = String(r[3] ?? "");
    const lineItem = String(r[4] ?? "");
    const amount = Number(r[5] ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (!last7Days.includes(date)) continue;
    const row = techMap.get(techName);
    if (!row) continue;
    row.payThisWeek += amount;
    if (lineItem === "Install") row.unitsThisWeek += 1;
    if (date === today) {
      row.payToday += amount;
      if (lineItem === "Install") row.unitsToday += 1;
    }
  }

  for (const r of locationRows) {
    const techName = String(r[2] ?? "");
    const ts = String(r[1] ?? "");
    const lat = Number(r[4] ?? NaN);
    const lng = Number(r[5] ?? NaN);
    const row = techMap.get(techName);
    if (!row) continue;
    if (!row.lastSeenAt || ts > row.lastSeenAt) {
      row.lastSeenAt = ts;
      if (Number.isFinite(lat)) row.lastSeenLat = lat;
      if (Number.isFinite(lng)) row.lastSeenLng = lng;
    }
  }

  const techRows = Array.from(techMap.values()).sort(
    (a, b) => b.payThisWeek - a.payThisWeek
  );

  // ── Today / week totals ───────────────────────────────────────────────
  const totalPayThisWeek = techRows.reduce((s, t) => s + t.payThisWeek, 0);
  const totalPayToday = techRows.reduce((s, t) => s + t.payToday, 0);
  const totalUnitsThisWeek = techRows.reduce((s, t) => s + t.unitsThisWeek, 0);

  // ── Photo audit: jobs with units missing photos ───────────────────────
  const submittedDispatchIds = new Set(
    dispatches.filter((d) => d.submittedAt).map((d) => d.dispatchId)
  );
  const auditFlags: {
    jobId: string;
    customerName: string;
    unitId: string;
    unitNumber: number;
    unitType: string;
    uploaded: number;
    required: number;
    submitted: boolean;
  }[] = [];
  const jobsById = new Map(jobs.map((j) => [j.jobId, j]));
  for (const u of units) {
    const { uploaded, required } = unitPhotoCounts(u);
    if (uploaded === required) continue;
    const job = jobsById.get(u.jobId);
    if (!job) continue;
    auditFlags.push({
      jobId: u.jobId,
      customerName: job.customerName,
      unitId: u.unitId,
      unitNumber: u.unitNumberOnJob,
      unitType: u.unitType,
      uploaded,
      required,
      submitted: submittedDispatchIds.has(u.dispatchId),
    });
  }
  auditFlags.sort((a, b) => {
    // Submitted-but-incomplete first (urgent — shouldn't happen)
    if (a.submitted !== b.submitted) return a.submitted ? -1 : 1;
    return a.uploaded / a.required - b.uploaded / b.required;
  });

  // ── Recent activity: jobs submitted in the last 7 days ─────────────────
  const recentSubmissions = dispatches
    .filter((d) => d.submittedAt && last7Days.includes(d.dispatchDate))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-mse-muted">Admin</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight">
          Dashboard
        </h1>
        <p className="text-xs text-mse-muted mt-1">
          Read-only view of the last 7 days. Refresh after submissions.
        </p>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Pay this week"
          value={formatCurrency(totalPayThisWeek)}
          icon={<DollarSign className="w-4 h-4" />}
          accent="navy"
        />
        <StatCard
          label="Pay today"
          value={formatCurrency(totalPayToday)}
          icon={<DollarSign className="w-4 h-4" />}
          accent="gold"
        />
        <StatCard
          label="Units 7d"
          value={String(totalUnitsThisWeek)}
          icon={<Wrench className="w-4 h-4" />}
          accent="muted"
        />
      </div>

      {/* Per-tech breakdown */}
      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Tech rollup · last 7 days
        </h2>
        <div className="bg-white rounded-2xl border border-mse-light shadow-card divide-y divide-mse-light">
          {techRows.length === 0 ? (
            <div className="p-8 text-center text-mse-muted text-sm">
              No active techs.
            </div>
          ) : (
            techRows.map((t) => {
              const lastSeenAge = t.lastSeenAt
                ? Math.floor(ageInDays(t.lastSeenAt))
                : null;
              const mapsLink =
                t.lastSeenLat !== undefined && t.lastSeenLng !== undefined
                  ? `https://www.google.com/maps?q=${t.lastSeenLat},${t.lastSeenLng}`
                  : null;
              return (
                <div key={t.name} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-mse-navy">{t.name}</div>
                    <div className="font-mono font-bold text-mse-navy">
                      {formatCurrency(t.payThisWeek)}
                    </div>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs text-mse-muted">
                    <div className="flex items-center gap-1">
                      <Wrench className="w-3 h-3" />
                      <span>
                        {t.unitsThisWeek} unit{t.unitsThisWeek === 1 ? "" : "s"}
                        {" · "}
                        <span className="text-mse-navy">
                          {formatCurrency(t.payToday)} today
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-1 justify-end">
                      <MapPin className="w-3 h-3 shrink-0" />
                      {mapsLink ? (
                        <a
                          href={mapsLink}
                          target="_blank"
                          rel="noopener"
                          className="hover:text-mse-navy underline-offset-2 hover:underline truncate"
                        >
                          last seen{" "}
                          {lastSeenAge === 0
                            ? "today"
                            : lastSeenAge !== null
                            ? `${lastSeenAge}d ago`
                            : ""}
                        </a>
                      ) : (
                        <span className="text-mse-muted">no location yet</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Photo audit */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide">
            Photo audit
          </h2>
          <span className="text-xs text-mse-muted">
            {auditFlags.length} unit{auditFlags.length === 1 ? "" : "s"} missing
            photos
          </span>
        </div>
        {auditFlags.length === 0 ? (
          <div className="rounded-2xl bg-mse-gold/10 border border-mse-gold/30 p-4 text-sm text-mse-navy flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-mse-gold shrink-0" />
            All units have their required photos. Nice.
          </div>
        ) : (
          <ul className="space-y-2">
            {auditFlags.slice(0, 12).map((u) => (
              <li
                key={u.unitId}
                className="bg-white rounded-2xl border border-mse-light p-3 shadow-card"
              >
                <div className="flex items-center gap-2">
                  {u.submitted ? (
                    <AlertTriangle className="w-4 h-4 text-mse-red shrink-0" />
                  ) : (
                    <CircleDashed className="w-4 h-4 text-mse-muted shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-mse-navy truncate">
                      {u.customerName}{" "}
                      <span className="text-mse-muted font-normal">
                        · Unit {String(u.unitNumber).padStart(3, "0")}{" "}
                        {u.unitType}
                      </span>
                    </div>
                    <div className="text-xs text-mse-muted">
                      {u.uploaded}/{u.required} photos uploaded
                      {u.submitted && (
                        <span className="text-mse-red font-semibold ml-1">
                          · submitted but incomplete
                        </span>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/jobs/${encodeURIComponent(u.jobId)}/units/${encodeURIComponent(u.unitId)}/edit`}
                    className="text-xs text-mse-navy font-semibold hover:underline shrink-0"
                  >
                    Edit
                  </a>
                </div>
              </li>
            ))}
            {auditFlags.length > 12 && (
              <li className="text-xs text-mse-muted text-center">
                + {auditFlags.length - 12} more
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Recent submissions */}
      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Recent submissions
        </h2>
        {recentSubmissions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-mse-light p-6 text-center text-sm text-mse-muted">
            No jobs submitted in the last 7 days.
          </div>
        ) : (
          <ul className="space-y-2">
            {recentSubmissions.map((d) => {
              const job = jobsById.get(d.jobId);
              return (
                <li
                  key={d.dispatchId}
                  className="bg-white rounded-2xl border border-mse-light p-3 shadow-card"
                >
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-mse-muted shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-mse-navy truncate">
                        {job?.customerName ?? d.jobId}
                      </div>
                      <div className="text-xs text-mse-muted">
                        {d.dispatchDate} · {d.techsOnSite.join(", ") || "no crew"} ·{" "}
                        {d.crewSplit}
                        {d.signatureUrl && " · signed"}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide",
                        d.photosComplete
                          ? "bg-mse-gold/15 text-mse-navy"
                          : "bg-mse-red/10 text-mse-red"
                      )}
                    >
                      {d.photosComplete ? "complete" : "incomplete"}
                    </span>
                    {job?.driveFolderUrl && (
                      <a
                        href={job.driveFolderUrl}
                        target="_blank"
                        rel="noopener"
                        className="text-mse-muted hover:text-mse-navy ml-1"
                        aria-label="Open Drive folder"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="text-xs text-mse-muted text-center pt-4 pb-8">
        <Camera className="w-3 h-3 inline mr-1" />
        For full data drill-down see the Google Sheet.
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent: "navy" | "gold" | "muted";
}) {
  const styles = {
    navy: "bg-mse-navy text-white",
    gold: "bg-mse-gold/15 border border-mse-gold/30 text-mse-navy",
    muted: "bg-white border border-mse-light text-mse-navy",
  }[accent];
  return (
    <div className={cn("rounded-2xl p-3 shadow-card", styles)}>
      <div className="text-[10px] uppercase tracking-wider opacity-70 font-semibold flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold tracking-tight mt-1 truncate">{value}</div>
    </div>
  );
}
