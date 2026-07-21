// Utility → agreement-packet picker model for the sales side.
// Client-safe. The packet contents themselves (docs, coordinates)
// live in lib/agreements/registry.mjs.

import { PACKETS } from "@/lib/agreements/registry.mjs";
import type { UtilityProgram } from "@/lib/types";

export const UTILITIES = ["BGE", "PEPCO", "Delmarva", "SMECO"] as const;
export type UtilityName = (typeof UTILITIES)[number];

/** Customer/contact fields that must be filled before an agreement can
 *  be signed. Everything here is required; account number, Choice ID,
 *  Service ID, and notes stay optional (per Kevin 2026-07-20). */
export const REQUIRED_LEAD_FIELDS = [
  "businessName",
  "contactName",
  "title",
  "phone",
  "email",
  "address",
  "city",
  "zip",
  "hvacUnits",
] as const;

/** Which agreement packets a utility offers. SMECO has two sizes;
 *  everyone else is one tap. */
export function packetsForUtility(u: UtilityName): UtilityProgram[] {
  switch (u) {
    case "BGE": return ["BGE"];
    case "PEPCO": return ["PEPCO"];
    case "Delmarva": return ["DELMARVA"];
    // Small Business first — it's the default and most common; Large below.
    case "SMECO": return ["SMECO-SMALL", "SMECO-LARGE"];
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
  "SMECO-SMALL": "HVAC and Building Tune-Up (small)",
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
