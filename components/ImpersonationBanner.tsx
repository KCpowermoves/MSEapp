"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  impersonatedName: string;
}

export function ImpersonationBanner({ impersonatedName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate/exit", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not exit");
      }
      // Full reload so every server component re-renders with the
      // admin identity restored.
      window.location.assign("/admin/techs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "sticky top-0 z-30 w-full bg-yellow-300 border-b-2 border-yellow-400",
        "px-4 py-2 flex items-center gap-2"
      )}
    >
      <AlertTriangle className="w-4 h-4 text-mse-navy shrink-0" />
      <span className="text-xs font-bold text-mse-navy leading-tight flex-1 min-w-0 truncate">
        Viewing as <strong>{impersonatedName}</strong>
      </span>
      <button
        type="button"
        onClick={exit}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold",
          "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
          busy && "opacity-60 cursor-wait"
        )}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
        Exit
      </button>
      {error && (
        <div className="absolute top-full left-0 right-0 bg-mse-red text-white text-[11px] px-3 py-1">
          {error}
        </div>
      )}
    </div>
  );
}
