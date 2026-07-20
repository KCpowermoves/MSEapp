import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getLead, updateLead } from "@/lib/data/leads";
import { convertLeadToJob } from "@/lib/data/lead-convert";
import { createVisit } from "@/lib/data/schedule";

// PATCH /api/leads/[leadId]
//   { action: "mark-signed" }                      → ADMIN-ONLY override:
//     create a job for a lead with no customer e-signature (e.g. a
//     paper-signed deal). Regular agents cannot — a job only comes from
//     a real signature via /api/sign/[token], or an admin creating it.
//   { action: "cancel" }                           → dead lead
//   { action: "assign", assignTech, assignDate }   → set/replace the
//     at-sale assignment; if the lead already converted, schedules a
//     visit on the job directly.
//
// Permissions: the owning agent or any admin (mark-signed: admin only).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { leadId: string } }
) {
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const leadId = decodeURIComponent(params.leadId);
  const lead = await getLead(leadId);
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  if (!session.isAdmin && lead.agentName !== session.name) {
    return NextResponse.json({ error: "Not your lead" }, { status: 403 });
  }

  let body: { action?: unknown; assignTech?: unknown; assignDate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const action = String(body.action ?? "");

  try {
    if (action === "mark-signed") {
      // A job without a customer e-signature is an admin-only override.
      if (!session.isAdmin) {
        return NextResponse.json(
          {
            error:
              "Only an admin can create a job without a customer e-signature. Have the customer sign the agreement, or ask an admin.",
          },
          { status: 403 }
        );
      }
      const result = await convertLeadToJob({
        leadId,
        by: `${session.name ?? session.techId} (admin override, no e-signature)`,
      });
      revalidatePath("/sales");
      revalidatePath("/jobs");
      return NextResponse.json({
        ok: true,
        jobId: result.lead.jobId,
        created: result.created,
      });
    }

    if (action === "cancel") {
      if (lead.jobId) {
        return NextResponse.json(
          { error: "Lead already converted to a job — close the job instead." },
          { status: 409 }
        );
      }
      await updateLead({ leadId, status: "Cancelled" });
      revalidatePath("/sales");
      return NextResponse.json({ ok: true });
    }

    if (action === "assign") {
      const assignTech = String(body.assignTech ?? "").trim();
      const assignDate = String(body.assignDate ?? "").trim();
      if (!assignTech || !/^\d{4}-\d{2}-\d{2}$/.test(assignDate)) {
        return NextResponse.json(
          { error: "assignTech and assignDate (YYYY-MM-DD) required" },
          { status: 400 }
        );
      }
      await updateLead({ leadId, assignTech, assignDate });
      if (lead.jobId) {
        // Already a job — put the visit straight on the calendar.
        await createVisit({
          jobId: lead.jobId,
          date: assignDate,
          startTime: "09:00",
          durationMins: 120,
          techs: [assignTech],
          notes: `Assigned from sales by ${session.name ?? ""}`,
          estUnits: Number(lead.hvacUnits) || 0,
          auditRequired: false,
          createdBy: session.name ?? session.techId,
        });
      }
      revalidatePath("/sales");
      revalidatePath("/admin/schedule");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: 'action must be "mark-signed", "cancel", or "assign"' },
      { status: 400 }
    );
  } catch (e) {
    console.error("[leads PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 500 }
    );
  }
}
