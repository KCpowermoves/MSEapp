export type UtilityTerritory = "BGE" | "PEPCO" | "Delmarva" | "SMECO";

export type JobStatus = "Active" | "Closed";

export type CrewSplit = "Solo" | "50-50" | "33-33-33";

// Simple (1-side) types share the same 3-photo template.
// RTU types share the 7-photo coil template.
//
// Split units split 2026-05-27 into separate Outdoor and Indoor types
// so techs log them as two units when servicing both sides.
//   - "Outdoor Split System" uses the original 3-side outdoor + filter
//     pattern (8 photos).
//   - "Indoor Split System" uses the air-handler-only pattern with
//     its own filter (4 photos).
//   - "Split System" stays in the union for historical rows that still
//     reference it. New jobs don't see it in the picker.
export type UnitType =
  | "PTAC / Ductless"
  | "Split System"
  | "Outdoor Split System"
  | "Indoor Split System"
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
  /** Whether this tech can access the /admin dashboard. Set in column F
   *  of the Techs tab — TRUE/false. Defaults to false. */
  isAdmin: boolean;
  /** Whether this tech appears in the crew picker on new-job / submit.
   *  Set in column G of the Techs tab. Defaults to TRUE when the cell
   *  is empty so existing techs keep showing up. Office admins who
   *  don't go on jobs get FALSE so they stay able to log in but drop
   *  out of the on-site crew list. */
  crewEligible: boolean;
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
  /** Tech in charge of the project. Set when an admin creates the
   *  project via /admin/projects/new; blank for tech-initiated jobs.
   *  Stored in column N of the Jobs sheet. */
  projectLead: string;
  /** Drive file ID of the job's cover photo. Optional — set when the
   *  admin/tech uploads one during job creation, or later via the
   *  edit page. Empty string when not provided. Stored in column O of
   *  the Jobs sheet. */
  coverPhotoFileId: string;
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
  /** Drive URL of the customer's on-site signature (PNG). Empty when
   *  the tech submitted without capturing one. */
  signatureUrl: string;
  /** Printed name of the person who signed (defaults to customer name
   *  but can be overridden — e.g. property manager). */
  signedByName: string;
  /** Drive URL of the auto-generated service report PDF. */
  reportPdfUrl: string;
  /** Customer email captured at signature step — where the report PDF
   *  should be emailed once it's ready. Empty when not provided. */
  customerEmail: string;
  /** Customer's self-reported star rating (1–5) from the post-signature
   *  screen. 0 means not yet captured. */
  customerRating: number;
  /** Free-text feedback from customers who rated below 5 stars. Empty
   *  for 5-star ratings (those route to Google Reviews instead). */
  customerFeedback: string;
  /** ISO timestamp when the auto-send email was last fired successfully.
   *  Empty when the email hasn't gone out yet — guards the auto-send
   *  path so we don't double-email from concurrent triggers. */
  reportEmailedAt: string;
  /** Customer's opt-in to let MSE share their before/after photos and
   *  service story for marketing. Captured on the 5-star feedback step
   *  AFTER the Google review CTA so it never distracts from the
   *  review. Empty/false means "no permission". */
  marketingConsent: boolean;
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
  isAdmin?: boolean;
  /** When set, the cookie's identity (techId/name/isAdmin) is the
   *  impersonated tech and these fields carry the real admin who
   *  initiated impersonation. Cleared by /api/admin/impersonate/exit. */
  impersonatorTechId?: string;
  impersonatorName?: string;
}

// ─── Payroll ──────────────────────────────────────────────────────────

export type PayrollStatus = "Draft" | "Approved" | "Paid";

/**
 * A payroll period is a slice of time over which we compute each tech's
 * earned pay. Custom date ranges so the admin can run weekly, biweekly,
 * "this Tuesday only," whatever they need. Status moves Draft → Approved
 * → Paid; "Approved" freezes the adjustment buttons until the admin
 * clicks "Unlock to edit" (which reverts to Draft and clears Approval).
 */
export interface PayrollPeriod {
  periodId: string;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
  status: PayrollStatus;
  label: string;     // optional human-friendly label like "May 1–14, 2026"
  createdBy: string;
  createdAt: string; // ISO
  approvedBy: string;
  approvedAt: string;
  paidBy: string;
  paidAt: string;
  note: string;
}

/**
 * Adjustments layer on top of the Pay Attribution rows — they never
 * overwrite the originals. Final paycheck = sum of attribution within
 * the period + sum of adjustments tagged to that period.
 *
 *  - "manual"            : free-form +/- with note (most common)
 *  - "reattribute_from"  : -$X removed from a tech (paired with _to row)
 *  - "reattribute_to"    : +$X added to another tech (paired with _from)
 *  - "split_change"      : delta from retroactively re-splitting a dispatch
 *  - "standalone"        : free-form line for work done outside the app
 */
export type PayrollAdjustmentType =
  | "manual"
  | "reattribute_from"
  | "reattribute_to"
  | "split_change"
  | "standalone";

