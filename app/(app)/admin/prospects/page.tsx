import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Handshake, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { listAllProspects } from "@/lib/data/prospects";
import { ProspectUploader } from "@/components/admin/ProspectUploader";
import { ClearListButton } from "@/components/admin/ClearListButton";
import type { Prospect } from "@/lib/types";

export const dynamic = "force-dynamic";

// Admin: upload a spreadsheet of prospects for sales reps to pull from
// in the New Lead picker.

export default async function AdminProspectsPage() {
  const session = await getSession();
  if (!session.techId) redirect("/login");
  if (!session.isAdmin) redirect("/jobs");

  const all = await listAllProspects();
  const available = all.filter((p) => p.status === "New");
  const used = all.length - available.length;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs font-semibold text-mse-muted hover:text-mse-navy"
        >
          <ArrowLeft className="w-3 h-3" />
          Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2 mt-1">
          <Users className="w-7 h-7 text-mse-gold" />
          Prospect list
        </h1>
        <p className="text-sm text-mse-muted mt-1">
          Upload a spreadsheet of prospects. Reps see them in a dropdown under
          the scan-a-bill button on New Lead — one tap prefills the whole form,
          ready to sign.
        </p>
      </div>

      <section className="rounded-2xl bg-white border border-mse-light shadow-card p-5">
        <ProspectUploader available={available.length} used={used} />
      </section>

      {available.length > 0 &&
        groupByList(available).map(([listName, rows]) => (
          <section key={listName || "__none__"}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-mse-muted uppercase tracking-wide flex items-center gap-1.5">
                <Handshake className="w-4 h-4" />
                {listName || "Unsorted"} ({rows.length})
              </h2>
              <ClearListButton listName={listName} count={rows.length} />
            </div>
            <div className="bg-white rounded-2xl border border-mse-light shadow-card divide-y divide-mse-light">
              {rows.slice(0, 50).map((p) => (
                <div key={p.prospectId} className="p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-mse-navy truncate">
                      {p.address || p.businessName || p.contactName || p.prospectId}
                    </div>
                    <div className="text-xs text-mse-muted truncate">
                      {[
                        p.businessName,
                        [p.city, p.zip].filter(Boolean).join(" "),
                        p.phone,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  {p.utility && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-mse-muted shrink-0">
                      {p.utility}
                    </span>
                  )}
                  {p.agent && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-mse-light text-mse-muted rounded-full px-2 py-0.5 shrink-0">
                      {p.agent}
                    </span>
                  )}
                </div>
              ))}
              {rows.length > 50 && (
                <div className="p-3 text-center text-xs text-mse-muted">
                  + {rows.length - 50} more
                </div>
              )}
            </div>
          </section>
        ))}
    </div>
  );
}

/** Group available prospects by list name, newest-imported list first. */
function groupByList(rows: Prospect[]): Array<[string, Prospect[]]> {
  const map = new Map<string, Prospect[]>();
  const order: string[] = [];
  // Preserve most-recent-import order across lists.
  const byRecent = [...rows].sort((a, b) =>
    (b.importedAt || "").localeCompare(a.importedAt || "")
  );
  for (const p of byRecent) {
    if (!map.has(p.listName)) {
      map.set(p.listName, []);
      order.push(p.listName);
    }
    map.get(p.listName)!.push(p);
  }
  // Within each list, sort by address for easy scanning.
  for (const name of order) {
    map.get(name)!.sort((a: Prospect, b: Prospect) =>
      (a.address || "~").localeCompare(b.address || "~", undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  }
  return order.map((name) => [name, map.get(name)!]);
}
