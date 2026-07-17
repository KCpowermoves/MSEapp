import { notFound } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { getLeadByToken } from "@/lib/data/leads";
import { agreementParagraphs } from "@/lib/agreement-text";
import { UTILITY_PROGRAM_LABELS } from "@/lib/programs";
import { SignAgreementClient } from "@/components/sign/SignAgreementClient";

export const dynamic = "force-dynamic";

/**
 * Public agreement-signing page — the customer reaches it from a text
 * or email link, or signs on the agent's phone at the table. No login;
 * the unguessable token IS the authorization. Native replacement for
 * the old SignNow share links: signing here creates the job instantly.
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

  const details: Array<[string, string]> = [
    ["Business", lead.businessName || "—"],
    ["Contact", lead.contactName || "—"],
    [
      "Service address",
      [lead.address, lead.city, lead.zip].filter(Boolean).join(", ") || "—",
    ],
    ["Utility program", UTILITY_PROGRAM_LABELS[lead.utility] ?? lead.utility],
    ["Utility account #", lead.accountNumber || "—"],
    ["Approx. HVAC units", lead.hvacUnits || "—"],
    ["Your agent", lead.agentName || "—"],
  ];

  return (
    <div className="min-h-screen bg-mse-light/30">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-5">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-mse-navy">
            <ShieldCheck className="w-6 h-6 text-mse-gold" />
            <span className="font-bold text-lg">Maryland Smart Energy</span>
          </div>
          <h1 className="text-2xl font-bold text-mse-navy tracking-tight mt-2">
            HVAC Tune-Up Program Agreement
          </h1>
          <p className="text-sm text-mse-muted mt-1">
            No-cost tune-up enrollment for your business.
          </p>
        </div>

        {alreadySigned ? (
          <div className="bg-white rounded-2xl border-2 border-emerald-600/25 shadow-card p-6 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <div className="font-bold text-mse-navy text-lg">
              This agreement is already signed.
            </div>
            <p className="text-sm text-mse-muted">
              Thanks{lead.contactName ? `, ${lead.contactName}` : ""}! Your
              enrollment is in — {lead.agentName || "your agent"} will be in
              touch to schedule the visit.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5">
              <h2 className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted mb-3">
                Enrollment details
              </h2>
              <dl className="space-y-2">
                {details.map(([k, v]) => (
                  <div key={k} className="flex gap-3 text-sm">
                    <dt className="w-36 shrink-0 text-mse-muted">{k}</dt>
                    <dd className="font-semibold text-mse-navy">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="bg-white rounded-2xl border border-mse-light shadow-card p-5 space-y-3">
              <h2 className="text-[11px] uppercase tracking-wider font-semibold text-mse-muted">
                Authorization
              </h2>
              {agreementParagraphs(lead).map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-mse-navy">
                  {p}
                </p>
              ))}
            </div>

            <SignAgreementClient
              token={token}
              defaultName={lead.contactName}
            />
          </>
        )}

        <p className="text-center text-[11px] text-mse-muted pb-6">
          Questions? Contact {lead.agentName || "your agent"} at Maryland
          Smart Energy.
        </p>
      </div>
    </div>
  );
}
