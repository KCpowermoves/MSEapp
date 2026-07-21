import "server-only";
import {
  TABS,
  appendRows,
  ensureTabExists,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextProspectId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type { Prospect } from "@/lib/types";

// Sheet column layout for "Prospects":
// A: ProspectId | B: ImportedAt | C: ImportedBy | D: Status
// E: Agent | F: BusinessName | G: ContactName | H: Title | I: Phone
// J: Email | K: Address | L: City | M: Zip | N: Utility
// O: AccountNumber | P: HvacUnits | Q: Notes | R: UsedByLeadId
// S: ListName

const HEADERS = [
  "ProspectId", "ImportedAt", "ImportedBy", "Status", "Agent",
  "BusinessName", "ContactName", "Title", "Phone", "Email",
  "Address", "City", "Zip", "Utility", "AccountNumber", "HvacUnits",
  "Notes", "UsedByLeadId", "ListName",
];

async function ensureProspectsTab(): Promise<void> {
  await ensureTabExists(TABS.prospects, HEADERS);
}

function rowToProspect(row: string[]): Prospect {
  return {
    prospectId: String(row[0] ?? ""),
    importedAt: String(row[1] ?? ""),
    importedBy: String(row[2] ?? ""),
    status: String(row[3] ?? "New") === "Used" ? "Used" : "New",
    agent: String(row[4] ?? ""),
    businessName: String(row[5] ?? ""),
    contactName: String(row[6] ?? ""),
    title: String(row[7] ?? ""),
    phone: String(row[8] ?? ""),
    email: String(row[9] ?? ""),
    address: String(row[10] ?? ""),
    city: String(row[11] ?? ""),
    zip: String(row[12] ?? ""),
    utility: String(row[13] ?? ""),
    accountNumber: String(row[14] ?? ""),
    hvacUnits: String(row[15] ?? ""),
    notes: String(row[16] ?? ""),
    usedByLeadId: String(row[17] ?? ""),
    listName: String(row[18] ?? ""),
  };
}

export async function listAllProspects(
  opts: { fresh?: boolean } = {}
): Promise<Prospect[]> {
  try {
    const rows = await readTab(TABS.prospects, opts);
    return rows.filter((r) => r[0]).map(rowToProspect);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unable to parse range")) {
      try {
        await ensureProspectsTab();
      } catch {
        /* ignore */
      }
      return [];
    }
    throw e;
  }
}

/** New (unused) prospects a rep can pick from: their assigned ones
 *  plus any with no agent set. Admins see all New prospects. */
export async function listAvailableProspects(opts: {
  agentName: string;
  isAdmin: boolean;
}): Promise<Prospect[]> {
  const all = await listAllProspects();
  const agent = opts.agentName.trim().toLowerCase();
  return all
    .filter((p) => p.status === "New")
    .filter(
      (p) =>
        opts.isAdmin ||
        !p.agent.trim() ||
        p.agent.trim().toLowerCase() === agent
    )
    .sort((a, b) => {
      const byAddr = (a.address || "~").localeCompare(b.address || "~", undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (byAddr !== 0) return byAddr;
      return (a.businessName || a.contactName).localeCompare(
        b.businessName || b.contactName
      );
    });
}

export async function getProspect(prospectId: string): Promise<Prospect | null> {
  if (!prospectId) return null;
  const all = await listAllProspects({ fresh: true });
  return all.find((p) => p.prospectId === prospectId) ?? null;
}

export interface ProspectInput {
  agent: string;
  businessName: string;
  contactName: string;
  title: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  zip: string;
  utility: string;
  accountNumber: string;
  hvacUnits: string;
  notes: string;
}

/** Bulk-append imported prospects. Returns the count written. */
export async function addProspects(
  inputs: ProspectInput[],
  importedBy: string,
  listName: string
): Promise<number> {
  await ensureProspectsTab();
  if (inputs.length === 0) return 0;
  const importedAt = nowIso();
  // Reserve a contiguous id block so a single batch append gets unique
  // sequential ids without a read per row.
  const first = await nextProspectId();
  const m = first.match(/^(PROS-\d{4}-)(\d+)$/);
  const prefix = m ? m[1] : "PROS-0000-";
  let n = m ? Number(m[2]) : 1;
  const rows = inputs.map((p) => {
    const id = `${prefix}${String(n++).padStart(5, "0")}`;
    return [
      id, importedAt, importedBy, "New", p.agent,
      p.businessName, p.contactName, p.title, p.phone, p.email,
      p.address, p.city, p.zip, p.utility, p.accountNumber, p.hvacUnits,
      p.notes, "", listName,
    ];
  });
  // Chunk large imports (e.g. 11k rows) so no single Sheets request is
  // oversized; each chunk auto-expands the grid.
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await appendRows(TABS.prospects, rows.slice(i, i + CHUNK));
  }
  return rows.length;
}

/** Mark a prospect Used once a lead has been created from it. */
export async function markProspectUsed(
  prospectId: string,
  leadId: string
): Promise<void> {
  const rowIndex = await findRowIndex(TABS.prospects, "A", prospectId);
  if (!rowIndex) return;
  await updateCell(`${TABS.prospects}!D${rowIndex}`, "Used", "RAW");
  await updateCell(`${TABS.prospects}!R${rowIndex}`, leadId, "RAW");
}

/** Mark remaining New prospects Used — the admin "clear list" action.
 *  Pass a listName to clear just that batch, or omit to clear all.
 *  Rows stay for the record; they just drop off the picker. */
export async function clearProspects(listName?: string): Promise<number> {
  const all = await listAllProspects({ fresh: true });
  let cleared = 0;
  for (const p of all) {
    if (p.status !== "New") continue;
    if (listName !== undefined && p.listName !== listName) continue;
    const rowIndex = await findRowIndex(TABS.prospects, "A", p.prospectId);
    if (!rowIndex) continue;
    await updateCell(`${TABS.prospects}!D${rowIndex}`, "Used", "RAW");
    cleared++;
  }
  return cleared;
}
