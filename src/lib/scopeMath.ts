import type { Client, TimeEntry, WorkItem } from "./types";
import { effectiveActualHours } from "./hours";

const ACTIVE: WorkItem["status"][] = ["planned", "in_progress"];

export function itemsForMonth(items: WorkItem[], clientId: string, yearMonth: string): WorkItem[] {
  return items.filter((w) => w.clientId === clientId && w.yearMonth === yearMonth);
}

export function usedHoursForMonth(
  items: WorkItem[],
  clientId: string,
  yearMonth: string,
  entries: TimeEntry[]
): number {
  return itemsForMonth(items, clientId, yearMonth).reduce(
    (s, w) => s + effectiveActualHours(w, entries),
    0
  );
}

export function committedHoursForMonth(items: WorkItem[], clientId: string, yearMonth: string): number {
  return itemsForMonth(items, clientId, yearMonth)
    .filter((w) => ACTIVE.includes(w.status))
    .reduce((s, w) => s + (w.estimatedHours || 0), 0);
}

export function backlogHoursNeedingApproval(
  items: WorkItem[],
  clientId: string,
  yearMonth: string
): number {
  return itemsForMonth(items, clientId, yearMonth)
    .filter((w) => w.status === "backlog" && w.scopeCategory === "needs_approval")
    .reduce((s, w) => s + (w.estimatedHours || 0), 0);
}

export interface MonthSnapshot {
  retainer: number;
  used: number;
  committed: number;
  remainingAfterUsed: number;
  remainingAfterCommitted: number;
  overCommitted: boolean;
  pendingApprovalHours: number;
}

export function monthSnapshot(
  client: Client,
  items: WorkItem[],
  yearMonth: string,
  entries: TimeEntry[]
): MonthSnapshot {
  const retainer = client.retainerHoursPerMonth;
  const used = usedHoursForMonth(items, client.id, yearMonth, entries);
  const committed = committedHoursForMonth(items, client.id, yearMonth);
  const remainingAfterUsed = Math.max(0, retainer - used);
  const remainingAfterCommitted = retainer - used - committed;
  const pendingApprovalHours = backlogHoursNeedingApproval(items, client.id, yearMonth);
  return {
    retainer,
    used,
    committed,
    remainingAfterUsed,
    remainingAfterCommitted,
    overCommitted: remainingAfterCommitted < 0,
    pendingApprovalHours,
  };
}
