"use client";

import { cn } from "@/lib/utils";
import type { UnitType } from "@/lib/types";

type TypeDef = { id: UnitType; label: string; sub: string };

// Top row: the two single-unit shapes side by side
const TOP: TypeDef[] = [
  {
    id: "PTAC / Ductless",
    label: "PTAC / Ductless",
    sub: "incl. water-source HP, VRV/VRF · 3 photos",
  },
  {
    id: "Split System",
    label: "Split System",
    sub: "3 outdoor sides + air handler · 11 photos",
  },
];

// Bottom row: the three RTU sizes
const RTU: TypeDef[] = [
  { id: "RTU-S", label: "RTU · Small", sub: "2 coils · 7 photos" },
  { id: "RTU-M", label: "RTU · Medium", sub: "2 coils · 7 photos" },
  { id: "RTU-L", label: "RTU · Large", sub: "2 coils · 7 photos" },
];

function TypeBtn({
  t,
  active,
  onChange,
}: {
  t: TypeDef;
  active: boolean;
  onChange: (id: UnitType) => void;
}) {
  return (
    <button
      type="button"
      data-unit-type={t.id}
      onClick={() => onChange(t.id)}
      className={cn(
        "rounded-2xl p-3 text-left transition-[background-color,border-color,transform]",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
        active
          ? "border-2 border-mse-navy bg-mse-navy text-white shadow-elevated"
          : "border-2 border-mse-light bg-white text-mse-navy hover:border-mse-navy/40"
      )}
    >
      <div className="font-bold text-sm">{t.label}</div>
      <div
        className={cn(
          "text-[11px] mt-1 leading-snug",
          active ? "text-white/70" : "text-mse-muted"
        )}
      >
        {t.sub}
      </div>
    </button>
  );
}

export function UnitTypePicker({
  value,
  onChange,
}: {
  value: UnitType | null;
  onChange: (next: UnitType) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {TOP.map((t) => (
          <TypeBtn key={t.id} t={t} active={value === t.id} onChange={onChange} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {RTU.map((t) => (
          <TypeBtn key={t.id} t={t} active={value === t.id} onChange={onChange} />
        ))}
      </div>
    </div>
  );
}
