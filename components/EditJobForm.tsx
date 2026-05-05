"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Job, UtilityTerritory } from "@/lib/types";

const TERRITORIES: UtilityTerritory[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export function EditJobForm({ job }: { job: Job }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(job.customerName);
  const [siteAddress, setSiteAddress] = useState(job.siteAddress);
  const [territory, setTerritory] = useState<UtilityTerritory>(job.utilityTerritory);
  const [status, setStatus] = useState<"Active" | "Closed">(job.status);
  const [notes, setNotes] = useState(job.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = customerName.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          customerName: customerName.trim(),
          siteAddress: siteAddress.trim(),
          utilityTerritory: territory,
          status,
          notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save");
      }
      router.replace(`/jobs/${encodeURIComponent(job.jobId)}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-2">
        <a
          href={`/jobs/${encodeURIComponent(job.jobId)}`}
          className="p-2 -ml-2 text-mse-muted hover:text-mse-navy"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
        <h1 className="text-2xl font-bold text-mse-navy">Edit job</h1>
      </div>

      <Field
        label="Business name"
        hint="The business or property — not the contact person."
        required
      >
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          autoCapitalize="words"
          className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
        />
      </Field>

      <Field label="Site address">
        <input
          type="text"
          value={siteAddress}
          onChange={(e) => setSiteAddress(e.target.value)}
          placeholder="optional"
          autoCapitalize="words"
          className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy"
        />
      </Field>

      <Field label="Utility territory" required>
        <div className="grid grid-cols-2 gap-2">
          {TERRITORIES.map((t) => {
            const active = territory === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTerritory(t)}
                className={cn(
                  "rounded-2xl p-3 text-left transition-[background-color,border-color,transform]",
                  "active:scale-[0.97]",
                  active
                    ? "border-2 border-mse-navy bg-mse-navy text-white"
                    : "border-2 border-mse-light bg-white text-mse-navy hover:border-mse-navy/40"
                )}
              >
                <div className="font-bold text-sm">{t}</div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Status" required>
        <div className="grid grid-cols-2 gap-2">
          {(["Active", "Closed"] as const).map((s) => {
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-2xl p-3 transition-[background-color,border-color,transform]",
                  "active:scale-[0.97]",
                  active
                    ? "border-2 border-mse-navy bg-mse-navy text-white"
                    : "border-2 border-mse-light bg-white text-mse-navy hover:border-mse-navy/40"
                )}
              >
                <div className="font-bold text-sm">{s}</div>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full px-4 py-3 rounded-xl border border-mse-light bg-white text-base focus:outline-none focus:border-mse-navy resize-none"
        />
      </Field>

      {error && (
        <div className="text-mse-red text-sm bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-mse-light p-4 safe-bottom z-10">
        <div className="max-w-2xl mx-auto">
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
                Saving...
              </span>
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div>
      <div className="text-sm font-semibold text-mse-navy mb-1">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {hint && <div className="text-xs text-mse-muted mb-2">{hint}</div>}
      {children}
    </div>
  );
}
