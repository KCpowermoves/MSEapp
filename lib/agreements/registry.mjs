// Agreement packet registry — the single source of truth for which
// documents each utility packet contains, where every fill value
// lands, and where signatures go. Client-safe (data only).
//
// Coordinate system: PDF points on the source page (Letter, 612x792),
// x from LEFT, yTop from TOP of the page (the fill engine converts to
// PDF bottom-left origin; the signing page converts to CSS percents).
//
// Sources:
//  - shared field keys (businessName, contactName, title, email,
//    phone, address, city, zip, accountNumber, hvacUnits)
//  - "!state"  literal MD
//  - "!date" | "!day" | "!month" | "!year"  signing date parts
//  - "!requestorName|Org|Address|Email|Phone"  MSE requestor block
//  - "!X"  a checkbox/radio mark
//  - "!nameAndTitle"  "Contact, Title" combo
//
// AcroForm docs are filled by field NAME (acroText/acroCheck) and
// flattened; flat docs get drawn overlays (fill). Signature spots are
// always drawn images.

/** Requestor block on consent/data-release letters — per Kevin
 *  2026-07-20: always Xavier Suchar, representing MSE. */
export const REQUESTOR = {
  name: "Xavier Suchar",
  org: "Maryland Smart Energy",
  address: "328 N Eutaw St, Fl 3, Baltimore, MD 21201",
  email: "service@mdsmartenergy.com",
  phone: "(301) 888-7090",
};

export const PRIMARY_USE_OPTIONS = [
  "Office", "Retail", "School", "University", "Religious Facility",
  "Grocery", "Restaurant", "Lodging", "Industrial", "Warehouse",
  "Health Facility", "Multifamily", "Other",
];

export const CUSTOMER_TYPE_OPTIONS = [
  "Corporation", "LLC", "Partnership", "Individual Proprietorship",
  "Not-for-Profit",
];

// x/yTop coordinates for the Primary Use + Customer Type check marks
// on the SMECO Small participation agreement (smeco-small page 3).
const PRIMARY_USE_MARKS = {
  "Office": { x: 48.5, yTop: 168 },
  "Retail": { x: 116, yTop: 168 },
  "School": { x: 183, yTop: 168 },
  "University": { x: 255, yTop: 168 },
  "Religious Facility": { x: 342, yTop: 168 },
  "Grocery": { x: 438, yTop: 168 },
  "Restaurant": { x: 505, yTop: 168 },
  "Lodging": { x: 48.5, yTop: 180.5 },
  "Industrial": { x: 116, yTop: 180.5 },
  "Warehouse": { x: 183, yTop: 180.5 },
  "Health Facility": { x: 255, yTop: 180.5 },
  "Multifamily": { x: 342, yTop: 180.5 },
  "Other": { x: 438, yTop: 180.5 },
};

const CUSTOMER_TYPE_MARKS = {
  "Corporation": { x: 31, yTop: 311 },
  "LLC": { x: 111, yTop: 311 },
  "Partnership": { x: 164, yTop: 311 },
  "Individual Proprietorship": { x: 248, yTop: 311 },
  "Not-for-Profit": { x: 382, yTop: 311 },
};

