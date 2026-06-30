#!/usr/bin/env node
// Structural inspector for a source Excel workbook.
//
// Doesn't dump every cell — just produces a high-level map of what's
// in the workbook so we can plan the port:
//   - Sheet names + dimensions (used range)
//   - Per-sheet counts of cells with formulas vs literal values vs blank
//   - Top N formulas seen on each sheet (sampled — useful to spot the
//     calculation engine vs lookup tables)
//   - Named ranges
//   - Merged-cell regions
//   - Any external links the workbook depends on
//
// Usage:  node engineering/inspect-structure.mjs <path-to-workbook.xlsx>
//
// Output: prints a markdown summary to stdout. Pipe to a .dump.md file
// to save.

import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node engineering/inspect-structure.mjs <file.xlsx>");
  process.exit(1);
}

const absPath = path.isAbsolute(inputPath)
  ? inputPath
  : path.resolve(__dirname, "..", inputPath);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(absPath);

console.log(`# Structural inspection: ${path.basename(absPath)}`);
console.log();
console.log(`- File size: ${(await fileSize(absPath)).toLocaleString()} bytes`);
console.log(`- Sheet count: ${wb.worksheets.length}`);

// Named ranges (workbook-level definedNames)
const definedNames = wb.definedNames?.matrixMap
  ? Array.from(Object.keys(wb.definedNames.matrixMap))
  : [];
console.log(`- Named ranges: ${definedNames.length}`);
if (definedNames.length > 0 && definedNames.length <= 40) {
  for (const n of definedNames) console.log(`  - ${n}`);
} else if (definedNames.length > 40) {
  console.log(`  - (showing first 40)`);
  for (const n of definedNames.slice(0, 40)) console.log(`  - ${n}`);
}
console.log();

for (const sheet of wb.worksheets) {
  console.log(`## Sheet: "${sheet.name}"`);
  console.log();
  const dim = sheet.dimensions;
  console.log(
    `- Dimensions: ${dim ? `${dim.tl} : ${dim.br}` : "(empty)"}`
  );
  console.log(`- Row count (actual): ${sheet.actualRowCount ?? 0}`);
  console.log(`- Column count (actual): ${sheet.actualColumnCount ?? 0}`);
  console.log(`- Hidden: ${sheet.state === "hidden" || sheet.state === "veryHidden" ? "YES" : "no"}`);

  // Walk cells, count categories + sample formulas
  let cellTotal = 0;
  let cellFormula = 0;
  let cellValue = 0;
  let cellEmpty = 0;
  let cellString = 0;
  let cellNumber = 0;
  let cellBoolean = 0;
  const formulaSamples = new Map(); // formula text → first 3 cell refs
  const colHeaders = new Map(); // col letter → header from row 1 (string only)

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cellTotal++;
      const v = cell.value;
      if (v === null || v === undefined || v === "") {
        cellEmpty++;
        return;
      }
      if (typeof v === "object" && v !== null && "formula" in v) {
        cellFormula++;
        const f = v.formula;
        if (!formulaSamples.has(f)) formulaSamples.set(f, []);
        const refs = formulaSamples.get(f);
        if (refs.length < 3) refs.push(cell.address);
      } else {
        cellValue++;
        if (typeof v === "string") {
          cellString++;
          // Capture row 1 as likely column headers
          if (rowNum === 1) colHeaders.set(cell.col, v);
        } else if (typeof v === "number") cellNumber++;
        else if (typeof v === "boolean") cellBoolean++;
      }
    });
  });

  console.log(`- Cell census:`);
  console.log(`  - total non-empty: ${cellTotal.toLocaleString()}`);
  console.log(`  - formulas: ${cellFormula.toLocaleString()}`);
  console.log(`  - literal values: ${cellValue.toLocaleString()} (string=${cellString}, number=${cellNumber}, bool=${cellBoolean})`);
  console.log(`  - empty (skipped): ${cellEmpty.toLocaleString()}`);

  // Top headers from row 1 (gives a quick sense of what the sheet is about)
  if (colHeaders.size > 0) {
    console.log(`- Row 1 headers (first ${Math.min(colHeaders.size, 15)}):`);
    const entries = Array.from(colHeaders.entries()).slice(0, 15);
    for (const [col, header] of entries) {
      console.log(`  - col ${col}: ${truncate(header, 60)}`);
    }
  }

  // Distinct formula patterns (compacted) — useful to see the engine
  if (formulaSamples.size > 0) {
    const compacted = compactFormulas(formulaSamples);
    console.log(`- Distinct formula patterns: ${compacted.size}`);
    const top = Array.from(compacted.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);
    for (const [pattern, info] of top) {
      console.log(
        `  - ${truncate(pattern, 90)}  ×${info.count}  e.g. ${info.examples.slice(0, 2).join(", ")}`
      );
    }
  }

  // Merged regions — usually layout / label cells
  const mergedCellList = Array.from(sheet.model.merges ?? []);
  if (mergedCellList.length > 0) {
    console.log(`- Merged regions: ${mergedCellList.length}`);
  }

  console.log();
}

// ───────────────────────────────────────────────────────────────────

import { stat } from "node:fs/promises";

async function fileSize(p) {
  const s = await stat(p);
  return s.size;
}

function truncate(s, n) {
  const str = String(s ?? "");
  return str.length <= n ? str : str.slice(0, n - 1) + "…";
}

// Replace specific cell refs (e.g. "B12") with "$col$row" so similar
// formulas across rows collapse to one pattern.
function compactFormulas(map) {
  const out = new Map();
  for (const [formula, refs] of map.entries()) {
    const pattern = String(formula).replace(/\$?[A-Z]{1,3}\$?\d+/g, "<cell>");
    const cur = out.get(pattern) ?? { count: 0, examples: [] };
    cur.count += refs.length;
    if (cur.examples.length < 3) {
      cur.examples.push(`${refs[0]}=${truncate(formula, 40)}`);
    }
    out.set(pattern, cur);
  }
  return out;
}
