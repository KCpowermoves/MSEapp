import Link from "next/link";
import { ArrowRight, Building2, MapPin, Users, Wrench } from "lucide-react";
import { listCustomers } from "@/lib/admin/customers";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function AdminCustomersPage() {
  const customers = await listCustomers();
  const totalJobs = customers.reduce((s, c) => s + c.jobCount, 0);
  const totalUnits = customers.reduce((s, c) => s + c.unitCount, 0);

  return (
    <div className="space-y-6">
      <header>
        <div className="text-sm text-mse-muted">Admin</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <Building2 className="w-7 h-7 text-mse-gold" />
          Customers
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Rolled up from every job in the Jobs sheet. Click a customer for
          their full history, photos, and documents.
        </p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        <CustomerStat
          label="Customers"
          value={customers.length}
          icon={<Building2 className="w-3.5 h-3.5" />}
          accent="gold"
        />
        <CustomerStat
          label="Jobs"
          value={totalJobs}
          icon={<Wrench className="w-3.5 h-3.5" />}
        />
        <CustomerStat
          label="Units"
          value={totalUnits}
          icon={<Wrench className="w-3.5 h-3.5" />}
        />
      </section>

      {customers.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-mse-light p-10 text-center text-sm text-mse-muted">
          No customers yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {customers.map((c) => (
            <li key={c.customerName}>
              <Link
                href={`/admin/customers/${encodeURIComponent(c.customerName)}`}
                className={cn(
                  "block bg-white rounded-2xl border-2 border-mse-light hover:border-mse-navy/20",
                  "shadow-card hover:shadow-elevated transition-[border-color,box-shadow]",
                  "p-4 group"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-mse-navy/10 flex items-center justify-center text-mse-navy font-bold text-sm shrink-0">
                    {initials(c.customerName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-mse-navy truncate">
                      {c.customerName}
                    </div>
                    <div className="text-xs text-mse-muted mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>
                        {c.jobCount} job{c.jobCount === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span>
                        {c.unitCount} unit{c.unitCount === 1 ? "" : "s"}
                      </span>
                      {c.utilityTerritories.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {c.utilityTerritories.join(", ")}
                          </span>
                        </>
                      )}
                      {c.techNames.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {c.techNames.slice(0, 3).join(", ")}
                            {c.techNames.length > 3 &&
                              ` +${c.techNames.length - 3}`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-mse-muted">Last seen</div>
                    <div className="text-sm font-semibold text-mse-navy">
                      {formatDate(c.lastActivityIso)}
                    </div>
                    <div className="inline-flex items-center gap-1 text-[11px] text-mse-muted mt-1">
                      Open
                      <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                    </div>
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

function CustomerStat({
  label,
  value,
  icon,
  accent = "muted",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
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
