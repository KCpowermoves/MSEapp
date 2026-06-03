import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextAuditId } from "@/lib/id-generators";
import { nowIso } from "@/lib/utils";
import type { Audit, AuditStatus } from "@/lib/types";

function rowToAudit(row: string[]): Audit {
  return {
    auditId: String(row[0] ?? ""),
    jobId: String(row[1] ?? ""),
    status: (row[2] as AuditStatus) || "Draft",
    createdAt: String(row[3] ?? ""),
    createdBy: String(row[4] ?? ""),
    updatedAt: String(row[5] ?? ""),
    completedAt: String(row[6] ?? ""),
    completedBy: String(row[7] ?? ""),
    frontPhotoUrl: String(row[8] ?? ""),
    firePlanPhotoUrl: String(row[9] ?? ""),
    basPhotoUrl: String(row[10] ?? ""),
    basNotes: String(row[11] ?? ""),
    notes: String(row[12] ?? ""),
  };
}

export async function listAllAudits(
  opts: { fresh?: boolean } = {}
): Promise<Audit[]> {
  const rows = await readTab(TABS.audits, opts);
  return rows.filter((r) => r[0]).map(rowToAudit);
}

export async function getAuditForJob(
  jobId: string
): Promise<Audit | null> {
  const all = await listAllAudits();
  return all.find((a) => a.jobId === jobId) ?? null;
}

export async function getAudit(
  auditId: string
): Promise<Audit | null> {
  const all = await listAllAudits();
  return all.find((a) => a.auditId === auditId) ?? null;
}

/**
 * Idempotent create-or-get. If an audit row exists for jobId, returns
 * it. Otherwise creates a new Draft audit and returns it. Safe to
 * call on every page load of /jobs/[jobId]/audit.
 */
export async function ensureAudit(opts: {
  jobId: string;
  createdBy: string;
}): Promise<Audit> {
  const existing = await getAuditForJob(opts.jobId);
  if (existing) return existing;
  const auditId = await nextAuditId();
  const isoNow = nowIso();
  await appendRow(TABS.audits, [
    auditId,
    opts.jobId,
    "Draft",
    isoNow,
    opts.createdBy,
    isoNow,
    "", // CompletedAt
    "", // CompletedBy
    "", // FrontPhotoUrl
    "", // FirePlanPhotoUrl
    "", // BasPhotoUrl
    "", // BasNotes
    "", // Notes
  ]);
  return {
    auditId,
    jobId: opts.jobId,
    status: "Draft",
    createdAt: isoNow,
    createdBy: opts.createdBy,
    updatedAt: isoNow,
    completedAt: "",
    completedBy: "",
    frontPhotoUrl: "",
    firePlanPhotoUrl: "",
    basPhotoUrl: "",
    basNotes: "",
    notes: "",
  };
}

/**
 * Column-letter map for setAuditField. Keep in sync with the Audits
 * sheet schema (seed/init-sheet.mjs).
 */
const AUDIT_COLS = {
  status: "C",
  updatedAt: "F",
  completedAt: "G",
  completedBy: "H",
  frontPhotoUrl: "I",
  firePlanPhotoUrl: "J",
  basPhotoUrl: "K",
  basNotes: "L",
  notes: "M",
} as const;

export async function setAuditField(opts: {
  auditId: string;
  field: keyof typeof AUDIT_COLS;
  value: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.audits, "A", opts.auditId);
  if (!rowIndex) throw new Error(`Audit not found: ${opts.auditId}`);
  const col = AUDIT_COLS[opts.field];
  await updateCell(`${TABS.audits}!${col}${rowIndex}`, opts.value);
  // Bump UpdatedAt on every change so the admin sees recency.
  if (opts.field !== "updatedAt") {
    await updateCell(
      `${TABS.audits}!${AUDIT_COLS.updatedAt}${rowIndex}`,
      nowIso()
    );
  }
}

export async function setAuditStatus(opts: {
  auditId: string;
  status: AuditStatus;
  byTechName: string;
}): Promise<void> {
  const rowIndex = await findRowIndex(TABS.audits, "A", opts.auditId);
  if (!rowIndex) throw new Error(`Audit not found: ${opts.auditId}`);
  const isoNow = nowIso();
  if (opts.status === "Complete") {
    await Promise.all([
      updateCell(`${TABS.audits}!${AUDIT_COLS.status}${rowIndex}`, "Complete"),
      updateCell(`${TABS.audits}!${AUDIT_COLS.completedAt}${rowIndex}`, isoNow),
      updateCell(
        `${TABS.audits}!${AUDIT_COLS.completedBy}${rowIndex}`,
        opts.byTechName
      ),
      updateCell(`${TABS.audits}!${AUDIT_COLS.updatedAt}${rowIndex}`, isoNow),
    ]);
  } else {
    await Promise.all([
      updateCell(`${TABS.audits}!${AUDIT_COLS.status}${rowIndex}`, "Draft"),
      updateCell(`${TABS.audits}!${AUDIT_COLS.completedAt}${rowIndex}`, ""),
      updateCell(`${TABS.audits}!${AUDIT_COLS.completedBy}${rowIndex}`, ""),
      updateCell(`${TABS.audits}!${AUDIT_COLS.updatedAt}${rowIndex}`, isoNow),
    ]);
  }
}
