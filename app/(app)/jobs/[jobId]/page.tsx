import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob } from "@/lib/data/jobs";
import { findDraftDispatch, listAllDispatches } from "@/lib/data/dispatches";
import { listUnitsForJob } from "@/lib/data/units";
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
  const [session, allUnits, dispatches, activeTechs] = await Promise.all([
    getSession(),
    listUnitsForJob(jobId),
    listAllDispatches(),
    listActiveTechNames(),
  ]);

  // Map each unit to whether its parent dispatch has been submitted, and
  // sort: pending (today's draft) first, then submitted in reverse-chrono
  // by unit number so newest is at the top of the submitted group.
  const submittedDispatchIds = new Set(
    dispatches.filter((d) => Boolean(d.submittedAt)).map((d) => d.dispatchId)
  );
  const unitsWithStatus = allUnits
    .map((u) => ({
      ...u,
      submitted: submittedDispatchIds.has(u.dispatchId),
    }))
    .sort((a, b) => {
      if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
      return b.unitNumberOnJob - a.unitNumberOnJob;
    });

  return (
    <JobDetail
      job={job}
      todaysDispatchId={draft?.dispatchId ?? null}
      todaysUnits={unitsWithStatus}
      activeTechs={activeTechs}
      currentUserName={session.name ?? ""}
    />
  );
}
