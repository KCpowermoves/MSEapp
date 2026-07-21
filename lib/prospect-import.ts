// Flexible CSV parser for admin-uploaded prospect lists. Matches
// columns by header name (with synonyms) so most exported spreadsheets
// "just work" — the admin exports their sheet to CSV and uploads it.
// Client-safe (no server imports); used by the import API.

import type { ProspectInput } from "@/lib/data/prospects";

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped
 *  quotes, commas and newlines inside quotes, and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // handled by the \n branch; ignore lone CR
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row (files without a final newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const norm = (h: string) =>
  h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Real lists prefix headers ("Service City", "Primary Customer",
// "Phone 1"). Generate match candidates by stripping common leading
// qualifiers and trailing digits so those still map. "Mailing"/"Billing"
// are NOT stripped so the SERVICE address wins over the mailing address.
const STRIP_PREFIXES = ["service", "primary", "svc", "site", "premise"];

function headerVariants(base: string): string[] {
  const out = new Set<string>([base]);
  for (const p of STRIP_PREFIXES) {
    if (base.startsWith(p) && base.length > p.length + 1) out.add(base.slice(p.length));
  }
  for (const v of Array.from(out)) {
    const noDigits = v.replace(/\d+$/, "");
    if (noDigits && noDigits !== v) out.add(noDigits);
  }
  return Array.from(out);
}

// Header synonyms → canonical field. Order matters only for the
// first-match win when a header could map two ways.
const SYNONYMS: Record<keyof ProspectInput | "firstName" | "lastName", string[]> = {
  businessName: ["business", "businessname", "company", "companyname", "dba", "accountname", "customer", "customername", "customerfullname", "primarycustomer", "primarycustomerfullname", "name", "accountholder"],
  contactName: ["contact", "contactname", "contactperson", "owner", "ownername", "representative", "fullname"],
  firstName: ["firstname", "first"],
  lastName: ["lastname", "last"],
  title: ["title", "jobtitle", "role"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "cell", "cellphone", "contactphone"],
  email: ["email", "emailaddress", "e", "emailid"],
  address: ["address", "streetaddress", "street", "serviceaddress", "address1", "addressline1"],
  city: ["city", "town"],
  zip: ["zip", "zipcode", "postal", "postalcode", "zip5"],
  utility: ["utility", "electricutility", "program", "provider"],
  accountNumber: ["account", "accountnumber", "accountno", "utilityaccount", "acct", "acctnumber"],
  hvacUnits: ["units", "hvacunits", "numberofunits", "unitcount", "numunits", "ofunits"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
  agent: ["agent", "assigned", "assignedto", "rep", "salesrep", "salesperson", "owneragent"],
};

const UTILITY_MAP: Record<string, string> = {
  bge: "BGE",
  baltimoregasandelectric: "BGE",
  pepco: "PEPCO",
  potomacelectric: "PEPCO",
  delmarva: "Delmarva",
  delmarvapower: "Delmarva",
  smeco: "SMECO",
};

export interface ImportResult {
  prospects: ProspectInput[];
  matchedColumns: Record<string, string>; // canonical -> original header
  skipped: number; // rows with no business/contact name
  total: number;
  headers: string[]; // the header row, for diagnostics on a bad match
}

/** Parse a prospect CSV into ProspectInput rows via header matching. */
export function importProspectsCsv(text: string): ImportResult {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length < 2) {
    return { prospects: [], matchedColumns: {}, skipped: 0, total: 0, headers: [] };
  }
  const header = rows[0].map((h) => h.trim());
  const variantHeader = header.map((h) => new Set(headerVariants(norm(h))));

  // Build canonical -> column index. A header matches a field if any of
  // its variants (prefix/digit-stripped) equals one of the synonyms.
  const colFor: Partial<Record<string, number>> = {};
  const matchedColumns: Record<string, string> = {};
  const usedCols = new Set<number>();
  for (const [canonical, syns] of Object.entries(SYNONYMS)) {
    const idx = variantHeader.findIndex((vs, i) => {
      if (usedCols.has(i)) return false;
      return syns.some((s) => vs.has(s));
    });
    if (idx >= 0) {
      colFor[canonical] = idx;
      matchedColumns[canonical] = header[idx];
      usedCols.add(idx);
    }
  }

  const get = (r: string[], canonical: string): string => {
    const idx = colFor[canonical];
    return idx === undefined ? "" : String(r[idx] ?? "").trim();
  };

  const prospects: ProspectInput[] = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    let contactName = get(r, "contactName");
    if (!contactName) {
      const fn = get(r, "firstName");
      const ln = get(r, "lastName");
      contactName = [fn, ln].filter(Boolean).join(" ");
    }
    const businessName = get(r, "businessName");
    if (!businessName && !contactName) {
      skipped++;
      continue;
    }
    const rawUtil = norm(get(r, "utility"));
    const utility = UTILITY_MAP[rawUtil] ?? "";
    prospects.push({
      agent: get(r, "agent"),
      businessName,
      contactName,
      title: get(r, "title"),
      phone: get(r, "phone"),
      email: get(r, "email"),
      address: get(r, "address"),
      city: get(r, "city"),
      zip: get(r, "zip"),
      utility,
      accountNumber: get(r, "accountNumber"),
      hvacUnits: get(r, "hvacUnits"),
      notes: get(r, "notes"),
    });
  }

  return { prospects, matchedColumns, skipped, total: rows.length - 1, headers: header };
}
