import { notFound } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { getLeadByToken } from "@/lib/data/leads";
import { packetLabel } from "@/lib/programs";
import { ClipboardSign } from "@/components/sign/ClipboardSign";

export const dynamic = "force-dynamic";

/**
 * Public clipboard-signing page — the customer sees the ACTUAL utility
 * program paperwork, filled in live as details are entered (or bill-
 * scanned), and signs once at the bottom. No login; the unguessable
 * token is the authorization. Signing creates the job instantly and
 * stores the completed packet PDF in Drive.
 */
export default async function SignAgreementPage({
  params,
}: {
  params: { token: string };
}) {
  const token = decodeURIComponent(params.token);
  const lead = await getLeadByToken(token);
  if (!lead || lead.status === "Cancelled") notFound();

  const alreadySigned = Boolean(lead.jobId) || lead.status === "Converted";

  return (
    <div className="min-h-screen bg-mse-light/30">
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-6 space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-mse-navy">
            <ShieldCheck className="w-6 h-6 text-mse-gold" />
            <span className="font-bold text-lg">Maryland Smart Energy</span>
          </div>
          <h1 className="text-2xl font-bold text-mse-navy tracking-tight mt-1">
            {packetLabel(lead.utility)}
          </h1>
          <p className="text-sm text-mse-muted mt-1">
            Program enrollment paperwork — review and sign below.
          </p>
        </div>

        {alreadySigned ? (
          <div className="bg-white rounded-2xl border-2 border-emerald-600/25 shadow-card p-6 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <div className="font-bold text-mse-navy text-lg">
              This paperwork is already signed.
            </div>
            <p className="text-sm text-mse-muted">
              Thanks{lead.contactName ? `, ${lead.contactName}` : ""}! Your
              enrollment is in — {lead.agentName || "your agent"} will be in
              touch to schedule the visit.
            </p>
          </div>
        ) : (
          <ClipboardSign token={token} lead={lead} />
        )}

        <p className="text-center text-[11px] text-mse-muted pb-6">
          Questions? Contact {lead.agentName || "your agent"} at Maryland
          Smart Energy — (301) 888-7090.
        </p>
      </div>
    </div>
  );
}
