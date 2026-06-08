import Link from "next/link";
import { ArrowLeft, Shield, User } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { loadAllTechs } from "@/lib/auth";
import { listRecentImpersonations } from "@/lib/data/impersonation-log";
import { ImpersonateButton } from "@/components/admin/ImpersonateButton";

export const dynamic = "force-dynamic";

export default async function AdminTechsPage() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const [techs, recent] = await Promise.all([
    loadAllTechs(),
    listRecentImpersonations(10),
  ]);
  const activeTechs = techs
    .filter((t) => t.active)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Admin
      </Link>

      <header>
        <div className="text-sm text-mse-muted">Admin</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <Shield className="w-7 h-7 text-mse-gold" />
          View as Tech
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Diagnose what a tech sees — pick one to view the app from their
          identity. A persistent yellow banner reminds you you&apos;re
          impersonating; tap Exit to return.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Active techs
        </h2>
        <ul className="space-y-2">
          {activeTechs.map((t) => (
            <li
              key={t.techId}
              className="bg-white rounded-2xl border border-mse-light p-4 shadow-card flex items-center gap-3"
            >
              <div className="w-10 h-10 rounded-full bg-mse-navy/10 flex items-center justify-center text-mse-navy font-bold text-sm shrink-0">
                {t.name
                  .split(" ")
                  .map((p) => p[0] ?? "")
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-mse-navy truncate flex items-center gap-1.5">
                  {t.name}
                  {t.isAdmin && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-mse-gold/20 text-mse-navy px-1.5 py-0.5 rounded">
                      Admin
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-mse-muted font-mono">{t.techId}</div>
              </div>
              <ImpersonateButton
                targetTechId={t.techId}
                targetName={t.name}
              />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide mb-3">
          Recent impersonations
        </h2>
        {recent.length === 0 ? (
          <p className="text-xs text-mse-muted italic">No impersonations yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((e) => (
              <li
                key={e.logId}
                className="text-xs text-mse-muted bg-white border border-mse-light rounded-lg px-3 py-2 flex items-center justify-between gap-2"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <User className="w-3 h-3 shrink-0" />
                  <strong className="text-mse-navy">{e.adminName}</strong>
                  <span>
                    {e.eventType === "Start" ? "started impersonating" : "exited impersonation of"}
                  </span>
                  <strong className="text-mse-navy truncate">{e.targetName}</strong>
                </span>
                <span className="text-mse-muted/80 whitespace-nowrap">
                  {formatStamp(e.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function formatStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
