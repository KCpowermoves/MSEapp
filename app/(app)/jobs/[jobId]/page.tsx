import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob } from "@/lib/data/jobs";
import { findDraftDispatch } from "@/lib/data/dispatches";
import { listUnitsForDispatch } from "@/lib/data/units";
import { listActiveTechNames } from "@/lib/data/techs";
import { todayIsoDate } from "@/lib/utils";
import { JobDetail } from "@/components/JobDetail";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) notFound();

  const draft = await findDraftDispatch(jobId, todayIsoDate());
  const [session, units, activeTechs] = await Promise.all([
    getSession(),
    draft ? listUnitsForDispatch(draft.dispatchId) : Promise.resolve([]),
    listActiveTechNames(),
  ]);

  return (
    <JobDetail
      job={job}
      todaysDispatchId={draft?.dispatchId ?? null}
      todaysUnits={units}
      activeTechs={activeTechs}
      currentUserName={session.name ?? ""}
    />
  );
}
