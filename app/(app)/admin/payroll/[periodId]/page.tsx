import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { computePayrollReport } from "@/lib/payroll/compute";
import { listActiveTechNames } from "@/lib/data/techs";
import { listAllDispatches } from "@/lib/data/dispatches";
import { listAllUnits } from "@/lib/data/units";
import { formatCurrency } from "@/lib/utils";
import { PayrollDetailHeader } from "@/components/payroll/PayrollDetailHeader";
import { TechSection } from "@/components/payroll/TechSection";
import { UndoProviderShell } from "@/components/payroll/UndoProviderShell";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export default async function PayrollDetailPage({
  params,
}: {
  params: { periodId: string };
}) {
  const periodId = decodeURIComponent(params.periodId);
  const period = await getPayrollPeriod(periodId);
  if (!period) notFound();

  const [report, activeTechs, allDispatches, allUnits] = await Promise.all([
    computePayrollReport({
      periodId: period.periodId,
      startDate: period.startDate,
      endDate: period.endDate,
    }),
    listActiveTechNames(),
    listAllDispatches(),
    listAllUnits(),
  ]);

  // Plumb a list of dispatches in this period so the split-change
  // modal has a picker. Filter by date range AND by submittedAt
  // present (drafts can't be retroactively re-split).
  const periodDispatches = allDispatches
    .filter(
      (d) =>
        Boolean(d.submittedAt) &&
        d.dispatchDate >= period.startDate &&
        d.dispatchDate <= period.endDate
    )
    .map((d) => ({
      dispatchId: d.dispatchId,
      jobId: d.jobId,
      dispatchDate: d.dispatchDate,
      techsOnSite: d.techsOnSite,
      crewSplit: d.crewSplit,
    }));

  // Each dispatch's units — used by re-attribute modal's unit picker.
  const dispatchUnits: Record<
    string,
    { unitId: string; unitNumberOnJob: number; unitType: string }[]
  > = {};
  for (const u of allUnits) {
    if (!periodDispatches.find((d) => d.dispatchId === u.dispatchId)) continue;
    if (!dispatchUnits[u.dispatchId]) dispatchUnits[u.dispatchId] = [];
    dispatchUnits[u.dispatchId].push({
      unitId: u.unitId,
      unitNumberOnJob: u.unitNumberOnJob,
      unitType: u.unitType,
    });
  }

  const isDraft = period.status === "Draft";

  return (
    <div className="space-y-6">
      <Link
        href="/admin/payroll"
        className="inline-flex items-center gap-1.5 text-xs text-mse-muted hover:text-mse-navy"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All periods
      </Link>

      <PayrollDetailHeader
        periodId={period.periodId}
        startDate={period.startDate}
        endDate={period.endDate}
        status={period.status}
        label={period.label}
        note={period.note}
        approvedBy={period.approvedBy}
        approvedAt={period.approvedAt}
        paidBy={period.paidBy}
        paidAt={period.paidAt}
        createdBy={period.createdBy}
        createdAt={period.createdAt}
        grandTotal={report.grandTotal}
        techCount={report.techs.length}
        lineItemCount={
          report.attributionLineCount + report.adjustmentLineCount
        }
      />

      {!isDraft && (
        <div className="rounded-2xl border-2 border-mse-gold/40 bg-mse-gold/5 px-4 py-3 flex items-start gap-2 text-sm">
          <Lock className="w-4 h-4 text-mse-gold shrink-0 mt-0.5" />
          <div className="text-mse-navy">
            This invoice is{" "}
            <strong>
              {period.status === "Approved" ? "Approved" : period.status}
            </strong>{" "}
            — adjustments and
            re-attributions are locked. Use the{" "}
            <strong>Unlock to edit</strong> button up top to revert it to
            Draft.
          </div>
        </div>
      )}

      <UndoProviderShell>
      {report.techs.length === 0 ? (
        <section className="rounded-2xl border-2 border-dashed border-mse-light p-10 text-center">
          <div className="text-3xl font-bold text-mse-navy mb-1">
            {formatCurrency(0)}
          </div>
          <p className="text-sm text-mse-muted">
            No pay activity in this date range yet.
            {isDraft && (
              <>
                {" "}
                You can still add{" "}
                <strong>standalone line items</strong> below.
              </>
            )}
          </p>
          {isDraft && (
            <div className="mt-4 inline-flex">
              <TechSection
                periodId={period.periodId}
                periodStatus={period.status}
                techName=""
                tech={{
                  techName: "",
                  lineItems: [],
                  subtotals: {
                    service: 0,
                    salesPaid: 0,
                    salesPending: 0,
                    standalone: 0,
                    dailyStipend: 0,
                    travelBonus: 0,
                    adjustments: 0,
                    earned: 0,
                  },
                  grandTotal: 0,
                }}
                activeTechs={activeTechs}
                periodDispatches={periodDispatches}
                dispatchUnits={dispatchUnits}
                emptyMode
              />
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          {report.techs.map((tech) => (
            <TechSection
              key={tech.techName}
              periodId={period.periodId}
              periodStatus={period.status}
              techName={tech.techName}
              tech={tech}
              activeTechs={activeTechs}
              periodDispatches={periodDispatches}
              dispatchUnits={dispatchUnits}
            />
          ))}
        </div>
      )}
      </UndoProviderShell>

      <div className="text-[11px] text-mse-muted text-center pt-6 pb-8">
        Created by {period.createdBy || "—"} ·{" "}
        {period.createdAt
          ? new Date(period.createdAt).toLocaleString()
          : "—"}
      </div>
    </div>
  );
}
