"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listAllDraftJobs, removeDraftJob, type DraftJob } from "@/lib/upload-queue";

const POLL_MS = 1500;

/**
 * Polls IndexedDB for offline-created job drafts. Auto-removes any
 * draft that has reached "synced" so the server-rendered job row
 * (now visible after router.refresh) takes over.
 */
export function useDraftJobs() {
  const [drafts, setDrafts] = useState<DraftJob[]>([]);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await listAllDraftJobs();
        if (cancelled) return;
        const synced = list.filter((d) => d.status === "synced");
        if (synced.length > 0) {
          setTimeout(async () => {
            for (const s of synced) await removeDraftJob(s.id);
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
    window.addEventListener("pageshow", onPageshow);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageshow);
    };
  }, [router]);

  return drafts;
}
