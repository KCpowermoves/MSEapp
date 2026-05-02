"use client";

import { cn } from "@/lib/utils";
import type { UnitType } from "@/lib/types";

const TYPES: { id: UnitType; label: string; sub: string }[] = [
  { id: "PTAC", label: "PTAC", sub: "under 3 tons / hotels" },
  { id: "Standard", label: "Standard", sub: "3 – 20 tons" },
  { id: "Medium", label: "Medium", sub: "20 – 50 tons" },
  { id: "Large", label: "Large", sub: "50+ tons" },
];

export function UnitTypePicker({
  value,
  onChange,
}: {
  value: UnitType | null;
  onChange: (next: UnitType) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {TYPES.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-2xl p-4 text-left transition-[background-color,border-color,transform]",
              "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
              active
                ? "border-2 border-mse-navy bg-mse-navy text-white shadow-elevated"
                : "border-2 border-mse-light bg-white text-mse-navy hover:border-mse-navy/40"
            )}
          >
            <div className="font-bold">{t.label}</div>
            <div
              className={cn(
                "text-xs mt-1",
                active ? "text-white/70" : "text-mse-muted"
              )}
            >
              {t.sub}
            </div>
          </button>
        );
      })}
    </div>
  );
}
