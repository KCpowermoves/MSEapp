"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  currentName: string;
  jobCount: number;
}

export function RenameCustomerButton({ currentName, jobCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = newName.trim();
  const canSubmit =
    trimmed.length > 0 &&
    trimmed.toLowerCase() !== currentName.trim().toLowerCase() &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/customers/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName: currentName, toName: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        newSlug?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      // Navigate to the new URL slug so refresh / share lands on the
      // current name. Bypass the cache so the rolled-up rollup picks
      // up the new label.
      router.replace(
        body.newSlug
          ? `/admin/customers/${body.newSlug}`
          : "/admin/customers"
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename");
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setNewName(currentName);
        }}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/15 text-white"
        title="Rename customer"
      >
        <Pencil className="w-3.5 h-3.5" />
        Rename
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="relative bg-white rounded-2xl shadow-elevated w-full max-w-md">
            <div className="px-5 py-3 border-b border-mse-light flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-mse-navy">
                  Rename customer
                </h2>
                <div className="text-xs text-mse-muted mt-0.5">
                  Updates every Jobs row currently matching{" "}
                  <strong>{currentName}</strong> ({jobCount} job
                  {jobCount === 1 ? "" : "s"}).
                </div>
              </div>
              <button
                type="button"
                onClick={() => !submitting && setOpen(false)}
                className="p-1.5 rounded-md text-mse-muted hover:text-mse-navy hover:bg-mse-light"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={submit} className="p-5 space-y-4">
              <label className="block">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-1">
                  New name
                </div>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-mse-light bg-white text-sm focus:outline-none focus:border-mse-navy"
                />
                <div className="text-[11px] text-mse-muted mt-1">
                  Same name with different capitalization will{" "}
                  <em>not</em> rename — type something different.
                </div>
              </label>

              {error && (
                <div className="text-xs text-mse-red bg-mse-red/5 border border-mse-red/20 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="px-3 py-2 rounded-xl text-sm font-bold text-mse-muted hover:text-mse-navy disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold",
                    "transition-[background-color,transform] active:scale-95",
                    canSubmit
                      ? "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
                      : "bg-mse-light text-mse-muted cursor-not-allowed"
                  )}
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Rename {jobCount} job{jobCount === 1 ? "" : "s"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
