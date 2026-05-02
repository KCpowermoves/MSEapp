import { notFound } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
import { nextUnitNumberOnJob } from "@/lib/data/units";
import { AddUnitForm } from "@/components/AddUnitForm";

export const dynamic = "force-dynamic";

export default async function AddUnitPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const [job, nextNumber] = await Promise.all([
    getJob(jobId),
    nextUnitNumberOnJob(jobId),
  ]);
  if (!job) notFound();
  return <AddUnitForm job={job} nextUnitNumber={nextNumber} />;
}
