import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Handshake } from "lucide-react";
import { getSession, loadActiveTechs } from "@/lib/auth";
import { NewLeadForm } from "@/components/leads/NewLeadForm";

export const dynamic = "force-dynamic";

// Sales lead capture — any active login (tech or sales-only) can sell.

export default async function NewLeadPage() {
  const session = await getSession();
  if (!session.techId) redirect("/login");

  const techs = await loadActiveTechs();
  const crewTechs = techs
    .filter((t) => t.crewEligible && !t.isSales)
    .map((t) => t.name)
    .sort();

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-10">
      <div>
        <Link
          href="/jobs"
          className="inline-flex items-center gap-1 text-xs font-semibold text-mse-muted hover:text-mse-navy"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </Link>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2 mt-1">
          <Handshake className="w-7 h-7 text-mse-gold" />
          New lead
        </h1>
        <p className="text-sm text-mse-muted mt-1">
          Save the customer, pick the program, and the signed agreement
          creates the job automatically. You&apos;re the agent of record —
          sales credit is yours.
        </p>
      </div>

      <NewLeadForm crewTechs={crewTechs} />
    </div>
  );
}