export interface PayrollAdjustment {
  adjustmentId: string;
  periodId: string;
  techName: string;
  type: PayrollAdjustmentType;
  amount: number; // signed: positive = pay, negative = clawback
  description: string;
  relatedDispatchId: string;
  relatedUnitId: string;
  /** When pairing two rows (re-attribution, split change), this names
   *  the counterparty so the UI can show "moved from Alice" etc. */
  relatedTech: string;
  createdBy: string;
  createdAt: string;
  note: string;
}

// ─── Energy Walkthrough Audit ────────────────────────────────────────

export type AuditStatus = "Draft" | "Complete";

export interface Audit {
  auditId: string;
  jobId: string;
  status: AuditStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  /** Empty string until the tech taps Audit Complete. */
  completedAt: string;
  completedBy: string;
  /** Drive file URL for the front-of-building photo, optional. */
  frontPhotoUrl: string;
  /** Optional fire escape / M1 plan photo. */
  firePlanPhotoUrl: string;
  /** Optional BAS panel photo — Xavier usually handles BAS himself. */
  basPhotoUrl: string;
  basNotes: string;
  notes: string;
}

export type AuditItemType = "Walk-In" | "Thermostat" | "Water-Source";

export type WaterSourceSubtype =
  | "Chiller"
  | "Cooling Tower"
  | "Boiler"
  | "Controls"
  | "Other";

export type AuditItemStatus = "Active" | "Orphaned";

export interface AuditItem {
  itemId: string;
  auditId: string;
  jobId: string;
  itemType: AuditItemType;
  /** Water-source-only subtype. Empty string for walk-ins/thermostats. */
  itemSubtype: WaterSourceSubtype | "";
  /** 1-indexed counter within (auditId, itemType). What the tech sees
   *  as "Walk-In 1", "Walk-In 2". */
  itemNumber: number;
  label: string;
  // Polymorphic photo slots — empty string when not applicable.
  modelLabelPhotoUrl: string;
  nameplatePhotoUrl: string;
  fansPhotoUrl: string;
  tempPhotoUrl: string;
  wiringPhotoUrl: string;
  locationPhotoUrl: string;
  /** Thermostat schedule: 1..N URLs, comma-separated. */
  schedulePhotoUrlsCsv: string;
  controlsPhotoUrl: string;
  notes: string;
  loggedBy: string;
  loggedAt: string;
  status: AuditItemStatus;
}

/** Logical photo slot for the audit upload route. Determines which
 *  column the URL gets written to on the Audits or Audit Items row. */
export type AuditPhotoSlot =
  // Audits row (kind=audit-building)
  | "front"
  | "fire-plan"
  | "bas"
  // Audit Items row (kind=audit-item)
  | "model-label"
  | "nameplate"
  | "fans"
  | "temp"
  | "wiring"
  | "location"
  | "schedule"
  | "controls";

// ─── Engineering Preliminary Calculator ──────────────────────────────

export type EngineeringProjectStatus = "Draft" | "Final" | "Deleted";
export type EngineeringUtility = "BGE" | "PEPCO" | "Delmarva" | "SMECO";
export type EngineeringProjectType = "Small" | "Medium" | "Large";
export type EngineeringLocation = "BWI" | "Andrews";

export interface MonthlyBill {
  /** ISO date string, e.g. "2024-01-01" */
  startDate: string;
  endDate: string;
  /** kWh usage for the billing period */
  usage: number;
  /** Heating degree days */
  hdd: number;
  /** Cooling degree days */
  cdd: number;
  /** Demand kW (optional) */
  demandKw?: number;
  /** Demand cost ($) (optional) */
  demandCost?: number;
}

export interface HvacUnitInput {
  tag: string;
  serves: string;
  /** Whether the unit has a thermostat ("Yes"/"No"/free text) */
  tstat: string;
  /** Cooling tonnage */
  tons: number;
  /** Outdoor-unit model number */
  ouModel: string;
  qty: number;
  seer: number;
  supplyFanHp: number;
  /** "Yes" / "No" */
  heatPump: string;
  /** Auxiliary electric heating in kW (optional) */
  electricHeatKw?: number;
  controls: string;
  proposedSchedule: string;
  notes: string;
}

export type WalkInKind = "Cooler" | "Freezer";

export interface WalkInUnitInput {
  kind: WalkInKind;
  tag: string;
  condenserModel: string;
  serial: string;
  evaporatorModel: string;
  tonnage: number;
  mbh: number;
  watts: number;
  /** Annual Walk-in Energy Factor */
  awef: number;
  fanMotorHp: number;
  numFans: number;
}

export interface EngineeringProject {
  projectId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  status: EngineeringProjectStatus;
  customerName: string;
  siteAddress: string;
  utility: EngineeringUtility;
  projectType: EngineeringProjectType;
  projectSubtype: string;
  squareFootage: number;
  location: EngineeringLocation;
  annualKwh: number;
  /** Engineer can override the calculated engineering fee */
  engineeringFeeOverride: number | null;
  /** Engineer can override the calculated sensor cost */
  sensorCostOverride: number | null;
  monthlyBills: MonthlyBill[];
  hvacUnits: HvacUnitInput[];
  walkInUnits: WalkInUnitInput[];
  notes: string;
}
