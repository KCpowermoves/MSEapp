// Utility → agreement-packet picker model for the sales side.
// Client-safe. The packet contents themselves (docs, coordinates)
// live in lib/agreements/registry.mjs.

import { PACKETS } from "@/lib/agreements/registry.mjs";
import type { UtilityProgram } from "@/lib/types";

export const UTILITIES = ["BGE", "PEPCO", "Delmarva", "SMECO"] as const;
export type UtilityName = (typeof UTILITIES)[number];

/** Which agreement packets a utility offers. SMECO has two sizes;
 *  everyone else is one tap. */
export function packetsForUtility(u: UtilityName): UtilityProgram[] {
  switch (u) {
    case "BGE": return ["BGE"];
    case "PEPCO": return ["PEPCO"];
    case "Delmarva": return ["DELMARVA"];
    case "SMECO": return ["SMECO-LARGE", "SMECO-SMALL"];
  }
}

export function utilityForPacket(p: UtilityProgram): UtilityName {
  if (p === "PEPCO") return "PEPCO";
  if (p === "DELMARVA") return "Delmarva";
  if (p.startsWith("SMECO")) return "SMECO";
  return "BGE";
}

/** Short labels for the packet picker buttons. */
export const UTILITY_PROGRAM_LABELS: Record<UtilityProgram, string> = {
  "BGE": "HVAC/Building Tune-up",
  "PEPCO": "HVAC/Building Tune-up",
  "DELMARVA": "HVAC/Building Tune-up",
  "SMECO-LARGE": "Building/Enhanced Tune-up (Large)",
  "SMECO-SMALL": "Small Business Tune-up",
};

/** Full display label, e.g. "BGE — HVAC/Building Tune-up". */
export function packetLabel(p: UtilityProgram): string {
  return (
    (PACKETS as Record<string, { label: string }>)[p]?.label ??
    `${utilityForPacket(p)} — ${UTILITY_PROGRAM_LABELS[p] ?? p}`
  );
}

/** The Job utilityTerritory a packet maps to when the lead converts. */
export function territoryForProgram(
  p: UtilityProgram
): "BGE" | "PEPCO" | "Delmarva" | "SMECO" {
  return utilityForPacket(p);
}
