"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export function NewJobForm() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [territory, setTerritory] = useState<UtilityTerritory | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    customerName.trim().length > 0 &&
    siteAddress.trim().length > 0 &&
    territory !== null &&
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
