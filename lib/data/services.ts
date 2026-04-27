import "server-only";
import {
  TABS,
  appendRow,
  findRowIndex,
  readTab,
  updateCell,
} from "@/lib/google/sheets";
import { nextServiceId } from "@/lib/id-generators";
import { bumpLastActivity } from "@/lib/data/jobs";
import { nowIso } from "@/lib/utils";
import type { AdditionalService, ServiceType } from "@/lib/types";

function rowToService(row: string[]): AdditionalService {
  return {
    serviceId: String(row[0] ?? ""),
    dispatchId: String(row[1] ?? ""),
    jobId: String(row[2] ?? ""),
    serviceType: (row[3] as ServiceType) || "Thermostat (regular)",
    quantity: Number(row[4] ?? 1),
    photoUrls: String(row[5] ?? ""),
    notes: String(row[6] ?? ""),
    loggedBy: String(row[7] ?? ""),
    loggedAt: String(row[8] ?? ""),
  };
}

export async function listAllServices(): Promise<AdditionalService[]> {
  const rows = await readTab(TABS.additionalServices);
  return rows.filter((r) => r[0]).map(rowToService);
}

export async function listServicesForDispatch(
  dispatchId: string
): Promise<AdditionalService[]> {
  const all = await listAllServices();
  return all.filter((s) => s.dispatchId === dispatchId);
}

export async function createService(opts: {
  dispatchId: string;
  jobId: string;
  serviceType: ServiceType;
  quantity: number;
  notes: string;
  loggedBy: string;
}): Promise<AdditionalService> {
  const serviceId = await nextServiceId();
  const isoNow = nowIso();
  await appendRow(TABS.additionalServices, [
    serviceId,
    opts.dispatchId,
    opts.jobId,
    opts.serviceType,
    opts.quantity,
    "",
    opts.notes,
    opts.loggedBy,
    isoNow,
  ]);
  await bumpLastActivity(opts.jobId);
  return {
    serviceId,
    dispatchId: opts.dispatchId,
    jobId: opts.jobId,
    serviceType: opts.serviceType,
    quantity: opts.quantity,
    photoUrls: "",
    notes: opts.notes,
    loggedBy: opts.loggedBy,
    loggedAt: isoNow,
  };
}

export async function appendServicePhotoUrl(
  serviceId: string,
  url: string
): Promise<void> {
  const rowIndex = await findRowIndex(
    TABS.additionalServices,
    "A",
    serviceId
  );
  if (!rowIndex) throw new Error(`Service not found: ${serviceId}`);
  const rows = await readTab(TABS.additionalServices);
  const offset = rowIndex - 2;
  const existing = String(rows[offset]?.[5] ?? "");
  const next = existing ? `${existing}, ${url}` : url;
  await updateCell(`${TABS.additionalServices}!F${rowIndex}`, next);
}
