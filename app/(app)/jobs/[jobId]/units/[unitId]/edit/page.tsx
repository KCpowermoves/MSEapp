import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { getUnit } from "@/lib/data/units";
import { EditUnitForm } from "@/components/EditUnitForm";

export const dynamic = "force-dynamic";

export default async function EditUnitPage({
  params,
}: {
  params: { jobId: string; unitId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const unitId = decodeURIComponent(params.unitId);
  const session = await getSession();
  const [job, unit] = await Promise.all([getJob(jobId), getUnit(unitId)]);
  if (!job || !unit) notFound();
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();

  return <EditUnitForm job={job} unit={unit} />;
}
