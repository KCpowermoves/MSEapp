import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { findDraftDispatch, listAllDispatches } from "@/lib/data/dispatches";
import { listUnitsForJob } from "@/lib/data/units";
import { listActiveTechNames } from "@/lib/data/techs";
import { todayIsoDate } from "@/lib/utils";
import { JobDetail } from "@/components/JobDetail";
import { OfflineJobDetail } from "@/components/OfflineJobDetail";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = decodeURIComponent(params.jobId);

  // Offline draft jobs live entirely in IndexedDB. Render a thin
  // client shell that loads from IDB and self-redirects once the
  // background worker has synced the job server-side.
  if (jobId.startsWith("local-job-")) {
    return <OfflineJobDetail jobId={jobId} />;
  }

  const session = await getSession();
  const techName = session.name ?? "";
  const isAdmin = session.isAdmin === true;

  const job = await getJob(jobId);
  if (!job) notFound();

  const canAccess = await techCanAccessJob({ job, techName, isAdmin });
  if (!canAccess) notFound();

  const draft = await findDraftDispatch(jobId, todayIsoDate());
  const [allUnits, dispatches, activeTechs] = await Promise.all([
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

  // The dispatch that was submitted TODAY (if any) — used to drive a
  // clear post-submit state on the job detail screen instead of a dead
  // greyed-out button. Lets the tech see "already submitted" and finish
  // the customer sign-off if they bailed out mid-flow.
  const today = todayIsoDate();
  const submittedTodayRow =
    dispatches
      .filter((d) => d.jobId === jobId && d.dispatchDate === today && d.submittedAt)
      .sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""))[0] ??
    null;
  const submittedToday = submittedTodayRow
    ? {
        dispatchId: submittedTodayRow.dispatchId,
        hasSignature: Boolean(submittedTodayRow.signatureUrl),
        reportPdfUrl: submittedTodayRow.reportPdfUrl,
      }
    : null;

  return (
    <JobDetail
      job={job}
      todaysDispatchId={draft?.dispatchId ?? null}
      todaysUnits={unitsWithStatus}
      submittedToday={submittedToday}
      activeTechs={activeTechs}
      currentUserName={session.name ?? ""}
      isAdmin={isAdmin}
    />
  );
}