export const DOCS = {
  "bge-enhanced": {
    label: "BGE Enhanced Unitary HVAC Maintenance — Terms & Acknowledgement",
    pages: 3,
    acroText: {
      "Project Name": "businessName",
      "Street Address of the facility": "address",
      "City": "city",
      "State": "!state",
      "Zip": "zip",
      "Authorized Representative Name please print": "contactName",
      "Title": "title",
      "Email": "email",
      "Telephone No": "phone",
      "Date": "!date",
      "Date_2": "!date",
      "Text1": "accountNumber",
      "Text2": "hvacUnits",
    },
    acroCheck: ["Contractor"],
    acroDisplay: [
      { page: 3, x: 84.8, yTop: 105.6, size: 9, source: "businessName" },
      { page: 3, x: 146.5, yTop: 139.7, size: 9, source: "address" },
      { page: 3, x: 48, yTop: 156.7, size: 9, source: "city" },
      { page: 3, x: 347.2, yTop: 156.7, size: 9, source: "!state" },
      { page: 3, x: 439.5, yTop: 156.7, size: 9, source: "zip" },
      { page: 3, x: 204.6, yTop: 173.8, size: 9, source: "contactName" },
      { page: 3, x: 402.6, yTop: 173.8, size: 9, source: "title" },
      { page: 3, x: 54, yTop: 190.8, size: 9, source: "email" },
      { page: 3, x: 439.2, yTop: 190.8, size: 9, source: "phone" },
      { page: 3, x: 443.4, yTop: 283.3, size: 9, source: "!date" },
      { page: 3, x: 448.5, yTop: 445.7, size: 9, source: "!date" },
      { page: 3, x: 92, yTop: 494.6, size: 9, source: "accountNumber" },
      { page: 3, x: 91.4, yTop: 516.7, size: 9, source: "hvacUnits" },
    ],
    fill: [],
    sigs: [
      { page: 3, x: 168, yTop: 276, w: 180, h: 24 },
      { page: 3, x: 222, yTop: 439, w: 170, h: 24 },
    ],
  },

  "bge-btu": {
    label: "BGE Building Tune-Up — Terms & Acknowledgement",
    pages: 2,
    fill: [
      { page: 2, x: 98, yTop: 138, source: "businessName" },
      { page: 2, x: 162, yTop: 180, source: "address" },
      { page: 2, x: 66, yTop: 202, source: "city" },
      { page: 2, x: 250, yTop: 202, source: "!state" },
      { page: 2, x: 470, yTop: 202, source: "zip" },
      { page: 2, x: 228, yTop: 225, source: "contactName" },
      { page: 2, x: 368, yTop: 225, source: "title" },
      { page: 2, x: 72, yTop: 249, source: "email" },
      { page: 2, x: 402, yTop: 249, source: "phone" },
      { page: 2, x: 405, yTop: 385, source: "!date" },
      { page: 2, x: 425, yTop: 540, source: "!date" },
    ],
    sigs: [
      { page: 2, x: 178, yTop: 368, w: 170, h: 26 },
      { page: 2, x: 228, yTop: 528, w: 160, h: 24 },
    ],
  },

  "bge-release": {
    label: "BGE Customer Data Release Form",
    pages: 1,
    acroText: {
      "Tenant name": "contactName",
      "Title": "title",
      "Business name of record": "businessName",
      "Service address": "address",
      "City": "city",
      "State": "!state",
      "ZIP": "zip",
      "Phone": "phone",
      "BGE account number": "accountNumber",
      "Day": "!day",
      "Month": "!month",
      "Year": "!year",
      "City_2": "city",
      "State_2": "!state",
      "ZIP_2": "zip",
      "Name": "!requestorName",
      "Phone_2": "!requestorPhone",
      "Email": "!requestorEmail",
    },
    acroDisplay: [
      { page: 1, x: 56, yTop: 159.5, size: 9, source: "contactName" },
      { page: 1, x: 307.9, yTop: 159.5, size: 9, source: "title" },
      { page: 1, x: 49.3, yTop: 186.5, size: 9, source: "businessName" },
      { page: 1, x: 49.3, yTop: 213.3, size: 9, source: "address" },
      { page: 1, x: 307.9, yTop: 213.3, size: 9, source: "city" },
      { page: 1, x: 408.2, yTop: 213.3, size: 9, source: "!state" },
      { page: 1, x: 492.8, yTop: 213.3, size: 9, source: "zip" },
      { page: 1, x: 253.4, yTop: 600.9, size: 9, source: "phone" },
      { page: 1, x: 396.9, yTop: 600.9, size: 9, source: "accountNumber" },
      { page: 1, x: 105.6, yTop: 628.2, size: 9, source: "!day" },
      { page: 1, x: 205.9, yTop: 628.2, size: 9, source: "!month" },
      { page: 1, x: 271.6, yTop: 628.2, size: 9, source: "!year" },
      { page: 1, x: 345.3, yTop: 628.2, size: 9, source: "city" },
      { page: 1, x: 425, yTop: 628.2, size: 9, source: "!state" },
      { page: 1, x: 493.5, yTop: 628.2, size: 9, source: "zip" },
      { page: 1, x: 49.3, yTop: 658, size: 9, source: "!requestorName" },
      { page: 1, x: 253.6, yTop: 658, size: 9, source: "!requestorPhone" },
      { page: 1, x: 397.2, yTop: 658, size: 9, source: "!requestorEmail" },
    ],
    fill: [],
    sigs: [{ page: 1, x: 52, yTop: 594, w: 160, h: 20 }],
  },

  "pepco-terms": {
    label: "Pepco Building Tune-Up Program — Terms & Acknowledgement",
    pages: 5,
    fill: [
      { page: 5, x: 120, yTop: 146, source: "businessName" },
      { page: 5, x: 197, yTop: 159, source: "address" },
      { page: 5, x: 377, yTop: 159, source: "city" },
      { page: 5, x: 494, yTop: 159, source: "!state" },
      { page: 5, x: 540, yTop: 159, source: "zip" },
      { page: 5, x: 194, yTop: 172, source: "contactName" },
      { page: 5, x: 387, yTop: 172, source: "title" },
      { page: 5, x: 79, yTop: 186, source: "email" },
      { page: 5, x: 413, yTop: 186, source: "phone" },
      { page: 5, x: 452, yTop: 267, source: "!date" },
      { page: 5, x: 125, yTop: 402, size: 12, source: "!X" },
      { page: 5, x: 452, yTop: 424, source: "!date" },
    ],
    sigs: [
      { page: 5, x: 155, yTop: 257, w: 170, h: 22 },
      { page: 5, x: 155, yTop: 417, w: 170, h: 20 },
    ],
  },

  "pepco-consent": {
    label: "Pepco Data Release Consent Letter",
    pages: 1,
    acroText: {
      "Individual": "!requestorName",
      "Representing": "!requestorOrg",
      "Address": "!requestorAddress",
      "Email Address": "!requestorEmail",
      "Phone Number": "!requestorPhone",
      "Customer Name": "businessName",
      "Address_2": "address",
      "City": "city",
      "State": "!state",
      "Zip": "zip",
      "Business Contact Name": "contactName",
      "undefined": "phone",
      "Account Number as shown on latest bill 1": "accountNumber",
    },
    acroDisplay: [
      { page: 1, x: 82.2, yTop: 181.8, size: 9, source: "!requestorName" },
      { page: 1, x: 97.8, yTop: 204.2, size: 9, source: "!requestorOrg" },
      { page: 1, x: 81.8, yTop: 226.7, size: 9, source: "!requestorAddress" },
      { page: 1, x: 103.8, yTop: 249.2, size: 9, source: "!requestorEmail" },
      { page: 1, x: 318.4, yTop: 249.2, size: 9, source: "!requestorPhone" },
      { page: 1, x: 113.6, yTop: 435.7, size: 9, source: "businessName" },
      { page: 1, x: 76.8, yTop: 458.2, size: 9, source: "address" },
      { page: 1, x: 60.4, yTop: 480.6, size: 9, source: "city" },
      { page: 1, x: 261, yTop: 480.6, size: 9, source: "!state" },
      { page: 1, x: 337.2, yTop: 480.6, size: 9, source: "zip" },
      { page: 1, x: 148.3, yTop: 503.2, size: 9, source: "contactName" },
      { page: 1, x: 155.7, yTop: 525.6, size: 9, source: "phone" },
      { page: 1, x: 38.5, yTop: 615.7, size: 9, source: "accountNumber" },
    ],
    fill: [],
    sigs: [{ page: 1, x: 150, yTop: 552, w: 180, h: 26 }],
  },

  "delmarva-terms": {
    label: "Delmarva Power Building Tune-Up — Terms & Acknowledgement",
    pages: 6,
    fill: [
      { page: 6, x: 114, yTop: 105, source: "businessName" },
      { page: 6, x: 182, yTop: 119, source: "address" },
      { page: 6, x: 364, yTop: 119, source: "city" },
      { page: 6, x: 483, yTop: 119, source: "!state" },
      { page: 6, x: 526, yTop: 119, source: "zip" },
      { page: 6, x: 187, yTop: 132, source: "contactName" },
      { page: 6, x: 377, yTop: 132, source: "title" },
      { page: 6, x: 76, yTop: 145, source: "email" },
      { page: 6, x: 407, yTop: 145, source: "phone" },
      { page: 6, x: 445, yTop: 229, source: "!date" },
      { page: 6, x: 125, yTop: 366, size: 12, source: "!X" },
      { page: 6, x: 445, yTop: 387, source: "!date" },
    ],
    sigs: [
      { page: 6, x: 140, yTop: 220, w: 180, h: 24 },
      { page: 6, x: 140, yTop: 378, w: 180, h: 22 },
    ],
  },

  "delmarva-consent": {
    label: "Delmarva Power Data Release Consent Letter",
    pages: 1,
    fill: [
      { page: 1, x: 78, yTop: 201, source: "!requestorName" },
      { page: 1, x: 94, yTop: 223, source: "!requestorOrg" },
      { page: 1, x: 81, yTop: 245, source: "!requestorAddress" },
      { page: 1, x: 104, yTop: 266, source: "!requestorEmail" },
      { page: 1, x: 318, yTop: 266, source: "!requestorPhone" },
      { page: 1, x: 109, yTop: 455, source: "businessName" },
      { page: 1, x: 75, yTop: 478, source: "address" },
      { page: 1, x: 61, yTop: 500, source: "city" },
      { page: 1, x: 255, yTop: 500, source: "!state" },
      { page: 1, x: 345, yTop: 500, source: "zip" },
      { page: 1, x: 147, yTop: 523, source: "contactName" },
      { page: 1, x: 154, yTop: 546, source: "phone" },
      { page: 1, x: 45, yTop: 645, size: 10, source: "accountNumber" },
    ],
    sigs: [{ page: 1, x: 125, yTop: 560, w: 180, h: 22 }],
  },

  "smeco-enhanced": {
    label: "SMECO Enhanced Unitary HVAC Maintenance — Incentive Details",
    pages: 3,
    acroText: {
      "Text2": "businessName",
      "Text4": "address",
      "Text3": "city",
      "Text6": "!state",
      "Text7": "zip",
      "Text8": "contactName",
      "Text1": "title",
      "Text9": "email",
      "Text5": "phone",
      "Text13": "!date",
      "Text12": "!date",
      "Text14": "accountNumber",
    },
    acroDisplay: [
      { page: 3, x: 367, yTop: 185.4, size: 9, source: "title" },
      { page: 3, x: 69.4, yTop: 76.9, size: 9, source: "businessName" },
      { page: 3, x: 41.5, yTop: 158, size: 9, source: "city" },
      { page: 3, x: 118.8, yTop: 130.1, size: 9, source: "address" },
      { page: 3, x: 400.9, yTop: 212.4, size: 9, source: "phone" },
      { page: 3, x: 369.2, yTop: 157.7, size: 9, source: "!state" },
      { page: 3, x: 491.6, yTop: 158, size: 9, source: "zip" },
      { page: 3, x: 152.7, yTop: 184.4, size: 9, source: "contactName" },
      { page: 3, x: 46.4, yTop: 212.7, size: 9, source: "email" },
      { page: 3, x: 491, yTop: 435.1, size: 9, source: "!date" },
      { page: 3, x: 491.9, yTop: 283.8, size: 9, source: "!date" },
      { page: 3, x: 126.6, yTop: 536.1, size: 9, source: "accountNumber" },
    ],
    fill: [{ page: 3, x: 128, yTop: 556, size: 11, source: "hvacUnits" }],
    sigs: [
      { page: 3, x: 145, yTop: 276, w: 180, h: 28 },
      { page: 3, x: 205, yTop: 429, w: 170, h: 28 },
    ],
  },

  "smeco-bldg": {
    label: "SMECO Building Tune-Up Program — Incentive Details",
    pages: 2,
    fill: [
      { page: 2, x: 72, yTop: 70, source: "businessName" },
      { page: 2, x: 120, yTop: 125, source: "address" },
      { page: 2, x: 40, yTop: 152, source: "city" },
      { page: 2, x: 375, yTop: 152, source: "!state" },
      { page: 2, x: 498, yTop: 152, source: "zip" },
      { page: 2, x: 152, yTop: 180, source: "contactName" },
      { page: 2, x: 372, yTop: 180, source: "title" },
      { page: 2, x: 46, yTop: 207, source: "email" },
      { page: 2, x: 402, yTop: 207, source: "phone" },
      { page: 2, x: 500, yTop: 285, source: "!date" },
      { page: 2, x: 500, yTop: 440, source: "!date" },
    ],
    sigs: [
      { page: 2, x: 148, yTop: 272, w: 170, h: 28 },
      { page: 2, x: 212, yTop: 428, w: 160, h: 28 },
    ],
  },

  "smeco-release": {
    label: "SMECO Member Data Release Form",
    pages: 1,
    fill: [
      { page: 1, x: 60, yTop: 85, source: "contactName" },
      { page: 1, x: 350, yTop: 85, source: "title" },
      { page: 1, x: 60, yTop: 118, source: "businessName" },
      { page: 1, x: 55, yTop: 150, source: "address" },
      { page: 1, x: 340, yTop: 150, source: "city" },
      { page: 1, x: 502, yTop: 150, source: "!state" },
      { page: 1, x: 530, yTop: 150, source: "zip", size: 9 },
      { page: 1, x: 248, yTop: 595, source: "phone" },
      { page: 1, x: 395, yTop: 595, source: "accountNumber" },
      { page: 1, x: 105, yTop: 632, source: "!day" },
      { page: 1, x: 218, yTop: 632, source: "!month" },
      { page: 1, x: 298, yTop: 632, source: "!year" },
      { page: 1, x: 380, yTop: 632, source: "city", size: 9 },
      { page: 1, x: 484, yTop: 632, source: "!state" },
      { page: 1, x: 552, yTop: 632, source: "zip", size: 9 },
      { page: 1, x: 60, yTop: 666, source: "!requestorName" },
      { page: 1, x: 248, yTop: 666, source: "!requestorPhone", size: 9 },
      { page: 1, x: 395, yTop: 666, source: "!requestorEmail", size: 9 },
    ],
    sigs: [{ page: 1, x: 48, yTop: 585, w: 155, h: 26 }],
  },

  "smeco-small": {
    label: "SMECO Small Business HVAC Tune-Up + Participation Agreement",
    pages: 3,
    fill: [
      // Page 2 — General Information + acknowledgment
      { page: 2, x: 70, yTop: 240, source: "businessName" },
      { page: 2, x: 122, yTop: 295, source: "address" },
      { page: 2, x: 40, yTop: 322, source: "city" },
      { page: 2, x: 375, yTop: 322, source: "!state" },
      { page: 2, x: 498, yTop: 322, source: "zip" },
      { page: 2, x: 155, yTop: 350, source: "contactName" },
      { page: 2, x: 372, yTop: 350, source: "title" },
      { page: 2, x: 46, yTop: 377, source: "email" },
      { page: 2, x: 400, yTop: 377, source: "phone" },
      { page: 2, x: 500, yTop: 458, source: "!date" },
      { page: 2, x: 500, yTop: 610, source: "!date" },
      // Page 3 — Participation agreement grid
      { page: 3, x: 45, yTop: 72, source: "businessName" },
      { page: 3, x: 295, yTop: 72, source: "contactName" },
      { page: 3, x: 45, yTop: 95, source: "address" },
      { page: 3, x: 295, yTop: 95, source: "accountNumber" },
      { page: 3, x: 45, yTop: 116, source: "city", size: 9 },
      { page: 3, x: 165, yTop: 116, source: "!state", size: 9 },
      { page: 3, x: 228, yTop: 116, source: "zip", size: 9 },
      { page: 3, x: 295, yTop: 116, source: "phone", size: 9 },
      { page: 3, x: 480, yTop: 116, source: "email", size: 8.5 },
      { page: 3, x: 45, yTop: 280, source: "!nameAndTitle" },
      { page: 3, x: 480, yTop: 310, source: "!date" },
    ],
    marks: { primaryUse: PRIMARY_USE_MARKS, customerType: CUSTOMER_TYPE_MARKS },
    sigs: [
      { page: 2, x: 148, yTop: 448, w: 170, h: 26 },
      { page: 2, x: 212, yTop: 598, w: 160, h: 26 },
      { page: 3, x: 320, yTop: 272, w: 150, h: 24 },
    ],
  },
};

