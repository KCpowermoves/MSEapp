import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
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

  const session = await getSession();
  const [job, nextNumber] = await Promise.all([
    getJob(jobId),
    nextUnitNumberOnJob(jobId),
  ]);
  if (!job) notFound();
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();
  return <AddUnitForm job={job} nextUnitNumber={nextNumber} />;
}
