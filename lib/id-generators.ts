import { TABS, getMaxIdNumber } from "@/lib/google/sheets";

function pad(n: number, width = 4): string {
  return n.toString().padStart(width, "0");
}

function currentYear(): number {
  return new Date().getFullYear();
}

export async function nextJobId(): Promise<string> {
  const year = currentYear();
  const prefix = `JOB-${year}-`;
  const max = await getMaxIdNumber(TABS.jobs, "A", prefix);
  return `${prefix}${pad(max + 1)}`;
}

export async function nextDispatchId(): Promise<string> {
  const year = currentYear();
  const prefix = `DSP-${year}-`;
  const max = await getMaxIdNumber(TABS.dispatches, "A", prefix);
  return `${prefix}${pad(max + 1)}`;
}

export async function nextUnitId(): Promise<string> {
  const year = currentYear();
  const prefix = `UNIT-${year}-`;
  const max = await getMaxIdNumber(TABS.unitsServiced, "A", prefix);
  return `${prefix}${pad(max + 1, 5)}`;
}

export async function nextServiceId(): Promise<string> {
  const year = currentYear();
  const prefix = `SVC-${year}-`;
  const max = await getMaxIdNumber(TABS.additionalServices, "A", prefix);
  return `${prefix}${pad(max + 1, 5)}`;
}
