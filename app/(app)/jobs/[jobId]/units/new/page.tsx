import { notFound } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
import { AddUnitForm } from "@/components/AddUnitForm";

export const dynamic = "force-dynamic";

export default async function AddUnitPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) notFound();
  return <AddUnitForm job={job} />;
}
