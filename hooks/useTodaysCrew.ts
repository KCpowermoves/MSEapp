"use client";

import { useEffect, useState } from "react";
import { todayIsoDate } from "@/lib/utils";

const PREFIX = "mse-field:crew:";

function key(jobId: string) {
  return `${PREFIX}${jobId}:${todayIsoDate()}`;
}

// `defaultMember` (typically the logged-in tech) gets auto-added on
// first load when localStorage is empty for this (job, date) pair.
// User can deselect or add others.
export function useTodaysCrew(jobId: string, defaultMember?: string) {
  const [crew, setCrewState] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key(jobId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCrewState(parsed.filter((x) => typeof x === "string"));
          setHydrated(true);
          return;
        }
      }
      // No stored crew yet — seed with the default member if provided
      if (defaultMember) {
        setCrewState([defaultMember]);
        window.localStorage.setItem(
          key(jobId),
          JSON.stringify([defaultMember])
        );
      }
    } catch {}
    setHydrated(true);
  }, [jobId, defaultMember]);

  const setCrew = (next: string[]) => {
    setCrewState(next);
    try {
      window.localStorage.setItem(key(jobId), JSON.stringify(next));
    } catch {}
  };

  return { crew, setCrew, hydrated };
}
