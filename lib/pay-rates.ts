import type {
  CrewSplit,
  ServiceType,
  UnitType,
  UtilityTerritory,
} from "@/lib/types";

export const INSTALL_PAY: Record<UnitType, number> = {
  PTAC: 10,
  Standard: 50,
  Medium: 75,
  Large: 100,
};

export const SALES_BONUS: Record<UnitType, number> = {
  PTAC: 5,
  Standard: 30,
  Medium: 50,
  Large: 75,
};

export const SERVICE_PAY: Record<ServiceType, number> = {
  "Thermostat (regular)": 25,
  "Thermostat (scheduled)": 30,
  "Endo Cube": 20,
  "Standalone Small Job": 100,
};

export const DAILY_DRIVING_STIPEND = 10;
export const TRAVEL_DISPATCH_BONUS = 40;

export const TRAVEL_TERRITORIES: UtilityTerritory[] = ["Delmarva", "SMECO"];

export function crewSize(split: CrewSplit): number {
  if (split === "Solo") return 1;
  if (split === "50-50") return 2;
  return 3;
}

export function isTravelTerritory(territory: UtilityTerritory): boolean {
  return TRAVEL_TERRITORIES.includes(territory);
}
