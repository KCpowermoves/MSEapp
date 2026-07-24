import { notFound } from "next/navigation";
import { getSession, loadActiveTechs } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { EditJobForm } from "@/components/EditJobForm";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const session = await getSession();
  const job = await getJob(jobId);
  if (!job) notFound();

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();

  const techs = await loadActiveTechs();
  const techNames = techs
    .filter((t) => !t.isSales)
    .map((t) => t.name)
    .sort();

  return <EditJobForm job={job} techNames={techNames} />;
}
