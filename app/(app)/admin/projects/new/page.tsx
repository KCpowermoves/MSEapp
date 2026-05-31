import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { listActiveTechNames } from "@/lib/data/techs";
import { loadActiveTechs } from "@/lib/auth";
import { NewProjectForm } from "@/components/admin/NewProjectForm";

export const dynamic = "force-dynamic";

export default async function AdminNewProjectPage() {
  const [crewEligible, allTechs] = await Promise.all([
    listActiveTechNames(),
    loadActiveTechs(),
  ]);

  // Sales reps and project leads aren't restricted to crew-eligible
  // techs — office admins can be either. Pull the full active list
  // for those two dropdowns and the crew-eligible subset for the
  // on-site crew picker.
  const allActiveNames = allTechs
    .filter((t) => t.active)
    .map((t) => t.name)
    .sort();

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
          <Sparkles className="w-7 h-7 text-mse-gold" />
          New project
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Set up a project end-to-end: customer + address + utility +
          role assignments. Saves a Job row, creates the Drive folder,
          and seeds today&apos;s draft dispatch with the crew you pick.
        </p>
      </header>

      <NewProjectForm
        crewEligibleTechs={crewEligible}
        allTechs={allActiveNames}
      />
    </div>
  );
}
