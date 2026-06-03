import { redirect } from "next/navigation";
import { OfflineAddUnit } from "@/components/OfflineAddUnit";

export const dynamic = "force-dynamic";

export default async function AddUnitPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    // Offline-only jobs keep the legacy single-unit flow until they
    // sync to a real jobId.
    return <OfflineAddUnit jobId={jobId} />;
  }
  // Server-known jobs go to the new multi-card view (2026-06-03).
  redirect(`/jobs/${encodeURIComponent(jobId)}/service`);
}
