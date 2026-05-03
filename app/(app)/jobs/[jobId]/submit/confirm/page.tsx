import { notFound, redirect } from "next/navigation";
import { getJob } from "@/lib/data/jobs";
import { findDraftDispatch } from "@/lib/data/dispatches";
import { todayIsoDate } from "@/lib/utils";
import { CustomerConfirmForm } from "@/components/CustomerConfirmForm";

export const dynamic = "force-dynamic";

export default async function CustomerConfirmPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) notFound();
  const draft = await findDraftDispatch(jobId, todayIsoDate());
  if (!draft) {
    // No draft means nothing to submit yet — bounce back to job detail.
    redirect(`/jobs/${encodeURIComponent(jobId)}`);
  }
  return <CustomerConfirmForm job={job} dispatchId={draft.dispatchId} />;
}
