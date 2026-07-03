import Link from "next/link";
import { ArrowLeft, Thermometer } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { COMMON_STATIONS } from "@/lib/engineering/bin-maker";
import { BinMakerClient } from "@/components/engineering/BinMakerClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bin Maker Pro — MSE Field" };

export default async function BinMakerPage() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/engineering"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Engineering
      </Link>

      <header>
        <div className="text-sm text-mse-muted">Engineering tool</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <Thermometer className="w-7 h-7 text-mse-gold" />
          Bin Maker Pro
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Live TMY3 bin-method calculator. Pick a weather station, an operating
          schedule, and the months you care about — get an hours-per-bin table
          with mean coincident wet bulb + HDD/CDD suitable for HVAC load calcs.
          Data pulled from NREL.
        </p>
      </header>

      <BinMakerClient stations={COMMON_STATIONS} />
    </div>
  );
}
