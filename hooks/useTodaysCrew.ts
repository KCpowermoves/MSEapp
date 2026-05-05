"use client";

import { useEffect, useState } from "react";
import { todayIsoDate } from "@/lib/utils";

const PREFIX = "mse-field:crew:";

function key(jobId: string) {
  return `${PREFIX}${jobId}:${todayIsoDate()}`;
}

// `defaultMember` (typically the logged-in tech) gets auto-added on
// first load when localStorage is empty for this (job, date) pair.
// `initialCrew`, when provided, takes priority over both localStorage
// and the default — used when the server-side dispatch already has a
// crew picked at job creation, so we render with that crew immediately
// instead of flashing the localStorage value.
export function useTodaysCrew(
  jobId: string,
  defaultMember?: string,
  initialCrew?: string[]
) {
  const [crew, setCrewState] = useState<string[]>(initialCrew ?? []);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      // Server-provided crew wins — sync localStorage to match.
      if (initialCrew && initialCrew.length > 0) {
        setCrewState(initialCrew);
        window.localStorage.setItem(key(jobId), JSON.stringify(initialCrew));
        setHydrated(true);
        return;
      }
      const raw = window.localStorage.getItem(key(jobId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCrewState(parsed.filter((x) => typeof x === "string"));
          setHydrated(true);
          return;
        }
      }
      if (defaultMember) {
        setCrewState([defaultMember]);
        window.localStorage.setItem(
          key(jobId),
          JSON.stringify([defaultMember])
        );
      }
    } catch {}
    setHydrated(true);
    // initialCrew is intentionally NOT in deps — page-load value only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, defaultMember]);

  const setCrew = (next: string[]) => {
    setCrewState(next);
    try {
      window.localStorage.setItem(key(jobId), JSON.stringify(next));
    } catch {}
  };

  return { crew, setCrew, hydrated };
}
