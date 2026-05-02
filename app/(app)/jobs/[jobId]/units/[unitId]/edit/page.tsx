import { notFound } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
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
  const [job, unit] = await Promise.all([getJob(jobId), getUnit(unitId)]);
  if (!job || !unit) notFound();

  return <EditUnitForm job={job} unit={unit} />;
}
