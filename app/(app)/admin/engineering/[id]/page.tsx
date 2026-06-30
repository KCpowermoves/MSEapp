import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/payroll/auth";
import { getEngineeringProject } from "@/lib/data/engineering-projects";
import { EngineeringProjectForm } from "@/components/engineering/EngineeringProjectForm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function EngineeringProjectDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const projectId = decodeURIComponent(params.id);
  const project = await getEngineeringProject(projectId);
  if (!project) notFound();

  return (
    <div className="space-y-6 pb-32">
      <Link
        href="/admin/engineering"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Engineering
      </Link>

      <header className="rounded-2xl bg-gradient-to-br from-mse-navy to-mse-navy-soft text-white p-5 shadow-elevated">
        <div className="text-[11px] uppercase tracking-[0.12em] font-bold text-mse-gold">
          Engineering project · {project.projectId}
        </div>
        <h1 className="text-3xl font-bold tracking-tight mt-1">
          {project.customerName || "(Unnamed)"}
        </h1>
        <div className="text-sm font-semibold text-white/85 mt-1">
          {project.utility} · {project.location} · {project.status}
        </div>
      </header>

      <EngineeringProjectForm project={project} />
    </div>
  );
}
