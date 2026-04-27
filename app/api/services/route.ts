import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureDraftDispatch } from "@/lib/data/dispatches";
import { createService } from "@/lib/data/services";
import type { ServiceType } from "@/lib/types";

const SERVICE_TYPES: ServiceType[] = [
  "Thermostat (regular)",
  "Thermostat (scheduled)",
  "Endo Cube",
  "Standalone Small Job",
];

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
  const jobId = String(body.jobId ?? "");
  const serviceType = body.serviceType as ServiceType;
  const quantity = Number(body.quantity ?? 1);
  const notes = String(body.notes ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }
  if (!SERVICE_TYPES.includes(serviceType)) {
    return NextResponse.json({ error: "Pick a service" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json({ error: "Quantity must be at least 1" }, { status: 400 });
  }
  try {
    const dispatch = await ensureDraftDispatch(jobId);
    const service = await createService({
      dispatchId: dispatch.dispatchId,
      jobId,
      serviceType,
      quantity,
      notes,
      loggedBy: session.name,
    });
    return NextResponse.json({ service, dispatchId: dispatch.dispatchId });
  } catch (e) {
    console.error("Service creation failed:", e);
    return NextResponse.json(
      { error: "Could not save service. Try again." },
      { status: 500 }
    );
  }
}
