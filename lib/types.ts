export type UtilityTerritory = "BGE" | "PEPCO" | "Delmarva" | "SMECO";

export type JobStatus = "Active" | "Closed";

export type CrewSplit = "Solo" | "50-50" | "33-33-33";

export type UnitType =
  | "PTAC"
  | "Standard 3-20"
  | "Mid-Large 20-50"
  | "Large 50+";

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

export type PhotoSlot = "pre" | "post" | "clean" | "nameplate" | "filter";

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
  prePhotoUrl: string;
  postPhotoUrl: string;
  cleanPhotoUrl: string;
  nameplatePhotoUrl: string;
  filterPhotoUrl: string;
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
