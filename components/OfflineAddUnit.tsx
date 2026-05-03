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
 * Client wrapper that lets the tech add units to a job while offline,
 * even if the SW hasn't cached `/jobs/[jobId]/units/new` for that
 * specific jobId yet (the most common case is: job was created online,
 * tech walked into a basement, taps Add Unit for the first time).
 *
 * Two paths:
 * 1. Local-only draft job (jobId starts with "local-job-") — read the
 *    draft from IndexedDB and pass its real customer/territory data.
 * 2. Real server-known jobId — we don't have the full Job record
 *    offline, but AddUnitForm only really needs the jobId for
 *    submission. We construct a minimal Job shape so the form renders.
 */
export function OfflineAddUnit({ jobId }: { jobId: string }) {
  const [draft, setDraft] = useState<DraftJob | null>(null);
  const [nextNumber, setNextNumber] = useState(1);
  const [loaded, setLoaded] = useState(false);

  const isLocalDraftJob = jobId.startsWith("local-job-");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const units = await listDraftsForJob(jobId);
        if (cancelled) return;
        setNextNumber(units.length + 1);
        if (isLocalDraftJob) {
          const j = await getDraftJob(jobId);
          if (cancelled) return;
          setDraft(j);
        }
      } catch {
        // best-effort
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [jobId, isLocalDraftJob]);

  if (!loaded) return null;

  // ── Path 1: local-only draft job
  if (isLocalDraftJob) {
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

  // ── Path 2: real server-known jobId, but the page wasn't cached.
  // Build a minimal Job. Customer name and self-sold info are unknown
  // offline — the form just needs jobId to submit.
  const minimalJob: Job = {
    jobId,
    createdDate: new Date().toISOString(),
    lastActivityDate: new Date().toISOString(),
    customerName: "",
    siteAddress: "",
    utilityTerritory: "BGE",
    status: "Active",
    selfSold: false,
    soldBy: "",
    driveFolderUrl: "",
    driveFolderId: "",
    createdBy: "",
    notes: "",
  };
  return <AddUnitForm job={minimalJob} nextUnitNumber={nextNumber} />;
}
