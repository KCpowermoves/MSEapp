import Link from "next/link";
import { ArrowLeft, Calculator, Plus, Thermometer } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { listAllEngineeringProjects } from "@/lib/data/engineering-projects";

export const dynamic = "force-dynamic";

export default async function EngineeringListPage() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const projects = await listAllEngineeringProjects();
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Admin
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <header>
          <div className="text-sm text-mse-muted">Admin</div>
          <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
            <Calculator className="w-7 h-7 text-mse-gold" />
            Engineering
          </h1>
          <p className="text-sm text-mse-muted mt-1 max-w-2xl">
            Preliminary energy audits. Fill in project info + utility bills +
            equipment, then download the populated calculator workbook and SOW
            for the customer.
          </p>
        </header>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/admin/engineering/bin-maker"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-mse-navy border-2 border-mse-navy hover:bg-mse-navy hover:text-white active:scale-95"
          >
            <Thermometer className="w-4 h-4" />
            Bin Maker Pro
          </Link>
          <Link
            href="/admin/engineering/new"
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold bg-mse-navy text-white hover:bg-mse-navy-soft shadow-card active:scale-95"
          >
            <Plus className="w-4 h-4" />
            New project
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center">
          <p className="text-mse-muted">No engineering projects yet.</p>
          <p className="text-xs text-mse-muted mt-1">
            Tap <strong>New project</strong> to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.projectId}>
              <Link
                href={`/admin/engineering/${encodeURIComponent(p.projectId)}`}
                className="block bg-white rounded-2xl border border-mse-light p-4 shadow-card hover:shadow-elevated active:scale-[0.99] transition-[transform,box-shadow]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-mse-navy truncate">
                      {p.customerName || "(Unnamed project)"}
                    </div>
                    <div className="text-xs text-mse-muted mt-0.5 truncate">
                      {p.siteAddress || "no address"}
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px]">
                      <span className="px-2 py-0.5 rounded-full bg-mse-light text-mse-navy font-semibold">
                        {p.utility}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-mse-gold/15 text-mse-navy font-semibold">
                        {p.location}
                      </span>
                      <span
                        className={
                          p.status === "Final"
                            ? "px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold"
                            : "px-2 py-0.5 rounded-full bg-mse-gold/20 text-mse-navy font-semibold"
                        }
                      >
                        {p.status}
                      </span>
                      <span className="text-mse-muted font-mono">
                        {p.projectId}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-[11px] text-mse-muted">
                    {formatStamp(p.updatedAt)}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatStamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
