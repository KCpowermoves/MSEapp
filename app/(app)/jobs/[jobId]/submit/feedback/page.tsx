import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { findDispatchByDate } from "@/lib/data/dispatches";
import { todayIsoDate } from "@/lib/utils";
import { CustomerFeedbackForm } from "@/components/CustomerFeedbackForm";

export const dynamic = "force-dynamic";

// Customer review/feedback step hidden for v1 (Kevin's call
// 2026-05-05). Form + page kept intact and isolated — flip this to
// false and restore the CustomerConfirmForm -> /submit/feedback
// navigation to bring it back.
const CUSTOMER_FEEDBACK_HIDDEN = true;

export default async function CustomerFeedbackPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (CUSTOMER_FEEDBACK_HIDDEN) {
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

  const dispatch = await findDispatchByDate(jobId, todayIsoDate());
  if (!dispatch || !dispatch.submittedAt) {
    redirect(`/jobs/${encodeURIComponent(jobId)}/submit`);
  }

  // The QR code on the 5★ stage now points at our public review-helper
  // page (/review/[dispatchId]) — that page handles the suggested
  // review text + Google redirect on the customer's own device.
  return <CustomerFeedbackForm job={job} dispatchId={dispatch.dispatchId} />;
}
