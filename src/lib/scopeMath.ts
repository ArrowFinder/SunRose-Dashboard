import type { Client, TimeEntry, WorkItem } from "./types";
import { effectiveActualHours } from "./hours";

const ACTIVE: WorkItem["status"][] = ["planned", "in_progress"];

export function itemsForMonth(items: WorkItem[], clientId: string, yearMonth: string): WorkItem[] {
  return items.filter((w) => w.clientId === clientId && w.yearMonth === yearMonth);
}

export function entryHoursInMonth(entry: TimeEntry, yearMonth: string): number {
  const [year, month] = yearMonth.split("-").map(Number);
  const start = Date.parse(entry.startedAt), end = Date.parse(entry.endedAt);
  const left = Date.UTC(year, month - 1, 1), right = Date.UTC(year, month, 1);
  if (entry.voidedAt || !Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) return start >= left && start < right ? entry.durationMinutes / 60 : 0;
  const overlap = Math.max(0, Math.min(end, right) - Math.max(start, left));
  return entry.durationMinutes / 60 * overlap / (end - start);
}

export function usedHoursForMonth(
  items: WorkItem[],
  clientId: string,
  yearMonth: string,
  entries: TimeEntry[]
): number {
  const clientItems = items.filter(w => w.clientId === clientId);
  const ids = new Set(clientItems.map(w => w.id));
  const logged = entries.filter(e => ids.has(e.workItemId) && e.billable && !e.voidedAt)
    .reduce((sum,e) => sum + entryHoursInMonth(e, yearMonth), 0);
  // Legacy manual totals remain only for tasks without any recorded entries.
  const fallback = clientItems.filter(w => w.yearMonth === yearMonth && !entries.some(e => e.workItemId === w.id))
    .reduce((sum,w) => sum + (w.actualHours || 0), 0);
  return logged + fallback;
}

export function committedHoursForMonth(items: WorkItem[], clientId: string, yearMonth: string, entries: TimeEntry[] = []): number {
  return itemsForMonth(items, clientId, yearMonth)
    .filter((w) => ACTIVE.includes(w.status))
    .reduce((s, w) => s + Math.max(0, (w.estimatedHours || 0) - effectiveActualHours(w, entries)), 0);
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
  const committed = committedHoursForMonth(items, client.id, yearMonth, entries);
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
