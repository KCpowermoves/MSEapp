import { notFound } from "next/navigation";
import { getDispatch } from "@/lib/data/dispatches";
import { getJob } from "@/lib/data/jobs";
import { pickReviewTemplate } from "@/lib/review-templates";
import { ReviewHelper } from "@/components/ReviewHelper";

export const dynamic = "force-dynamic";

/**
 * Public review-helper page (no auth — the customer reaches it by
 * scanning the QR code on the tech's device with their own phone).
 * Shows a pre-populated review template they can copy with one tap,
 * then continue to the actual Google review form.
 *
 * Pre-filling the Google form via URL params isn't supported by Google
 * (intentional — prevents review-stuffing). Hosting our own page lets
 * the customer copy on the same device they're posting from.
 */
export default async function ReviewHelperPage({
  params,
}: {
  params: { dispatchId: string };
}) {
  const dispatchId = decodeURIComponent(params.dispatchId);
  const dispatch = await getDispatch(dispatchId);
  if (!dispatch) notFound();
  const job = await getJob(dispatch.jobId);
  if (!job) notFound();

  const techFirstName =
    (dispatch.techsOnSite[0] ?? "").split(/\s+/)[0] ?? "";
  const reviewText = pickReviewTemplate({
    customerName: job.customerName,
    techFirstName,
    serviceLabel: "HVAC tune-up",
    seed: dispatchId,
  });

  const googleReviewUrl =
    process.env.NEXT_PUBLIC_GOOGLE_REVIEW_URL ??
    "https://g.page/r/CW6VirUCAnCXEAI/review";

  return (
    <ReviewHelper
      reviewText={reviewText}
      googleReviewUrl={googleReviewUrl}
    />
  );
}
