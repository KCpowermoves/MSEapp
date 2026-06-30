# Engineering Preliminary Calculator Implementation Plan

> Reference: [docs/superpowers/specs/2026-06-24-engineering-prelim-calc-design.md](../specs/2026-06-24-engineering-prelim-calc-design.md)

**Goal:** Add `/admin/engineering` form-based workflow that generates a populated calculator workbook + SOW Word doc from user inputs.

**Architecture:** Template-fill (no formula port). Inputs → Sheet (Engineering Projects tab) → on demand fill source xlsx via exceljs / SOW docx via docxtemplater.

---

## Phase 0 — Foundation

- [ ] **Task 1: Schema**
  - Add `Engineering Projects` to `seed/init-sheet.mjs` (columns A–S per spec)
  - Create `scripts/init-engineering-tab.mjs` (mirror init-impersonation-tab pattern)
  - Run with `--apply` against live sheet
  - Commit: "Engineering: schema + init script (applied)"

- [ ] **Task 2: TABS + types + ID + template binary**
  - Add `engineeringProjects: "Engineering Projects"` to TABS
  - `lib/types.ts`: `EngineeringProject` interface + `EngineeringProjectStatus` enum + supporting types `MonthlyBill`, `HvacUnitInput`, `WalkInUnitInput`
  - `lib/id-generators.ts`: `nextEngineeringProjectId()` → `ENG-YYYY-NNNN`
  - Install `docxtemplater` + `pizzip` (exceljs already installed)
  - Add `.gitignore` exception for `engineering/template-BWI.xlsx`, copy the file in
  - Commit: "Engineering: types + ID generator + template + dependencies"

## Phase 1 — Data layer + API

- [ ] **Task 3: `lib/data/engineering-projects.ts`**
  - Functions: `listAllEngineeringProjects`, `getEngineeringProject(id)`, `createEngineeringProject(opts)`, `updateEngineeringProject(opts)`, `softDeleteEngineeringProject(id)`
  - Equipment arrays stored as JSON strings (col P, Q, R)
  - Commit: "Engineering: data access layer"

- [ ] **Task 4: API routes**
  - `app/api/admin/engineering/route.ts` (GET list + POST create)
  - `app/api/admin/engineering/[id]/route.ts` (GET / PATCH / DELETE)
  - All gated by `requireAdmin()`
  - Commit: "Engineering: CRUD API routes"

## Phase 2 — UI

- [ ] **Task 5: List page + admin tile**
  - `app/(app)/admin/engineering/page.tsx` — table of projects
  - Add tile to `/admin` landing page
  - Commit: "Engineering: list page + admin tile"

- [ ] **Task 6: Create form**
  - `app/(app)/admin/engineering/new/page.tsx` — minimal form (customer name + utility + location)
  - POSTs to API, redirects to `/admin/engineering/[id]`
  - Commit: "Engineering: new project form"

- [ ] **Task 7: Edit form (big component)**
  - `app/(app)/admin/engineering/[id]/page.tsx` — server shell
  - `components/engineering/ProjectForm.tsx` — client form with 5 sections (project info, utility bills, HVAC, walk-ins, settings)
  - Save-on-blur for top-level fields; explicit row-add/remove for tables
  - Bottom action bar with "Save" + "Download workbook" + "Download SOW"
  - Commit: "Engineering: project edit form (5 sections + action bar)"

## Phase 3 — Template fill + downloads

- [ ] **Task 8: `lib/engineering/cell-map.ts`**
  - The CELL_MAP constant from the spec
  - Type-safe form-field → cell-address mapping
  - Commit: "Engineering: cell-mapping config"

- [ ] **Task 9: `lib/engineering/template-fill.ts`**
  - `fillCalculatorTemplate(project)` returns populated xlsx Buffer
  - Walks the CELL_MAP, writes via exceljs to template
  - Commit: "Engineering: xlsx template-fill module"

- [ ] **Task 10: `/api/admin/engineering/[id]/xlsx` download route**
  - Streams the populated workbook back with `Content-Type: application/vnd.openxmlformats…`
  - Filename: `engineering-{customerSlug}-{projectId}.xlsx`
  - Commit: "Engineering: xlsx download route"

- [ ] **Task 11: `lib/engineering/sow-fill.ts`**
  - Use docxtemplater + pizzip
  - Convert `engineering/Mango Grove SOW.docx` → `engineering/sow-template.docx` with `{{placeholder}}` syntax (manual conversion step, committed)
  - `fillSowTemplate(project)` returns populated docx Buffer
  - Commit: "Engineering: SOW Word-merge module"

- [ ] **Task 12: `/api/admin/engineering/[id]/sow` download route**
  - Mirror the xlsx route shape
  - Filename: `sow-{customerSlug}-{projectId}.docx`
  - Commit: "Engineering: SOW download route"

## Phase 4 — Final

- [ ] **Task 13: Regression + merge + push + smoke**
  - `npm run build` clean
  - Merge `feature/engineering-prelim-calc` → main
  - Push
  - Smoke: POST /api/admin/engineering → 401, GET /admin/engineering → 307, no 500s

## Notes for implementer

- No Co-Authored-By Claude in commits.
- Don't push until end; merge then push together.
- The BWI template at `engineering/BWI Template highlighted.xlsx` is the source. Copy to `engineering/template-BWI.xlsx` for the runtime path (cleaner filename).
- v1 ships BWI only; Andrews dropdown option is disabled.
- The SOW template requires a manual conversion step (Word doc placeholders) — for v1, if the conversion's tricky, ship the xlsx-only download and add SOW in a follow-up commit. Don't block the main feature on SOW polish.
