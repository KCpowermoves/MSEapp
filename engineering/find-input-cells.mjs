#!/usr/bin/env node
// Find every cell with a non-default fill across all sheets.
// Engineering templates typically color input cells (yellow / light
// yellow). Output lists each colored cell so we know exactly where
// the data-entry surface lives.
//
// Usage: node engineering/find-input-cells.mjs <path-to-template.xlsx>

import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node engineering/find-input-cells.mjs <file.xlsx>");
  process.exit(1);
}

const absPath = path.isAbsolute(inputPath)
  ? inputPath
  : path.resolve(__dirname, "..", inputPath);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(absPath);

console.log(`# Input cells in: ${path.basename(absPath)}`);
console.log();

const COLORED_FILLS = new Map(); // color → cells

for (const sheet of wb.worksheets) {
  const sheetColored = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const fill = cell.fill;
      if (!fill || fill.type !== "pattern") return;
      if (fill.pattern !== "solid" && fill.pattern !== "lightGray") return;
      const argb =
        fill.fgColor?.argb ||
        fill.bgColor?.argb ||
        "";
      if (!argb) return;
      // Skip "default" / very light grays that Excel sometimes ships
      // on header rows. Focus on saturated colors.
      const rgb = argb.length === 8 ? argb.slice(2) : argb;
      if (isLikelyInputColor(rgb)) {
        const isFormula =
          typeof cell.value === "object" &&
          cell.value !== null &&
          "formula" in cell.value;
        const valuePreview = isFormula
          ? `[formula] ${cell.value.formula}`
          : cell.value === null || cell.value === undefined
          ? "(empty)"
          : truncate(String(cell.value), 40);
        sheetColored.push({
          address: cell.address,
          row: rowNum,
          rgb,
          isFormula,
          preview: valuePreview,
        });
        const key = rgb;
        const list = COLORED_FILLS.get(key) ?? [];
        list.push(`${sheet.name}!${cell.address}`);
        COLORED_FILLS.set(key, list);
      }
    });
  });

  if (sheetColored.length === 0) continue;

  console.log(`## ${sheet.name}`);
  console.log();
  console.log(`Found ${sheetColored.length} colored cells.`);
  console.log();
  console.log(`| Cell | Color | Type | Preview |`);
  console.log(`|---|---|---|---|`);
  // Lookup row labels for context — grab the leftmost non-empty cell
  // on each row as a "row label" hint.
  const rowLabels = new Map();
  for (const c of sheetColored) {
    if (rowLabels.has(c.row)) continue;
    const r = sheet.getRow(c.row);
    let label = "";
    for (let i = 1; i <= 6; i++) {
      const v = r.getCell(i).value;
      if (typeof v === "string" && v.trim()) {
        label = v.trim();
        break;
      }
    }
    rowLabels.set(c.row, label);
  }
  for (const c of sheetColored) {
    const label = rowLabels.get(c.row) || "";
    const typ = c.isFormula ? "fx" : c.preview === "(empty)" ? "INPUT" : "value";
    console.log(
      `| ${c.address} | ${c.rgb} | ${typ} | ${label ? `${truncate(label, 30)} → ` : ""}${truncate(c.preview, 40)} |`
    );
  }
  console.log();
}

console.log(`---`);
console.log();
console.log(`## Distinct fill colors found`);
console.log();
for (const [color, cells] of Array.from(COLORED_FILLS.entries()).sort(
  (a, b) => b[1].length - a[1].length
)) {
  console.log(`- **${color}** (${cells.length} cells): e.g. ${cells.slice(0, 5).join(", ")}`);
}

// Heuristic — saturated yellows / oranges / blues are common input
// colors. Skip whites, blacks, very-light-grays.
function isLikelyInputColor(rgb) {
  if (!rgb || rgb.length !== 6) return false;
  const r = parseInt(rgb.slice(0, 2), 16);
  const g = parseInt(rgb.slice(2, 4), 16);
  const b = parseInt(rgb.slice(4, 6), 16);
  // White / off-white
  if (r > 240 && g > 240 && b > 240) return false;
  // Pure black
  if (r === 0 && g === 0 && b === 0) return false;
  // Very dark
  if (r < 30 && g < 30 && b < 30) return false;
  return true;
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length <= n ? str : str.slice(0, n - 1) + "…";
}
