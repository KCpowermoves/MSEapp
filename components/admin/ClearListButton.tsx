"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

// Clears one prospect batch from the reps' picker (marks its remaining
// New rows Used; they stay in the sheet for the record).

export function ClearListButton({
  listName,
  count,
}: {
  listName: string;
  count: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const clear = async () => {
    if (
      !window.confirm(
        `Clear "${listName || "Unsorted"}" (${count} prospect${count === 1 ? "" : "s"}) from the reps' picker?`
      )
    )
      return;
    setBusy(true);
    try {
      await fetch(
        `/api/admin/prospects?list=${encodeURIComponent(listName)}`,
        { method: "DELETE" }
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-mse-muted hover:text-mse-red shrink-0"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      Clear
    </button>
  );
}
