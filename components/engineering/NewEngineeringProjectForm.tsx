"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  EngineeringLocation,
  EngineeringUtility,
} from "@/lib/types";

const UTILITIES: EngineeringUtility[] = ["BGE", "PEPCO", "Delmarva", "SMECO"];

export function NewEngineeringProjectForm() {
  const router = useRouter();
  const [customerName, setCustomerName] = useState("");
  const [utility, setUtility] = useState<EngineeringUtility>("BGE");
  const [location, setLocation] = useState<EngineeringLocation>("BWI");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = customerName.trim().length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/engineering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          utility,
          location,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        project?: { projectId: string };
        error?: string;
      };
      if (!res.ok || !body.project) {
        throw new Error(body.error ?? "Could not create project");
      }
      router.push(
        `/admin/engineering/${encodeURIComponent(body.project.projectId)}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 max-w-xl">
      <Field label="Customer / project name" required>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="e.g. Mango Grove"
          autoFocus
          className={baseInput}
        />
      </Field>

      <Field label="Utility">
        <div className="grid grid-cols-4 gap-1.5">
          {UTILITIES.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUtility(u)}
              className={cn(
                "px-2 py-2 rounded-lg text-sm font-bold border-2",
                "active:scale-[0.97] transition-[background-color,border-color,color]",
                utility === u
                  ? "bg-mse-navy border-mse-navy text-white"
                  : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
              )}
            >
              {u}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="TMY3 weather location"
        hint="Drives the bin-method calculations. v1 ships BWI only; Andrews coming soon."
      >
        <div className="grid grid-cols-2 gap-1.5">
          {(["BWI", "Andrews"] as EngineeringLocation[]).map((loc) => {
            const disabled = loc === "Andrews";
            return (
              <button
                key={loc}
                type="button"
                onClick={() => !disabled && setLocation(loc)}
                disabled={disabled}
                className={cn(
                  "px-2 py-2 rounded-lg text-sm font-bold border-2",
                  disabled
                    ? "bg-mse-light text-mse-muted/50 border-mse-light cursor-not-allowed"
                    : location === loc
                    ? "bg-mse-navy border-mse-navy text-white"
                    : "bg-white border-mse-light text-mse-muted hover:text-mse-navy hover:border-mse-navy/30"
                )}
              >
                {loc}
                {disabled && (
                  <span className="block text-[9px] font-normal mt-0.5">
                    coming soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Field>

      {error && (
        <div className="text-sm text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold",
            "transition-[background-color,transform] active:scale-95",
            canSubmit
              ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
              : "bg-mse-light text-mse-muted cursor-not-allowed"
          )}
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? "Creating…" : "Create project"}
        </button>
      </div>
    </form>
  );
}

const baseInput =
  "w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
        {label}
        {required && <span className="text-mse-red ml-1">*</span>}
      </div>
      {children}
      {hint && (
        <div className="text-[11px] text-mse-muted mt-1">{hint}</div>
      )}
    </label>
  );
}
