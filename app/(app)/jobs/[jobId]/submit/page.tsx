import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { findDraftDispatch } from "@/lib/data/dispatches";
import { listUnitsForDispatch } from "@/lib/data/units";
import { listServicesForDispatch } from "@/lib/data/services";
import { listActiveTechNames } from "@/lib/data/techs";
import { todayIsoDate } from "@/lib/utils";
import { SubmitDispatchForm } from "@/components/SubmitDispatchForm";

export const dynamic = "force-dynamic";

export default async function SubmitDispatchPage({
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
  const draft = await findDraftDispatch(jobId, todayIsoDate());
  if (!draft) {
    redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }
  const [units, services, activeTechs] = await Promise.all([
    listUnitsForDispatch(draft.dispatchId),
    listServicesForDispatch(draft.dispatchId),
    listActiveTechNames(),
  ]);
  return (
    <SubmitDispatchForm
      job={job}
      dispatchId={draft.dispatchId}
      units={units}
      services={services}
      activeTechs={activeTechs}
      currentUserName={session.name ?? ""}
    />
  );
}
