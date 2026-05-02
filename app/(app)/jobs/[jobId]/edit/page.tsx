import { notFound } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
import { listActiveTechNames } from "@/lib/data/techs";
import { EditJobForm } from "@/components/EditJobForm";

export const dynamic = "force-dynamic";

export default async function EditJobPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const [job, activeTechs] = await Promise.all([
    getJob(jobId),
    listActiveTechNames(),
  ]);
  if (!job) notFound();

  return <EditJobForm job={job} activeTechs={activeTechs} />;
}
