import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { submitDispatch } from "@/lib/data/dispatches";
import { tryRenderPdfIfReady } from "@/lib/data/maybe-render-pdf";
import type { CrewSplit } from "@/lib/types";

const SPLITS: CrewSplit[] = ["Solo", "50-50", "33-33-33"];

export async function POST(request: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const dispatchId = String(body.dispatchId ?? "");
  const techsOnSite = Array.isArray(body.techsOnSite)
    ? body.techsOnSite.map((s: unknown) => String(s).trim()).filter(Boolean)
    : [];
  const crewSplit = body.crewSplit as CrewSplit;
  const driver = String(body.driver ?? "").trim();
  if (!dispatchId) {
    return NextResponse.json(
      { error: "Missing dispatchId" },
      { status: 400 }
    );
  }
  if (!SPLITS.includes(crewSplit)) {
    return NextResponse.json({ error: "Invalid crew split" }, { status: 400 });
  }
  if (techsOnSite.length === 0) {
    return NextResponse.json(
      { error: "At least one tech must be on site" },
      { status: 400 }
    );
  }
  try {
    const dispatch = await submitDispatch({
      dispatchId,
      techsOnSite,
      crewSplit,
      driver,
    });
    // Fire-and-forget PDF render. Catches the "all photos already
    // uploaded by submit time" case. The /api/upload handler also
    // calls this on each photo write — whichever finishes the
    // condition wins, the helper is idempotent.
    tryRenderPdfIfReady(dispatchId).catch((e) =>
      console.warn("[dispatches] post-submit PDF render error:", e)
    );
    return NextResponse.json(dispatch);
  } catch (e) {
    console.error("Dispatch submit failed:", e);
    return NextResponse.json(
      { error: "Could not submit dispatch. Try again." },
      { status: 500 }
    );
  }
}
