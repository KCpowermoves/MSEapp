#!/usr/bin/env node
// Generates engineering/sow-template.docx — a clean, from-scratch SOW
// template for docxtemplater. Authored fresh (NOT derived from the
// Mango Grove SOW) so no customer-specific figures can ever leak onto
// another customer's signed document.
//
// Merge fields: {customerName}, {siteAddress}, {today}. Everything
// project-specific (savings, rates, ECM equipment counts, schedule) is
// left as blank fill-ins for the engineer to complete in Word.
//
// Re-run any time the boilerplate changes:
//   node scripts/build-sow-template.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PizZip from "pizzip";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "..", "engineering", "sow-template.docx");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// One paragraph. opts: { bold, size (half-points), align, space (after, twips) }
function p(text, opts = {}) {
  const { bold = false, size = 22, align = "left", space = 120 } = opts;
  const rPr =
    `<w:rPr>${bold ? "<w:b/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const jc = align !== "left" ? `<w:jc w:val="${align}"/>` : "";
  const run = text
    ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
    : "";
  return `<w:p><w:pPr><w:spacing w:after="${space}"/>${jc}</w:pPr>${run}</w:p>`;
}

const POLICY =
  "The Customer's authorization to schedule work constitutes full acceptance and approval of all Energy Conservation Measures (ECMs) identified in this document. If the Customer wishes to modify, remove, or dispute any ECM, the Customer must notify Contractor in writing and request a review meeting prior to scheduling. If, after scheduling, the Customer refuses or prevents implementation of any approved ECM at the time of service, such refusal shall be deemed a cancellation of that ECM. The Customer shall be responsible for all costs incurred by Contractor related to that ECM, including but not limited to materials ordered, allocated labor, engineering costs, and administrative costs. Contractor shall issue an invoice for these costs, which shall be due and payable to the contractor within 30 days.";

const body = [
  p("Scope of Work", { bold: true, size: 36, align: "center", space: 80 }),
  p("{customerName}", { bold: true, size: 28, align: "center", space: 40 }),
  p("{siteAddress}", { size: 22, align: "center", space: 40 }),
  p("Prepared on {today}", { size: 18, align: "center", space: 240 }),

  p("Executive Summary", { bold: true, size: 26 }),
  p(
    "Maryland Smart Energy has conducted a preliminary energy study for {customerName}, identifying the Energy Conservation Measures (ECMs) below. These measures were evaluated based on historical rates of $______ per kWh and $______ per Therm.",
    { space: 200 }
  ),

  p("Estimated Annual Savings", { bold: true, size: 26 }),
  p("Energy: ______ kWh/yr", { space: 40 }),
  p("Cost: $______/yr", { space: 200 }),

  p("Proposed ECMs", { bold: true, size: 26 }),
  p("ECM 1: Optimize HVAC schedule by implementing schedule into thermostats", {
    bold: true,
  }),
  p(
    "Optimizing runtime schedules and night setback temperature set points will reduce the total runtime of the units. Unoccupied heating setpoint will be set to 55°F and unoccupied cooling setpoint will be set to 85°F.",
    { space: 40 }
  ),
  p("Proposed Schedule: ________________________________________", {
    space: 200,
  }),
  p("ECM 2: Replace refrigeration temperature sensor", { bold: true }),
  p(
    "New sensor elements will be installed on walk-in coolers and freezers to enable precise control of food storage temperatures based on the actual temperature of the food products. This improves efficiency by limiting runtime of cooling elements to when it is truly needed.",
    { space: 40 }
  ),
  p("Proposed Equipment to be Installed:", { space: 40 }),
  p("(____) Networked programmable thermostats", { space: 40 }),
  p("(____) EndoCube Temperature Sensor Elements", { space: 200 }),

  p("ECM Authorization and Refusal Policy", { bold: true, size: 26 }),
  p(POLICY, { space: 200 }),

  p(
    "Please sign below to authorize the performance of the scope of work outlined above.",
    { space: 200 }
  ),
  p("Signature: _________________________________________________", {
    space: 160,
  }),
  p("Printed Name: ______________________________________________", {
    space: 160,
  }),
  p("Title: _____________________________________________________", {
    space: 160,
  }),
  p("Date: ______________________________________________________", {
    space: 40,
  }),
].join("");

const sectPr =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

const documentXml =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}${sectPr}</w:body></w:document>`;

const contentTypes =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  "</Types>";

const rels =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

// Store as UTF-8 buffers so non-ASCII (the ° symbol) encodes correctly.
const zip = new PizZip();
zip.file("[Content_Types].xml", Buffer.from(contentTypes, "utf8"));
zip.file("_rels/.rels", Buffer.from(rels, "utf8"));
zip.file("word/document.xml", Buffer.from(documentXml, "utf8"));

const buf = zip.generate({ type: "nodebuffer" });
fs.writeFileSync(OUT, buf);
console.log(`Wrote ${OUT} (${buf.length} bytes)`);
