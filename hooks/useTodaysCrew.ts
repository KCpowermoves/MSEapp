"use client";

import { useEffect, useState } from "react";
import { todayIsoDate } from "@/lib/utils";

const PREFIX = "mse-field:crew:";

function key(jobId: string) {
  return `${PREFIX}${jobId}:${todayIsoDate()}`;
}

export function useTodaysCrew(jobId: string) {
  const [crew, setCrewState] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key(jobId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCrewState(parsed.filter((x) => typeof x === "string"));
      }
    } catch {}
    setHydrated(true);
  }, [jobId]);

  const setCrew = (next: string[]) => {
    setCrewState(next);
    try {
      window.localStorage.setItem(key(jobId), JSON.stringify(next));
    } catch {}
  };

  return { crew, setCrew, hydrated };
}
