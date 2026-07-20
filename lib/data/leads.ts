import "server-only";
import {
  TABS,
  appendRow,
  ensureTabExists,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import crypto from "crypto";
import { nextLeadId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type { Lead, LeadStatus, UtilityProgram } from "@/lib/types";

// Sheet column layout for "Leads":
// A: LeadId | B: CreatedAt | C: AgentName | D: Status
// E: BusinessName | F: ContactName | G: Email | H: Phone
// I: Address | J: City | K: Zip | L: Utility | M: AccountNumber
// N: HvacUnits | O: Notes | P: SignToken | Q: SignedPdfUrl
// R: SignedAt | S: JobId | T: AssignTech | U: AssignDate | V: UpdatedAt
// W: Title | X: PrimaryUse | Y: CustomerType | Z: DeliveryMethod

const LEADS_HEADERS = [
  "LeadId",
  "CreatedAt",
  "AgentName",
  "Status",
  "BusinessName",
  "ContactName",
  "Email",
  "Phone",
  "Address",
  "City",
  "Zip",
  "Utility",
  "AccountNumber",
  "HvacUnits",
  "Notes",
  "SignToken",
  "SignedPdfUrl",
  "SignedAt",
  "JobId",
  "AssignTech",
  "AssignDate",
  "UpdatedAt",
  "Title",
  "PrimaryUse",
  "CustomerType",
  "DeliveryMethod",
];

async function ensureLeadsTab(): Promise<void> {
  await ensureTabExists(TABS.leads, LEADS_HEADERS);
}

function rowToLead(row: string[]): Lead {
  return {
    leadId: String(row[0] ?? ""),
    createdAt: String(row[1] ?? ""),
    agentName: String(row[2] ?? ""),
    status: (String(row[3] ?? "Sent") as LeadStatus) || "Sent",
    businessName: String(row[4] ?? ""),
    contactName: String(row[5] ?? ""),
    email: String(row[6] ?? ""),
    phone: String(row[7] ?? ""),
    address: String(row[8] ?? ""),
    city: String(row[9] ?? ""),
    zip: String(row[10] ?? ""),
    utility: (String(row[11] ?? "BGE") as UtilityProgram) || "BGE",
    accountNumber: String(row[12] ?? ""),
    hvacUnits: String(row[13] ?? ""),
    notes: String(row[14] ?? ""),
    signToken: String(row[15] ?? ""),
    signedPdfUrl: String(row[16] ?? ""),
    signedAt: String(row[17] ?? ""),
    jobId: String(row[18] ?? ""),
    assignTech: String(row[19] ?? ""),
    assignDate: String(row[20] ?? ""),
    updatedAt: String(row[21] ?? ""),
    title: String(row[22] ?? ""),
    primaryUse: String(row[23] ?? ""),
    customerType: String(row[24] ?? ""),
    deliveryMethod: String(row[25] ?? ""),
  };
}

export async function listAllLeads(
  opts: { fresh?: boolean } = {}
): Promise<Lead[]> {
  try {
    const rows = await readTab(TABS.leads, opts);
    return rows.filter((r) => r[0]).map(rowToLead);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) {
      // Tab doesn't exist yet — self-provision and return empty.
      try {
        await ensureLeadsTab();
      } catch (provisionErr) {
        console.warn("[leads] tab provision failed:", provisionErr);
      }
      return [];
    }
    throw e;
  }
}

export async function getLead(leadId: string): Promise<Lead | null> {
  const all = await listAllLeads();
  const hit = all.find((l) => l.leadId === leadId);
  if (hit) return hit;
  const fresh = await listAllLeads({ fresh: true });
  return fresh.find((l) => l.leadId === leadId) ?? null;
}

export async function listLeadsForAgent(agentName: string): Promise<Lead[]> {
  const all = await listAllLeads();
  return all
    .filter((l) => l.agentName === agentName)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function createLead(input: {
  agentName: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
  utility: UtilityProgram;
  accountNumber: string;
  hvacUnits: string;
  notes: string;
  title?: string;
  primaryUse?: string;
  customerType?: string;
  deliveryMethod?: string;
  assignTech?: string;
  assignDate?: string;
}): Promise<Lead> {
  await ensureLeadsTab();
  const leadId = await nextLeadId();
  const createdAt = nowIso();
  // URL-safe, unguessable signing token — this IS the auth for the
  // public signing page, so it must not be enumerable.
  const signToken = crypto.randomBytes(18).toString("base64url");
  await appendRow(TABS.leads, [
    leadId,
    createdAt,
    input.agentName,
    "Sent",
    input.businessName,
    input.contactName,
    input.email,
    input.phone,
    input.address,
    input.city,
    input.zip,
    input.utility,
    input.accountNumber,
    input.hvacUnits,
    input.notes,
    signToken,
    "",
    "",
    "",
    input.assignTech ?? "",
    input.assignDate ?? "",
    createdAt,
    input.title ?? "",
    input.primaryUse ?? "",
    input.customerType ?? "",
    input.deliveryMethod ?? "",
  ]);
  return {
    leadId,
    createdAt,
    agentName: input.agentName,
    status: "Sent",
    businessName: input.businessName,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
    address: input.address,
    city: input.city,
    zip: input.zip,
    utility: input.utility,
    accountNumber: input.accountNumber,
    hvacUnits: input.hvacUnits,
    notes: input.notes,
    signToken,
    signedPdfUrl: "",
    signedAt: "",
    jobId: "",
    assignTech: input.assignTech ?? "",
    assignDate: input.assignDate ?? "",
    updatedAt: createdAt,
    title: input.title ?? "",
    primaryUse: input.primaryUse ?? "",
    customerType: input.customerType ?? "",
    deliveryMethod: input.deliveryMethod ?? "",
  };
}

async function leadRowIndex(leadId: string): Promise<number> {
  const rowIndex = await findRowIndex(TABS.leads, "A", leadId);
  if (!rowIndex) throw new Error(`Lead not found: ${leadId}`);
  return rowIndex;
}

export async function updateLead(opts: {
  leadId: string;
  status?: LeadStatus;
  signedPdfUrl?: string;
  signedAt?: string;
  jobId?: string;
  assignTech?: string;
  assignDate?: string;
}): Promise<void> {
  const rowIndex = await leadRowIndex(opts.leadId);
  const writes: Promise<void>[] = [];
  const set = (col: string, val: string) =>
    writes.push(updateCell(`${TABS.leads}!${col}${rowIndex}`, val, "RAW"));
  if (opts.status !== undefined) set("D", opts.status);
  if (opts.signedPdfUrl !== undefined) set("Q", opts.signedPdfUrl);
  if (opts.signedAt !== undefined) set("R", opts.signedAt);
  if (opts.jobId !== undefined) set("S", opts.jobId);
  if (opts.assignTech !== undefined) set("T", opts.assignTech);
  if (opts.assignDate !== undefined) set("U", opts.assignDate);
  set("V", nowIso());
  await Promise.all(writes);
}

/** Update the agreement's editable customer fields — called when the
 *  signing page submits with corrections the agent or customer made
 *  at the table. */
export async function updateLeadFields(opts: {
  leadId: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  zip: string;
  accountNumber: string;
  hvacUnits: string;
  title: string;
  primaryUse: string;
  customerType: string;
}): Promise<void> {
  const rowIndex = await leadRowIndex(opts.leadId);
  const writes: Promise<void>[] = [];
  const set = (col: string, val: string) =>
    writes.push(updateCell(`${TABS.leads}!${col}${rowIndex}`, val, "RAW"));
  set("E", opts.businessName);
  set("F", opts.contactName);
  set("G", opts.email);
  set("H", opts.phone);
  set("I", opts.address);
  set("J", opts.city);
  set("K", opts.zip);
  set("M", opts.accountNumber);
  set("N", opts.hvacUnits);
  set("W", opts.title);
  set("X", opts.primaryUse);
  set("Y", opts.customerType);
  set("V", nowIso());
  await Promise.all(writes);
}

/** Look up a lead by its public signing token. Fresh read — the
 *  signing page must never act on a stale row. */
export async function getLeadByToken(token: string): Promise<Lead | null> {
  if (!token || token.length < 12) return null;
  const all = await listAllLeads({ fresh: true });
  return all.find((l) => l.signToken === token) ?? null;
}
