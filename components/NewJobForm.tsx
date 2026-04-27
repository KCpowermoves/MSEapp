"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { CrewPicker } from "@/components/CrewPicker";
import { cn } from "@/lib/utils";
import type { UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export function NewJobForm({ activeTechs }: { activeTechs: string[] }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [territory, setTerritory] = useState<UtilityTerritory | null>(null);
  const [selfSold, setSelfSold] = useState(false);
  const [soldBy, setSoldBy] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sellerOk = !selfSold || (selfSold && soldBy);
  const canSubmit =
    customerName.trim().length > 0 &&
    siteAddress.trim().length > 0 &&
    territory !== null &&
    sellerOk &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          siteAddress: siteAddress.trim(),
          utilityTerritory: territory,
          selfSold,
          soldBy: selfSold ? soldBy : "",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not create job");
      }
      const job = await res.json();
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

        <Field label="Site address">
          <textarea
            value={siteAddress}
            onChange={(e) => setSiteAddress(e.target.value)}
            placeholder="e.g. 1234 York Rd, Towson MD 21204"
            rows={2}
            className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy resize-none"
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
                setSelfSold((v) => !v);
                if (selfSold) setSoldBy(null);
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
