"use client";

import { cn } from "@/lib/utils";
import type { UnitType } from "@/lib/types";

type TypeDef = { id: UnitType; label: string; sub: string };

const SIMPLE: TypeDef[] = [
  {
    id: "PTAC / Ductless",
    label: "PTAC / Ductless",
    sub: "incl. water-source HP, VRV/VRF · 3 photos",
  },
];

const COMPLEX: TypeDef[] = [
  { id: "Split System", label: "Split System", sub: "3 outdoor sides + air handler · 11 photos" },
];

const RTU: TypeDef[] = [
  { id: "RTU-S", label: "RTU · Small", sub: "2 coils · 7 photos" },
  { id: "RTU-M", label: "RTU · Medium", sub: "2 coils · 7 photos" },
  { id: "RTU-L", label: "RTU · Large", sub: "2 coils · 7 photos" },
];

function TypeBtn({
  t,
  active,
  onChange,
  fullWidth = false,
}: {
  t: TypeDef;
  active: boolean;
  onChange: (id: UnitType) => void;
  fullWidth?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(t.id)}
      className={cn(
        "rounded-2xl p-4 text-left transition-[background-color,border-color,transform]",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mse-red",
        fullWidth && "col-span-2",
        active
          ? "border-2 border-mse-navy bg-mse-navy text-white shadow-elevated"
          : "border-2 border-mse-light bg-white text-mse-navy hover:border-mse-navy/40"
      )}
    >
      <div className="font-bold">{t.label}</div>
      <div className={cn("text-xs mt-1", active ? "text-white/70" : "text-mse-muted")}>
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2">
        {SIMPLE.map((t) => (
          <TypeBtn key={t.id} t={t} active={value === t.id} onChange={onChange} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {COMPLEX.map((t) => (
          <TypeBtn key={t.id} t={t} active={value === t.id} onChange={onChange} fullWidth />
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
