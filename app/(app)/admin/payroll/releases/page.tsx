import Link from "next/link";
import { ArrowLeft, HandCoins } from "lucide-react";
import { computeDeferralLedger } from "@/lib/payroll/deferrals";
import { ReleasesBoard } from "@/components/payroll/ReleasesBoard";
import { requireAdmin } from "@/lib/payroll/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ReleasesPage() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const ledger = await computeDeferralLedger();

  return (
    <div className="space-y-6">
      <Link
        href="/admin/payroll"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Payroll
      </Link>

      <header>
        <div className="text-sm text-mse-muted">Payroll</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <HandCoins className="w-7 h-7 text-mse-gold" />
          Second-half releases
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Deferred pay held from weekly reports, released when the client
          pays MSE. Mark a job <strong>Client Paid</strong>, review, and
          approve — approved releases land on the next Thursday report
          automatically.
        </p>
      </header>

      <ReleasesBoard initialLedger={ledger} />
    </div>
  );
}
