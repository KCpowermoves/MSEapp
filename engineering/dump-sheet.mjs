#!/usr/bin/env node
// Dump one sheet at the cell level. For each non-empty row, show
// the row number, the leftmost label cell, then every populated cell
// with its value or formula. Used to identify the exact data-entry
// layout of the source template.
//
// Usage: node engineering/dump-sheet.mjs <file.xlsx> <sheet-name>

import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2];
const sheetName = process.argv[3];
if (!inputPath || !sheetName) {
  console.error("Usage: node engineering/dump-sheet.mjs <file.xlsx> <sheet-name>");
  process.exit(1);
}

const absPath = path.isAbsolute(inputPath)
  ? inputPath
  : path.resolve(__dirname, "..", inputPath);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(absPath);
const sheet = wb.getWorksheet(sheetName);
if (!sheet) {
  console.error(`Sheet not found: "${sheetName}"`);
  console.error(`Available: ${wb.worksheets.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

console.log(`# Sheet: "${sheetName}" in ${path.basename(absPath)}`);
console.log();

function colLetter(col) {
  let s = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellRepr(cell) {
  const v = cell.value;
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object" && v !== null) {
    if ("formula" in v) {
      const cached =
        v.result !== undefined && v.result !== null ? `=${v.result}` : "";
      return `fx{${truncate(String(v.formula), 50)}}${cached ? "→" + truncate(String(cached), 20) : ""}`;
    }
    if (v instanceof Date) return `📅${v.toISOString().slice(0, 10)}`;
    if ("text" in v) return truncate(String(v.text), 60);
    if ("richText" in v) {
      return truncate(v.richText.map((rt) => rt.text).join(""), 60);
    }
    return JSON.stringify(v).slice(0, 60);
  }
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(3);
  }
  return truncate(String(v), 60);
}

function fillRepr(cell) {
  const fill = cell.fill;
  if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") return "";
  const argb = fill.fgColor?.argb || fill.bgColor?.argb || "";
  if (!argb) return "";
  const rgb = argb.length === 8 ? argb.slice(2) : argb;
  if (rgb === "FFFFFF" || rgb === "FFFFFFFF") return "";
  return `[${rgb}]`;
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length <= n ? str : str.slice(0, n - 1) + "…";
}

// Build column-header row guesses (row 1 or 2 string cells)
const headerRow = sheet.getRow(1);
const headers = {};
headerRow.eachCell({ includeEmpty: false }, (cell) => {
  const v = cell.value;
  if (typeof v === "string") headers[colLetter(cell.col)] = truncate(v, 25);
});

sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
  // Find a row label — first non-empty string cell from columns A–E
  let label = "";
  for (let c = 1; c <= 5; c++) {
    const v = row.getCell(c).value;
    if (typeof v === "string" && v.trim()) {
      label = v.trim();
      break;
    }
  }
  const cells = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    const repr = cellRepr(cell);
    const fill = fillRepr(cell);
    if (repr === "" && fill === "") return;
    cells.push(`${cell.address}${fill}=${repr}`);
  });
  if (cells.length === 0) return;
  console.log(
    `**Row ${rowNum}**${label ? ` (${truncate(label, 30)})` : ""}: ${cells.join("  ·  ")}`
  );
});
