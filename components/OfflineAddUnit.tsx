"use client";

import { useEffect, useState } from "react";
import {
  getDraftJob,
  listDraftsForJob,
  type DraftJob,
} from "@/lib/upload-queue";
import { AddUnitForm } from "@/components/AddUnitForm";
import type { Job } from "@/lib/types";

/**
 * Client wrapper that reads a local-job- draft from IndexedDB and
 * renders <AddUnitForm> against it. The tech can add units to an
 * offline-only job exactly the same way as a real job — units enqueue
 * with the local jobId, the worker rewrites that jobId once the parent
 * job syncs.
 */
export function OfflineAddUnit({ jobId }: { jobId: string }) {
  const [draft, setDraft] = useState<DraftJob | null>(null);
  const [nextNumber, setNextNumber] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getDraftJob(jobId), listDraftsForJob(jobId)])
      .then(([j, units]) => {
        if (cancelled) return;
        setDraft(j);
        setNextNumber(units.length + 1);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!loaded) return null;

  if (!draft) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-mse-light p-8 text-center space-y-2">
        <p className="text-mse-muted">
          This offline draft job isn&apos;t on this device.
        </p>
        <a
          href="/jobs"
          className="inline-block text-sm text-mse-navy font-semibold underline"
        >
          Back to jobs
        </a>
      </div>
    );
  }

  // Reconstruct a job-like shape so AddUnitForm can use the same UI.
  // Fields like jobId/customerName/territory/selfSold/soldBy are all
  // it actually reads.
  const fakeJob: Job = {
    jobId: draft.id,
    createdDate: new Date(draft.createdAt).toISOString(),
    lastActivityDate: new Date(draft.createdAt).toISOString(),
    customerName: draft.customerName,
    siteAddress: draft.siteAddress,
    utilityTerritory: draft.utilityTerritory,
    status: "Active",
    selfSold: draft.selfSold,
    soldBy: draft.soldBy,
    driveFolderUrl: "",
    driveFolderId: "",
    createdBy: "",
    notes: "",
  };

  return <AddUnitForm job={fakeJob} nextUnitNumber={nextNumber} />;
}
