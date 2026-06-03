import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAudit } from "@/lib/data/audits";
import { createAuditItem } from "@/lib/data/audit-items";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import type { AuditItemType, WaterSourceSubtype } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: AuditItemType[] = ["Walk-In", "Thermostat", "Water-Source"];
const VALID_SUBTYPES: WaterSourceSubtype[] = [
  "Chiller",
  "Cooling Tower",
  "Boiler",
  "Controls",
  "Other",
];

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auditId = String(body.auditId ?? "").trim();
  const jobId = String(body.jobId ?? "").trim();
  const itemType = body.itemType as AuditItemType;
  const itemSubtypeRaw = String(body.itemSubtype ?? "") as WaterSourceSubtype | "";
  const itemNumber = Number(body.itemNumber);
  const label = String(body.label ?? "").trim();

  if (!auditId || !jobId) {
    return NextResponse.json({ error: "Missing auditId or jobId" }, { status: 400 });
  }
  if (!VALID_TYPES.includes(itemType)) {
    return NextResponse.json({ error: "Invalid itemType" }, { status: 400 });
  }
  if (!Number.isInteger(itemNumber) || itemNumber < 1) {
    return NextResponse.json({ error: "itemNumber must be a positive integer" }, { status: 400 });
  }
  if (itemSubtypeRaw && !VALID_SUBTYPES.includes(itemSubtypeRaw)) {
    return NextResponse.json({ error: "Invalid itemSubtype" }, { status: 400 });
  }

  const audit = await getAudit(auditId);
  if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  if (audit.jobId !== jobId) {
    return NextResponse.json({ error: "Audit does not belong to this job" }, { status: 400 });
  }
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const item = await createAuditItem({
      auditId,
      jobId,
      itemType,
      itemSubtype: itemSubtypeRaw,
      itemNumber,
      label,
      loggedBy: session.name ?? "",
    });
    return NextResponse.json({ item });
  } catch (e) {
    console.error("[audit-items POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
