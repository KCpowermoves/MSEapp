import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createLead, listAllLeads, listLeadsForAgent } from "@/lib/data/leads";
import { markProspectUsed } from "@/lib/data/prospects";
import { UTILITY_PROGRAM_LABELS } from "@/lib/programs";
import type { UtilityProgram } from "@/lib/types";

// GET  /api/leads → my leads (admin: ?all=1 for everyone's)
// POST /api/leads → create a lead; its signing token powers the
// public /sign/[token] agreement page (native e-sign, no third party).
// Any active login can sell — techs and sales-only users alike.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const url = new URL(request.url);
  const wantAll = url.searchParams.get("all") === "1" && session.isAdmin;
  const leads = wantAll
    ? (await listAllLeads()).sort((a, b) =>
        (b.createdAt || "").localeCompare(a.createdAt || "")
      )
    : await listLeadsForAgent(session.name ?? "");
  return NextResponse.json({ leads });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const s = (k: string) => String(body[k] ?? "").trim();
  const businessName = s("businessName");
  const contactName = s("contactName");
  const phone = s("phone");
  const utility = s("utility") as UtilityProgram;

  if (!businessName && !contactName) {
    return NextResponse.json(
      { error: "Business or contact name is required" },
      { status: 400 }
    );
  }
  if (!phone && !s("email")) {
    return NextResponse.json(
      { error: "A phone number or email is required to send the agreement" },
      { status: 400 }
    );
  }
  if (!UTILITY_PROGRAM_LABELS[utility]) {
    return NextResponse.json(
      { error: "Pick a valid utility program" },
      { status: 400 }
    );
  }

  const agentName = session.name ?? "";

  try {
    const lead = await createLead({
      agentName,
      businessName,
      contactName,
      title: s("title"),
      email: s("email"),
      phone,
      address: s("address"),
      city: s("city"),
      zip: s("zip"),
      utility,
      accountNumber: s("accountNumber"),
      choiceServiceId: s("choiceServiceId"),
      hvacUnits: s("hvacUnits"),
      notes: s("notes"),
      primaryUse: s("primaryUse"),
      customerType: s("customerType"),
      deliveryMethod: s("deliveryMethod"),
      assignTech: s("assignTech") || undefined,
      assignDate: s("assignDate") || undefined,
    });
    // If this lead came from an imported prospect, retire it from the
    // picker. Best-effort — a failure here must not fail the lead.
    const prospectId = s("prospectId");
    if (prospectId) {
      markProspectUsed(prospectId, lead.leadId).catch((e) =>
        console.warn("[leads POST] markProspectUsed failed:", e)
      );
    }
    return NextResponse.json({ lead });
  } catch (e) {
    console.error("[leads POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save lead" },
      { status: 500 }
    );
  }
}
