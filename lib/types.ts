export type UtilityTerritory = "BGE" | "PEPCO" | "Delmarva" | "SMECO";

export type JobStatus = "Active" | "Closed";

export type CrewSplit = "Solo" | "50-50" | "33-33-33";

// Simple (1-side) types share the same 3-photo template.
// RTU types share the 7-photo coil template.
// Split System has 11 required photos (outdoor 3-side + indoor AH).
export type UnitType =
  | "PTAC / Ductless"
  | "Split System"
  | "RTU-S"
  | "RTU-M"
  | "RTU-L";

export type ServiceType =
  | "Thermostat (regular)"
  | "Thermostat (scheduled)"
  | "Endo Cube"
  | "Standalone Small Job";

// Column mapping (sheet cols G–X):
//   Simple:  pre→G  post→H  nameplate→M  filter→N(opt)
//   RTU:     coil1_pre→G  coil1_post→J  coil2_pre→H  coil2_post→K
//            nameplate→M  filter_pre→N  filter_post→I
//   Split:   out_pre_1→G  out_pre_2→H  out_pre_3→I
//            out_post_1→J  out_post_2→K  out_post_3→L
//            out_nameplate→M  filter→N
//            in_pre→V  in_post→W  in_nameplate→X
export type PhotoSlot =
  | "pre" | "post"
  | "coil1_pre" | "coil1_post" | "coil2_pre" | "coil2_post"
  | "filter_pre" | "filter_post"
  | "out_pre_1" | "out_pre_2" | "out_pre_3"
  | "out_post_1" | "out_post_2" | "out_post_3"
  | "out_nameplate"
  | "in_pre" | "in_post" | "in_nameplate"
  | "nameplate" | "filter"
  | "additional";

export interface Tech {
  techId: string;
  name: string;
  pinHash: string;
  active: boolean;
  phone: string;
}

export interface Job {
  jobId: string;
  createdDate: string;
  lastActivityDate: string;
  customerName: string;
  siteAddress: string;
  utilityTerritory: UtilityTerritory;
  status: JobStatus;
  selfSold: boolean;
  soldBy: string;
  driveFolderUrl: string;
  driveFolderId: string;
  createdBy: string;
  notes: string;
}

export interface Dispatch {
  dispatchId: string;
  jobId: string;
  dispatchDate: string;
  techsOnSite: string[];
  crewSplit: CrewSplit;
  driver: string;
  dailyDrivingStipend: number;
  travelDispatchBonus: number;
  photosComplete: boolean;
  submittedAt: string;
}

export interface UnitServiced {
  unitId: string;
  dispatchId: string;
  jobId: string;
  unitNumberOnJob: number;
  unitType: UnitType;
  // Positional photo URLs G–L (semantic meaning varies by unitType, see PhotoSlot comment)
  pre1Url: string;
  pre2Url: string;
  pre3Url: string;
  post1Url: string;
  post2Url: string;
  post3Url: string;
  nameplateUrl: string;
  filterUrl: string;
  additionalUrls: string;
  // Split System indoor air handler (cols V–X)
  inPreUrl: string;
  inPostUrl: string;
  inNameplateUrl: string;
  label: string;
  /** Soft-delete flag. Deleted units are kept in the sheet for audit
   *  but excluded from app reads and pay rollups. */
  deleted: boolean;
  make: string;
  model: string;
  serial: string;
  notes: string;
  loggedBy: string;
  loggedAt: string;
}

export interface AdditionalService {
  serviceId: string;
  dispatchId: string;
  jobId: string;
  serviceType: ServiceType;
  quantity: number;
  photoUrls: string;
  notes: string;
  loggedBy: string;
  loggedAt: string;
}

export interface SessionData {
  techId: string;
  name: string;
  loggedInAt: number;
}
