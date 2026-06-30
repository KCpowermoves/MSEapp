import "server-only";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type { EngineeringProject } from "@/lib/types";

/**
 * Generate a populated SOW Word document for this project.
 *
 * Approach: load a pre-prepared SOW Word template from
 * `engineering/sow-template.docx` (with `{customerName}` etc.
 * placeholder syntax that docxtemplater understands), merge in the
 * project values, return as a Buffer.
 *
 * If the template file is not present (initial setup), this function
 * throws a clear error telling the operator how to create it. v1
 * starts with a minimal placeholder template; engineers iterate on it
 * over time without redeploys (they just commit a new
 * sow-template.docx).
 */
export async function fillSowTemplate(
  project: EngineeringProject
): Promise<Buffer> {
  const templatePath = path.join(
    process.cwd(),
    "engineering",
    "sow-template.docx"
  );

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `SOW template not found at engineering/sow-template.docx. ` +
        `Create one by copying the existing SOW (e.g. 'Mango Grove SOW.docx'), ` +
        `then replace project-specific values with placeholders like ` +
        `{customerName}, {siteAddress}, {utility}, {projectType}, ` +
        `{squareFootage}, {annualKwh}, {today}. Save the modified file as ` +
        `engineering/sow-template.docx (keep this filename) and commit it. ` +
        `The downloadSow API will then populate it with project data.`
    );
  }

  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  // Compute the merge values from the project. We mirror the values
  // that the original "Word Input" sheet in the Excel template
  // exposes for Word merge: customer + address + utility + project
  // type + sq ft + annual kWh + today's date.
  const mergeValues = {
    customerName: project.customerName || "",
    siteAddress: project.siteAddress || "",
    utility: project.utility,
    projectType: project.projectType,
    projectSubtype: project.projectSubtype || "",
    squareFootage: project.squareFootage
      ? project.squareFootage.toLocaleString()
      : "",
    annualKwh: project.annualKwh
      ? project.annualKwh.toLocaleString()
      : "",
    today: new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    projectId: project.projectId,
  };

  doc.render(mergeValues);

  const out = doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
  return out;
}
