// Utility program definitions for the sales side — client-safe.
//
// One key per agreement variant. The two-step picker (electric utility
// → valid program combos) replaces the old 12-option dropdown that
// made wrong-agreement mistakes easy.

import type { UtilityProgram } from "@/lib/types";

export const UTILITY_PROGRAM_LABELS: Record<UtilityProgram, string> = {
  "BGE": "BGE (electric only)",
  "PEPCO": "PEPCO (electric only)",
  "Delmarva": "Delmarva (electric only)",
  "SMECO": "SMECO (electric only)",
  "Washington-Gas-MD": "Washington Gas — Maryland (gas only)",
  "Washington-Gas-VA": "Washington Gas — Virginia (gas only)",
  "BGE-Washington-Gas": "BGE + Washington Gas",
  "PEPCO-Washington-Gas": "PEPCO + Washington Gas",
  "BGE-BTU": "BGE + BTU program",
  "PEPCO-BTU": "PEPCO + BTU program",
  "Delmarva-BTU": "Delmarva + BTU program",
  "SMECO-BTU": "SMECO + BTU program",
};

export const ELECTRIC_OPTIONS = [
  "BGE",
  "PEPCO",
  "Delmarva",
  "SMECO",
  "None (gas only)",
] as const;

export function programsForElectric(
  electric: (typeof ELECTRIC_OPTIONS)[number]
): UtilityProgram[] {
  switch (electric) {
    case "BGE": return ["BGE", "BGE-Washington-Gas", "BGE-BTU"];
    case "PEPCO": return ["PEPCO", "PEPCO-Washington-Gas", "PEPCO-BTU"];
    case "Delmarva": return ["Delmarva", "Delmarva-BTU"];
    case "SMECO": return ["SMECO", "SMECO-BTU"];
    case "None (gas only)":
      return ["Washington-Gas-MD", "Washington-Gas-VA"];
  }
}

/** The Job utilityTerritory a program maps to when the lead converts.
 *  Gas-only programs default to BGE territory (no gas territory exists
 *  in the Jobs model — admins can correct on the job if needed). */
export function territoryForProgram(
  p: UtilityProgram
): "BGE" | "PEPCO" | "Delmarva" | "SMECO" {
  if (p.startsWith("PEPCO")) return "PEPCO";
  if (p.startsWith("Delmarva")) return "Delmarva";
  if (p.startsWith("SMECO")) return "SMECO";
  return "BGE";
}
