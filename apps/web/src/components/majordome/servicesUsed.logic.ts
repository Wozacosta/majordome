import type { RunId, ToolActivitySource } from "@t3tools/contracts";

import { workEntryIndicatesToolSuccess, type TimelineEntry } from "../../session-logic";

export type ServiceBrand = "gmail" | "google-calendar" | "google-drive";

const BRANDS: Readonly<Record<string, ServiceBrand>> = {
  gmail: "gmail",
  googlemail: "gmail",
  calendar: "google-calendar",
  googlecalendar: "google-calendar",
  gcal: "google-calendar",
  drive: "google-drive",
  googledrive: "google-drive",
  gdrive: "google-drive",
};

/** The service whose own logo Majordome draws, from a connector's name however it is spelled. */
export function serviceBrand(name: string): ServiceBrand | null {
  return BRANDS[name.toLowerCase().replace(/[^a-z]/g, "")] ?? null;
}

/**
 * The outside services each answer reached, in the order it first reached them. A service counts
 * once one of its steps worked, so an answer never shows a service that refused it.
 */
export function servicesUsedByRun(
  entries: ReadonlyArray<TimelineEntry>,
): ReadonlyMap<RunId, ReadonlyArray<ToolActivitySource>> {
  const byRun = new Map<RunId, Map<string, ToolActivitySource>>();
  for (const entry of entries) {
    if (entry.kind !== "work") continue;
    const { runId, toolSource } = entry.entry;
    if (runId == null || toolSource?.kind !== "integration") continue;
    if (!workEntryIndicatesToolSuccess(entry.entry)) continue;
    const services = byRun.get(runId) ?? new Map<string, ToolActivitySource>();
    if (!services.has(toolSource.key)) services.set(toolSource.key, toolSource);
    byRun.set(runId, services);
  }
  return new Map([...byRun].map(([runId, services]) => [runId, [...services.values()]]));
}

export function sameServices(
  a: ReadonlyArray<ToolActivitySource> | undefined,
  b: ReadonlyArray<ToolActivitySource> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  return a.every(
    (service, index) => service.key === b[index]!.key && service.name === b[index]!.name,
  );
}
