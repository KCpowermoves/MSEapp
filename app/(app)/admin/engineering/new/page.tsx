import Link from "next/link";
import { ArrowLeft, Calculator } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { NewEngineeringProjectForm } from "@/components/engineering/NewEngineeringProjectForm";

export const dynamic = "force-dynamic";

export default async function NewEngineeringProjectPage() {
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
        <div className="text-sm text-mse-muted">Engineering</div>
        <h1 className="text-3xl font-bold text-mse-navy tracking-tight flex items-center gap-2">
          <Calculator className="w-7 h-7 text-mse-gold" />
          New project
        </h1>
        <p className="text-sm text-mse-muted mt-1 max-w-2xl">
          Start a new preliminary energy audit. Pick the basics now — you can
          fill in equipment, bills, and ECMs on the next page.
        </p>
      </header>

      <NewEngineeringProjectForm />
    </div>
  );
}
