import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { AdminNav } from "@/components/AdminNav";

// Admin section shell: gates non-admin access at the layout boundary
// and renders a tab strip across the top so the dashboard, payroll
// runs, and any future admin tools share a consistent navigation.
//
// Sub-pages are server-rendered; the tab strip is a client component
// so the active link gets a highlighted treatment without a round-trip.

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session.techId) redirect("/login");
  if (!session.isAdmin) redirect("/jobs");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 text-mse-navy"
        >
          <div className="text-[10px] uppercase tracking-[0.18em] text-mse-muted font-bold">
            Maryland Smart Energy
          </div>
        </Link>
        <Link
          href="/jobs"
          className="text-xs text-mse-muted hover:text-mse-navy"
        >
          ← Back to field app
        </Link>
      </div>
      <AdminNav />
      <div className="pt-2">{children}</div>
    </div>
  );
}
