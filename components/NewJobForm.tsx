"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { CrewPicker } from "@/components/CrewPicker";
import { enqueueDraftJob } from "@/lib/upload-queue";
import { kickWorker } from "@/lib/upload-worker";
import { captureLocationEvent } from "@/lib/location";
import { cn } from "@/lib/utils";
import type { UtilityTerritory } from "@/lib/types";

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
  const [selfSold, setSelfSold] = useState(false);
  // Default to the logged-in tech (most common case). User can change
  // via the picker if a different tech sold the job.
  const [soldBy, setSoldBy] = useState<string | null>(currentUserName || null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sellerOk = !selfSold || (selfSold && soldBy);
  const canSubmit =
    customerName.trim().length > 0 &&
    territory !== null &&
    sellerOk &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    // ── Phase 1: try online, distinguish network from HTTP error
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
            selfSold,
            soldBy: selfSold ? soldBy : "",
          }),
        });
      } catch {
        networkErrored = true;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // ── Phase 2: pick path
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
          selfSold,
          soldBy: selfSold ? soldBy ?? "" : "",
          createdAt: Date.now(),
        });
        kickWorker();
        // Full-page nav so SW handles the offline shell, and the
        // local- prefix routes through the offline-aware page logic.
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
    <div className="space-y-6">
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
        <Field label="Customer name">
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

        <div className="rounded-2xl bg-mse-light/60 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-mse-navy">
                Self-sold job
              </div>
              <div className="text-xs text-mse-muted">
                Did a tech sign this customer up?
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelfSold((v) => {
                  const next = !v;
                  if (next && !soldBy && currentUserName) {
                    setSoldBy(currentUserName);
                  }
                  if (!next) setSoldBy(null);
                  return next;
                });
              }}
              role="switch"
              aria-checked={selfSold}
              className={cn(
                "relative w-14 h-8 rounded-full transition-colors shrink-0",
                selfSold ? "bg-mse-gold" : "bg-mse-light"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-card transition-transform",
                  selfSold ? "translate-x-6" : ""
                )}
              />
            </button>
          </div>

          {selfSold && (
            <div className="animate-fade-in pt-1">
              <div className="text-xs font-semibold text-mse-navy mb-2">
                Sold by <span className="text-mse-red">*</span>
              </div>
              {activeTechs.length === 0 ? (
                <div className="text-sm text-mse-muted">
                  No active techs in the system.
                </div>
              ) : (
                <CrewPicker
                  options={activeTechs}
                  value={soldBy}
                  onChange={setSoldBy}
                />
              )}
              <div className="text-xs text-mse-muted mt-2">
                Sales bonus stacks per unit on this job.
              </div>
            </div>
          )}
        </div>

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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-mse-navy mb-2">
        {label}
      </span>
      {children}
    </label>
  );
}
