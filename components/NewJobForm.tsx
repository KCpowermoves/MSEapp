"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { CrewPicker } from "@/components/CrewPicker";
import { enqueueDraftJob } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { captureLocationEvent } from "@/lib/location";
import { cn } from "@/lib/utils";
import type { CrewSplit, UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export function NewJobForm({
  activeTechs,
  currentUserName,
}: {
  activeTechs: string[];
  currentUserName: string;
}) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [territory, setTerritory] = useState<UtilityTerritory | null>(null);
  // Crew on site is captured at job creation now (was on the submit
  // page). Defaults to just the logged-in tech — the most common case.
  const [crew, setCrew] = useState<string[]>(
    currentUserName ? [currentUserName] : []
  );
  const [crewSplit, setCrewSplit] = useState<CrewSplit>("Solo");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive split from crew size. The pay-split picker is hidden
  // from the UI for now (Kevin's call 2026-05-05) so this also serves
  // as the only way the split gets set on the dispatch row.
  useEffect(() => {
    if (crew.length === 1) setCrewSplit("Solo");
    else if (crew.length === 2) setCrewSplit("50-50");
    else if (crew.length >= 3) setCrewSplit("33-33-33");
  }, [crew.length]);

  const canSubmit =
    customerName.trim().length > 0 &&
    territory !== null &&
    crew.length > 0 &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    let httpResponse: Response | null = null;
    let networkErrored = false;

    const explicitlyOffline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    if (explicitlyOffline) {
      networkErrored = true;
    } else {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 8000);
      try {
        httpResponse = await fetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: customerName.trim(),
            siteAddress: "",
            utilityTerritory: territory,
            techsOnSite: crew,
            crewSplit,
          }),
        });
      } catch {
        networkErrored = true;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (networkErrored) {
      try {
        const draftId = `local-job-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        await enqueueDraftJob({
          id: draftId,
          customerName: customerName.trim(),
          siteAddress: "",
          utilityTerritory: territory!,
          // Self-sold concept removed 2026-05-05 — always false for
          // new jobs. Field kept on the queue type for historical
          // drafts that might still be sitting in IndexedDB.
          selfSold: false,
          soldBy: "",
          createdAt: Date.now(),
        });
        kickWorker();
        window.location.assign(`/jobs/${encodeURIComponent(draftId)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save offline");
        setSubmitting(false);
      }
      return;
    }

    if (!httpResponse!.ok) {
      try {
        const data = await httpResponse!.json();
        setError(data.error ?? "Could not create job");
      } catch {
        setError("Could not create job");
      }
      setSubmitting(false);
      return;
    }

    try {
      const job = await httpResponse!.json();
      captureLocationEvent("job-create", { jobId: job.jobId }, { force: true })
        .catch(() => {});
      router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create job");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-2">
        <Link
          href="/jobs"
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold text-mse-navy">New job</h1>
      </div>

      <div className="space-y-5">
        <Field
          label="Business name"
          hint="The business or property — not the contact person."
        >
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Towson Office Plaza"
            autoFocus
            autoCapitalize="words"
            className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
          />
        </Field>

        <Field label="Utility territory">
          <div className="grid grid-cols-2 gap-2">
            {TERRITORIES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTerritory(t)}
                className={cn(
                  "h-12 rounded-xl font-bold text-sm transition-[background-color,transform,border-color]",
                  "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
                  territory === t
                    ? "bg-mse-navy text-white border-2 border-mse-navy"
                    : "bg-white text-mse-navy border-2 border-mse-light hover:border-mse-navy/40"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Crew on site"
          hint="Pick everyone who's working this job today."
        >
          {activeTechs.length === 0 ? (
            <div className="text-sm text-mse-muted">
              No active techs in the system.
            </div>
          ) : (
            <CrewPicker
              multi
              options={activeTechs}
              value={crew}
              onChange={setCrew}
            />
          )}
        </Field>

        {/* Pay split picker hidden 2026-05-05 per Kevin — split is
            now auto-derived from crew size for the dispatch row but
            not surfaced to the tech. The auto-select effect above
            keeps the value sane. Keep the logic in place so we can
            unhide later if pay UI comes back. */}

        {error && (
          <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
            {error}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className={cn(
          "w-full font-bold rounded-2xl py-4 text-center transition-[background-color,transform]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-2",
          canSubmit
            ? "bg-mse-red hover:bg-mse-red-hover active:scale-[0.98] text-white shadow-card"
            : "bg-mse-light text-mse-muted cursor-not-allowed"
        )}
      >
        {submitting ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Creating...
          </span>
        ) : (
          "Create job"
        )}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-mse-navy mb-1">
        {label}
      </span>
      {hint && (
        <span className="block text-xs text-mse-muted mb-2">{hint}</span>
      )}
      {children}
    </label>
  );
}
