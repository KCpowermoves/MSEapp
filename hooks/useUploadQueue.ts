"use client";

import { useEffect, useState } from "react";
import {
  listPending,
  pendingCount,
  type QueuedPhoto,
} from "@/lib/upload-queue";

const POLL_MS = 3000;

export function usePendingCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const n = await pendingCount();
        if (!cancelled) setCount(n);
      } catch {}
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return count;
}

export function usePendingList() {
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await listPending();
        if (!cancelled) setItems(list);
      } catch {}
    };
    tick();
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  return items;
}
