import type {
  CrewSplit,
  ServiceType,
  UnitType,
  UtilityTerritory,
} from "@/lib/types";

// Outdoor + Indoor split each pay roughly half of the legacy combined
// Split System rate — a tech logging both units gets the same total
// as before, but each unit also stands on its own when only one side
// is serviced.
export const INSTALL_PAY: Record<UnitType, number> = {
  "PTAC / Ductless": 10,
  "Split System": 50,
  "Outdoor Split System": 30,
  "Indoor Split System": 20,
  "RTU-S": 50,
  "RTU-M": 75,
  "RTU-L": 100,
};

export const SALES_BONUS: Record<UnitType, number> = {
  "PTAC / Ductless": 5,
  "Split System": 30,
  "Outdoor Split System": 20,
  "Indoor Split System": 10,
  "RTU-S": 30,
  "RTU-M": 50,
  "RTU-L": 75,
};

export const SERVICE_PAY: Record<ServiceType, number> = {
  "Thermostat (regular)": 25,
  "Thermostat (scheduled)": 30,
  "Endo Cube": 20,
  "Standalone Small Job": 100,
};

// Removed per company policy — kept exported as 0 so existing
// dispatch rows / attribution helpers continue to type-check.
export const DAILY_DRIVING_STIPEND = 0;
export const TRAVEL_DISPATCH_BONUS = 0;

export const TRAVEL_TERRITORIES: UtilityTerritory[] = ["Delmarva", "SMECO"];

export function crewSize(split: CrewSplit): number {
  if (split === "Solo") return 1;
  if (split === "50-50") return 2;
  return 3;
}

export function isTravelTerritory(territory: UtilityTerritory): boolean {
  return TRAVEL_TERRITORIES.includes(territory);
}

/**
 * Per-tech estimate of install pay across a list of pending units,
 * accounting for crew-split divisor (Solo = full, 50-50 = half,
 * 33-33-33 = third). Used on the "Uploading as you work" card so
 * techs see a running dollar figure before the dispatch is
 * finalized. Returns 0 if the tech isn't on the crew.
 *
 * Approximation only — doesn't include sales bonus, daily stipend,
 * travel bonus, or service-row pay. The exact figure lands on
 * Pay Attribution at finalize.
 */
export function estimatedInstallPayForTech(opts: {
  units: { unitType: UnitType }[];
  crewSplit: CrewSplit;
  techsOnSite: string[];
  techName: string;
}): number {
  if (!opts.techsOnSite.includes(opts.techName)) return 0;
  const divisor = crewSize(opts.crewSplit);
  if (divisor <= 0) return 0;
  let total = 0;
  for (const u of opts.units) {
    const base = INSTALL_PAY[u.unitType] ?? 0;
    total += base / divisor;
  }
  // Round to whole dollars — friendlier than $43.33 on a 33-33-33 split.
  return Math.round(total);
}
