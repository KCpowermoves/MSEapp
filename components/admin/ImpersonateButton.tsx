"use client";

import { useState } from "react";
import { Loader2, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  targetTechId: string;
  targetName: string;
}

export function ImpersonateButton({ targetTechId, targetName }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Start viewing the app as ${targetName}? You can exit any time from the yellow banner.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTechId }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not start");
      window.location.assign("/jobs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold",
          "bg-mse-navy text-white hover:bg-mse-navy-soft active:scale-95",
          busy && "opacity-60 cursor-wait"
        )}
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
        View as
      </button>
      {error && (
        <div className="text-[10px] text-mse-red">{error}</div>
      )}
    </div>
  );
}
