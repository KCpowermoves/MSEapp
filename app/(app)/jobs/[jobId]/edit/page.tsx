import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { listActiveTechNames } from "@/lib/data/techs";
import { EditJobForm } from "@/components/EditJobForm";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const session = await getSession();
  const [job, activeTechs] = await Promise.all([
    getJob(jobId),
    listActiveTechNames(),
  ]);
  if (!job) notFound();

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();

  return <EditJobForm job={job} activeTechs={activeTechs} />;
}
