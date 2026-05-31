import { Camera, Image as ImageIcon, Users, Wrench } from "lucide-react";
import { buildLibrarySnapshot } from "@/lib/admin/library";
import { LibraryBrowser } from "@/components/admin/LibraryBrowser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function AdminLibraryPage() {
  const snapshot = await buildLibrarySnapshot();

  return (
    <div className="space-y-6">
      <header>
        <div className="text-sm text-mse-muted">Admin · Drive-backed</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <ImageIcon className="w-7 h-7 text-mse-gold" />
          Library
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Every photo every tech has captured, grouped by job. Filter by
          customer, tech, date, or unit type. Click any thumbnail for the
          full image. Google Drive stays the source of truth — this view
          is read-only.
        </p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SnapshotStat
          icon={<Camera className="w-3.5 h-3.5" />}
          label="Photos"
          value={snapshot.totalPhotos}
          accent="gold"
        />
        <SnapshotStat
          icon={<Wrench className="w-3.5 h-3.5" />}
          label="Units"
          value={snapshot.totalUnits}
        />
        <SnapshotStat
          icon={<Users className="w-3.5 h-3.5" />}
          label="Jobs with photos"
          value={snapshot.totalJobs}
        />
        <SnapshotStat
          icon={<Camera className="w-3.5 h-3.5" />}
          label="Active techs"
          value={snapshot.techList.length}
        />
      </section>

      <LibraryBrowser snapshot={snapshot} />
    </div>
  );
}

function SnapshotStat({
  icon,
  label,
  value,
  accent = "muted",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: "gold" | "muted";
}) {
  const tile =
    accent === "gold"
      ? "bg-mse-gold/15 border border-mse-gold/40 text-mse-navy"
      : "bg-white border border-mse-light text-mse-navy";
  const labelClass =
    accent === "gold" ? "text-mse-navy/75" : "text-mse-muted";
  return (
    <div className={`rounded-xl px-3.5 py-2.5 ${tile}`}>
      <div
        className={`text-[11px] uppercase tracking-[0.12em] font-bold flex items-center gap-1 ${labelClass}`}
      >
        {icon}
        {label}
      </div>
      <div className="font-bold tabular-nums text-2xl mt-0.5">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
