import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { ensureAudit } from "@/lib/data/audits";
import { listAuditItemsForAudit } from "@/lib/data/audit-items";
import { AuditForm } from "@/components/AuditForm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function AuditPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);
  if (jobId.startsWith("local-job-")) {
    // Audit creation requires a server-known jobId so the AuditID can
    // be reserved. Offline-only jobs need to sync first.
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

  // Idempotent — creates the audit on first visit, returns existing
  // row on every subsequent visit.
  const audit = await ensureAudit({
    jobId,
    createdBy: session.name ?? "",
  });
  const items = await listAuditItemsForAudit(audit.auditId);

  return (
    <AuditForm
      job={job}
      audit={audit}
      initialItems={items}
      currentUserName={session.name ?? ""}
    />
  );
}
