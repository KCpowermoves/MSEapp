import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { ensureDraftDispatch, listAllDispatches } from "@/lib/data/dispatches";
import { listUnitsForJob } from "@/lib/data/units";
import { ServiceUnitsForm } from "@/components/ServiceUnitsForm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function ServicePage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    // Offline-only jobs use the legacy OfflineAddUnit flow until
    // they sync to a real jobId.
    redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }
  const session = await getSession();
  const job = await getJob(jobId);
  if (!job) notFound();
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) notFound();

  // Today's draft dispatch — created on-demand if none exists yet
  // for today. New units posted via /api/units land on this dispatch.
  const todaysDispatch = await ensureDraftDispatch(jobId);

  // All non-deleted units for this job, joined with their dispatch
  // metadata so the cards can show the "Submitted · date" badge for
  // prior-day units.
  const [units, dispatches] = await Promise.all([
    listUnitsForJob(jobId),
    listAllDispatches(),
  ]);
  const dispatchById = new Map(dispatches.map((d) => [d.dispatchId, d]));
  const activeUnits = units
    .filter((u) => !u.deleted)
    .map((u) => {
      const d = dispatchById.get(u.dispatchId);
      return {
        ...u,
        dispatchDate: d?.dispatchDate ?? "",
        dispatchSubmittedAt: d?.submittedAt ?? "",
      };
    });

  return (
    <ServiceUnitsForm
      job={job}
      initialUnits={activeUnits}
      todaysDispatch={todaysDispatch}
      currentUserName={session.name ?? ""}
    />
  );
}
