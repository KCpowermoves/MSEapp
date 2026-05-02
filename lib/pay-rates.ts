import type {
  CrewSplit,
  ServiceType,
  UnitType,
  UtilityTerritory,
} from "@/lib/types";

export const INSTALL_PAY: Record<UnitType, number> = {
  "PTAC / Ductless": 10,
  "Split System": 50,
  "RTU-S": 50,
  "RTU-M": 75,
  "RTU-L": 100,
};

export const SALES_BONUS: Record<UnitType, number> = {
  "PTAC / Ductless": 5,
  "Split System": 30,
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
