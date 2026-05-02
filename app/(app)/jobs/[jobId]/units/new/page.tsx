import { notFound } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
import { nextUnitNumberOnJob } from "@/lib/data/units";
import { AddUnitForm } from "@/components/AddUnitForm";
import { OfflineAddUnit } from "@/components/OfflineAddUnit";

export const dynamic = "force-dynamic";

export default async function AddUnitPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);

  // Offline-only parent job: source the job + draft-unit count from
  // IndexedDB on the client.
  if (jobId.startsWith("local-job-")) {
    return <OfflineAddUnit jobId={jobId} />;
  }

  const [job, nextNumber] = await Promise.all([
    getJob(jobId),
    nextUnitNumberOnJob(jobId),
  ]);
  if (!job) notFound();
  return <AddUnitForm job={job} nextUnitNumber={nextNumber} />;
}
