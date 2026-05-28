"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// "Finalize now" button on the admin dashboard's In-progress section.
// Server-side, just stamps submittedAt + writes pay attribution via
// the same submitDispatch path the tech-side auto-trigger uses.

export function AdminFinalizeButton({
  dispatchId,
  customerName,
}: {
  dispatchId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const finalize = async () => {
    if (state === "busy") return;
    const ok =
      typeof window === "undefined"
        ? true
        : window.confirm(
            `Finalize ${customerName}? Closes the dispatch, writes pay attribution, and the tech can't add more units to it after this.`
          );
    if (!ok) return;
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/admin/finalize-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }
      setState("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finalize");
      setState("error");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={finalize}
        disabled={state === "busy" || state === "done"}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold",
          "transition-[background-color,transform] active:scale-[0.97]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red focus-visible:ring-offset-1",
          state === "done"
            ? "bg-mse-gold/20 text-mse-navy cursor-default"
            : state === "busy"
            ? "bg-mse-navy/60 text-white cursor-wait"
            : "bg-mse-navy hover:bg-mse-navy-soft text-white shadow-card"
        )}
      >
        {state === "busy" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5" />
        )}
        {state === "done"
          ? "Finalized"
          : state === "busy"
          ? "Finalizing…"
          : "Finalize now"}
      </button>
      {error && (
        <span className="text-[11px] text-mse-red truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
