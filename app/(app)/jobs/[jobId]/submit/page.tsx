import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob } from "@/lib/data/jobs";
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
  const job = await getJob(jobId);
  if (!job) notFound();
  const draft = await findDraftDispatch(jobId, todayIsoDate());
  if (!draft) {
    redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }
  const [session, units, services, activeTechs] = await Promise.all([
    getSession(),
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
