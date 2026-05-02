"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listDraftsForJob, removeDraft, type DraftUnit } from "@/lib/upload-queue";

const POLL_MS = 1500;

/**
 * Polls IndexedDB for pending/syncing draft units belonging to a job.
 * Auto-removes any draft that has reached "synced" status (the server
 * version will appear via the next router.refresh) and triggers a
 * route refresh so the JobDetail page picks up the now-real unit row.
 */
export function useDraftUnits(jobId: string) {
  const [drafts, setDrafts] = useState<DraftUnit[]>([]);
  const router = useRouter();
  const lastSyncedCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await listDraftsForJob(jobId);
        if (cancelled) return;

        // Drop synced drafts after a brief delay so the UI shows the
        // green "synced" state for a moment before the row gets replaced
        // by the server-rendered unit.
        const synced = list.filter((d) => d.status === "synced");
        if (synced.length > lastSyncedCount.current) {
          lastSyncedCount.current = synced.length;
          // Clean up after this poll, refresh the page so server data shows
          setTimeout(async () => {
            for (const s of synced) await removeDraft(s.id);
            router.refresh();
          }, 800);
        }

        setDrafts(list);
      } catch {}
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    const onFocus = () => tick();
    const onPageshow = () => tick();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    // pageshow fires on bfcache restore (back/forward navigation) which
    // visibilitychange/focus may miss on some Android Chrome versions.
    window.addEventListener("pageshow", onPageshow);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageshow);
    };
  }, [jobId, router]);

  return drafts;
}
