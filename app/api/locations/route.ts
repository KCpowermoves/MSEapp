import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  recordLocationEvent,
  type LocationEventType,
} from "@/lib/data/locations";

const VALID_TYPES: LocationEventType[] = [
  "login",
  "app-open",
  "job-create",
  "unit-save",
  "dispatch-submit",
  "permission-denied",
  "unsupported",
];

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const type = body.type as LocationEventType;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
  }

  try {
    await recordLocationEvent({
      techName: session.name ?? "",
      type,
      lat: asNumberOrNull(body.lat),
      lng: asNumberOrNull(body.lng),
      accuracy: asNumberOrNull(body.accuracy),
      jobId: body.jobId ? String(body.jobId).slice(0, 64) : undefined,
      unitId: body.unitId ? String(body.unitId).slice(0, 64) : undefined,
      notes: body.notes ? String(body.notes).slice(0, 200) : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("Location record failed:", e);
    // Never propagate location-write failure to the client. Location
    // tracking is best-effort and must not block the actual workflow.
    return NextResponse.json({ ok: true, suppressed: true });
  }
}
