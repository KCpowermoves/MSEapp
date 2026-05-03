import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { findDispatchByDate } from "@/lib/data/dispatches";
import { todayIsoDate } from "@/lib/utils";
import { CustomerFeedbackForm } from "@/components/CustomerFeedbackForm";

export const dynamic = "force-dynamic";

export default async function CustomerFeedbackPage({
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

  const dispatch = await findDispatchByDate(jobId, todayIsoDate());
  if (!dispatch || !dispatch.submittedAt) {
    redirect(`/jobs/${encodeURIComponent(jobId)}/submit`);
  }

  // The Google Reviews URL is configured per-environment so we can
  // point staging traffic somewhere harmless. Falls back to the live
  // MSE Maps page when not set.
  const googleReviewUrl =
    process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ??
    "https://search.google.com/local/writereview?placeid=";

  // Lead tech = first name in techsOnSite (the dispatch was just
  // submitted, so this list is populated). Falls back to "the MSE crew".
  const leadTech = dispatch.techsOnSite[0] ?? "";
  const techFirstName = leadTech.split(/\s+/)[0] ?? "";

  return (
    <CustomerFeedbackForm
      job={job}
      dispatchId={dispatch.dispatchId}
      techFirstName={techFirstName}
      googleReviewUrl={googleReviewUrl}
    />
  );
}
