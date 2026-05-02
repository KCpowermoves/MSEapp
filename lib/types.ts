export type UtilityTerritory = "BGE" | "PEPCO" | "Delmarva" | "SMECO";

export type JobStatus = "Active" | "Closed";

export type CrewSplit = "Solo" | "50-50" | "33-33-33";

export type UnitType = "PTAC" | "Standard" | "Medium" | "Large";

export type UnitSubType =
  | "Standard tune-up"
  | "Water-source heat pump"
  | "VRV-VRF"
  | "Other building tune-up";

export type ServiceType =
  | "Thermostat (regular)"
  | "Thermostat (scheduled)"
  | "Endo Cube"
  | "Standalone Small Job";

// PTAC: 1 pre, 1 post, nameplate (3 required) + optional filter + additional
// Standard/Medium/Large: 3 sides pre, 3 sides post, nameplate (7 required)
//                        + optional filter + additional
export type PhotoSlot =
  | "pre1"
  | "pre2"
  | "pre3"
  | "post1"
  | "post2"
  | "post3"
  | "nameplate"
  | "filter"
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
  unitSubType: UnitSubType;
  pre1Url: string;
  pre2Url: string;
  pre3Url: string;
  post1Url: string;
  post2Url: string;
  post3Url: string;
  nameplateUrl: string;
  filterUrl: string;
  additionalUrls: string;
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
