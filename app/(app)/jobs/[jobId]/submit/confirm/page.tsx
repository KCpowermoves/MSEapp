import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { findDispatchByDate } from "@/lib/data/dispatches";
import { listUnitsForDispatch } from "@/lib/data/units";
import { todayIsoDate } from "@/lib/utils";
import { CustomerConfirmForm } from "@/components/CustomerConfirmForm";

export const dynamic = "force-dynamic";

export default async function CustomerConfirmPage({
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
  // /submit/confirm runs AFTER /submit has finalized today's dispatch,
  // so the dispatch already has submittedAt set. Use findDispatchByDate
  // (which returns submitted dispatches too) instead of findDraftDispatch.
  const dispatch = await findDispatchByDate(jobId, todayIsoDate());
  if (!dispatch || !dispatch.submittedAt) {
    // No submitted dispatch yet — tech needs to do the crew/pay step
    // first. Bounce them to /submit.
    redirect(`/jobs/${encodeURIComponent(jobId)}/submit`);
  }
  const units = await listUnitsForDispatch(dispatch.dispatchId);
  return (
    <CustomerConfirmForm
      job={job}
      dispatchId={dispatch.dispatchId}
      defaultEmail={dispatch.customerEmail}
      preview={{
        dispatchDate: dispatch.dispatchDate,
        techsOnSite: dispatch.techsOnSite,
        unitsServiced: units.map((u) => ({
          unitNumberOnJob: u.unitNumberOnJob,
          unitType: u.unitType,
          label: u.label,
          make: u.make,
          model: u.model,
        })),
      }}
    />
  );
}
