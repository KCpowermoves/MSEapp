import "server-only";
import { createJob } from "@/lib/data/jobs";
import { createVisit } from "@/lib/data/schedule";
import { getLead, updateLead } from "@/lib/data/leads";
import { markProspectUsed } from "@/lib/data/prospects";
import { territoryForProgram } from "@/lib/programs";
import { notifyLeadSigned } from "@/lib/email/notify";
import { nowIso } from "@/lib/utils";
import type { Job, Lead } from "@/lib/types";

// Lead → Job conversion. Called by both the manual "Mark signed"
// action and the SignNow webhook. Idempotent: a lead that already has
// a jobId returns it untouched, so webhook retries and double-taps
// can't create duplicate jobs.

export async function convertLeadToJob(opts: {
  leadId: string;
  /** Who triggered it — an agent/admin name, or "customer-signature". */
  by: string;
}): Promise<{ lead: Lead; job: Job | null; created: boolean }> {
  const lead = await getLead(opts.leadId);
  if (!lead) throw new Error(`Lead not found: ${opts.leadId}`);

  if (lead.jobId) {
    return { lead, job: null, created: false };
  }

  const siteAddress = [lead.address, lead.city, lead.zip]
    .filter(Boolean)
    .join(", ");

  // Self-sold to the agent so the existing sales-bonus attribution
  // applies automatically when units are serviced.
  const job = await createJob({
    customerName: lead.businessName || lead.contactName,
    siteAddress,
    utilityTerritory: territoryForProgram(lead.utility),
    selfSold: true,
    soldBy: lead.agentName,
    createdBy: lead.agentName,
    notes:
      `From signed agreement (${lead.leadId}). Contact: ${lead.contactName}` +
      (lead.phone ? ` ${lead.phone}` : "") +
      (lead.email ? ` ${lead.email}` : "") +
      (lead.accountNumber ? `. Account #${lead.accountNumber}` : "") +
      (lead.notes ? `. ${lead.notes}` : ""),
    projectLead: lead.assignTech || undefined,
  });

  // At-sale assignment → a real scheduled visit on the calendar.
  if (lead.assignTech && lead.assignDate) {
    try {
      await createVisit({
        jobId: job.jobId,
        date: lead.assignDate,
        startTime: "09:00",
        durationMins: 120,
        techs: [lead.assignTech],
        notes: `Assigned at sale by ${lead.agentName}`,
        estUnits: Number(lead.hvacUnits) || 0,
        auditRequired: false,
        createdBy: opts.by,
      });
    } catch (e) {
      // Job exists either way — a failed visit write shouldn't undo the
      // conversion. Admin can schedule manually.
      console.warn("[lead-convert] visit create failed:", e);
    }
  }

  const signedAt = nowIso();
  await updateLead({
    leadId: lead.leadId,
    status: "Converted",
    signedAt,
    jobId: job.jobId,
  });

  // Retire the source prospect now that it's actually signed (not at
  // lead creation). Best-effort — never fail the conversion over this.
  if (lead.prospectId) {
    markProspectUsed(lead.prospectId, lead.leadId).catch((e) =>
      console.warn("[lead-convert] markProspectUsed failed:", e)
    );
  }

  // Notify the team a signed job just landed. Awaited because a
  // dangling promise here can be dropped when the serverless handler
  // returns; notify() never throws, so this can't fail the conversion.
  await notifyLeadSigned({ job, agentName: lead.agentName });

  return {
    lead: { ...lead, status: "Converted", signedAt, jobId: job.jobId },
    job,
    created: true,
  };
}