export const PACKETS = {
  "BGE": {
    label: "BGE — HVAC/Building Tune-up",
    utility: "BGE",
    docs: ["bge-enhanced", "bge-btu", "bge-release"],
  },
  "PEPCO": {
    label: "PEPCO — HVAC/Building Tune-up",
    utility: "PEPCO",
    docs: ["pepco-terms", "pepco-consent"],
  },
  "DELMARVA": {
    label: "Delmarva — HVAC/Building Tune-up",
    utility: "Delmarva",
    docs: ["delmarva-terms", "delmarva-consent"],
  },
  "SMECO-LARGE": {
    label: "SMECO — Building/Enhanced Tune-up (Large)",
    utility: "SMECO",
    docs: ["smeco-enhanced", "smeco-bldg", "smeco-release"],
  },
  "SMECO-SMALL": {
    label: "SMECO — Small Business Tune-up",
    utility: "SMECO",
    docs: ["smeco-small", "smeco-release"],
  },
};

/** Resolve a fill source to its string value. */
export function resolveSource(source, ctx) {
  if (!source.startsWith("!")) return ctx.fields[source] ?? "";
  switch (source) {
    case "!state": return "MD";
    case "!date": return ctx.dateLong; // e.g. "July 20, 2026"
    case "!day": return String(ctx.day);
    case "!month": return ctx.monthName;
    case "!year": return String(ctx.year);
    case "!requestorName": return REQUESTOR.name;
    case "!requestorOrg": return REQUESTOR.org;
    case "!requestorAddress": return REQUESTOR.address;
    case "!requestorEmail": return REQUESTOR.email;
    case "!requestorPhone": return REQUESTOR.phone;
    case "!X": return "X";
    case "!nameAndTitle":
      return [ctx.fields.contactName, ctx.fields.title]
        .filter(Boolean)
        .join(", ");
    default: return "";
  }
}
