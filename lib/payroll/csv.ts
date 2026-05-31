import type { PayrollReport } from "@/lib/payroll/compute";

// CSV escape: wrap in double quotes when needed, double-up internal "s.
function esc(value: string | number): string {
  const s = String(value ?? "");
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(values: (string | number)[]): string {
  return values.map(esc).join(",");
}

export function buildPayrollCsv(opts: {
  report: PayrollReport;
  techNameFilter?: string;
}): string {
  const { report, techNameFilter } = opts;
  const techs = techNameFilter
    ? report.techs.filter((t) => t.techName === techNameFilter)
    : report.techs;

  const lines: string[] = [];

  // Header rows — meta first so the CSV is self-describing when
  // opened cold in Excel/QBO. The header for the data table sits
  // on its own row below the meta block.
  lines.push(row(["Maryland Smart Energy — Commission Report"]));
  lines.push(
    row(["Period", `${report.startDate} to ${report.endDate}`])
  );
  if (report.period) {
    lines.push(row(["Period ID", report.period.periodId]));
    lines.push(row(["Status", report.period.status]));
    if (report.period.label) lines.push(row(["Label", report.period.label]));
    if (report.period.approvedBy)
      lines.push(
        row([
          "Approved",
          `${report.period.approvedBy} on ${report.period.approvedAt}`,
        ])
      );
    if (report.period.paidBy)
      lines.push(
        row(["Paid", `${report.period.paidBy} on ${report.period.paidAt}`])
      );
  }
  lines.push(row(["Grand Total", report.grandTotal.toFixed(2)]));
  lines.push(row(["Generated", report.generatedAt]));
  lines.push(""); // blank separator

  // Data table header
  lines.push(
    row([
      "Date",
      "Tech",
      "Source",
      "Type",
      "Customer",
      "Job ID",
      "Dispatch ID",
      "Unit ID",
      "Description",
      "Amount",
      "Adjustment ID",
      "Adjustment Type",
      "Counterparty",
      "Note",
    ])
  );

  for (const tech of techs) {
    for (const item of tech.lineItems) {
      lines.push(
        row([
          item.date,
          tech.techName,
          item.source,
          item.lineType,
          item.customerName,
          item.jobId,
          item.dispatchId,
          item.unitId,
          item.description,
          item.amount.toFixed(2),
          item.adjustmentId,
          item.adjustmentType,
          item.relatedTech,
          item.note,
        ])
      );
    }
    // Subtotal row per tech for human-readability
    lines.push(
      row([
        "",
        tech.techName,
        "subtotal",
        "",
        "",
        "",
        "",
        "",
        "Tech total",
        tech.grandTotal.toFixed(2),
        "",
        "",
        "",
        "",
      ])
    );
  }

  // Grand total
  lines.push(
    row([
      "",
      "",
      "total",
      "",
      "",
      "",
      "",
      "",
      "GRAND TOTAL",
      report.grandTotal.toFixed(2),
      "",
      "",
      "",
      "",
    ])
  );

  return lines.join("\r\n");
}
