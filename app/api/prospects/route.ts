import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listAvailableProspects } from "@/lib/data/prospects";

// GET /api/prospects — the New Lead picker's dropdown source: prospects
// this rep can pull from (their assigned ones + any unassigned).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const prospects = await listAvailableProspects({
    agentName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  return NextResponse.json({ prospects });
}
