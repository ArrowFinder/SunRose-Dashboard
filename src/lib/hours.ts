import type { TimeEntry, WorkItem } from "./types";

export function minutesLoggedForWorkItem(workItemId: string, entries: TimeEntry[]): number {
  return entries
    .filter((e) => e.workItemId === workItemId)
    .reduce((s, e) => s + (e.durationMinutes || 0), 0);
}

export function hoursLoggedForWorkItem(workItemId: string, entries: TimeEntry[]): number {
  return minutesLoggedForWorkItem(workItemId, entries) / 60;
}

/** Billing / scope: timer totals win when present; else manual actualHours on the task */
export function effectiveActualHours(workItem: WorkItem, entries: TimeEntry[]): number {
  const logged = hoursLoggedForWorkItem(workItem.id, entries);
  if (logged > 0) return Math.round(logged * 100) / 100;
  return workItem.actualHours ?? 0;
}
