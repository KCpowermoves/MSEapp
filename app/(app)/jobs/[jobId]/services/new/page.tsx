import { notFound } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
import { AddServiceForm } from "@/components/AddServiceForm";

export const dynamic = "force-dynamic";

export default async function AddServicePage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) notFound();
  return <AddServiceForm job={job} />;
}
