import type { WorkItem, TimeEntry } from './types';
import { effectiveActualHours } from './hours';

export function subtasksFor(task: WorkItem, items: WorkItem[]) {
  return items.filter(w => w.parentId === task.id && w.clientId === task.clientId);
}
export function taskSummary(task: WorkItem, items: WorkItem[], entries: TimeEntry[]) {
  const allChildren = subtasksFor(task, items);
  const children = allChildren.filter(w=>!w.archivedAt);
  const total = task.totalSubtasks ?? children.length;
  const done = task.completedSubtasks ?? children.filter(w => w.status === 'done').length;
  const status = total === 0 ? task.status : done === total ? 'done' : done > 0 || children.some(w => w.status === 'in_progress') ? 'in_progress' : children.some(w => w.status === 'planned') ? 'planned' : task.totalSubtasks != null ? task.status : 'backlog';
  return { total, done, status, estimated: allChildren.length ? children.reduce((n,w) => n + w.estimatedHours,0) : task.estimatedHours,
    actual: effectiveActualHours(task,entries) + allChildren.reduce((n,w) => n + effectiveActualHours(w,entries),0) };
}
/** Include a parent when a child is scheduled this month, even across month boundaries. */
export function taskRootsForMonth(items: WorkItem[], clientId: string, month: string) {
  return items.filter(w => w.clientId === clientId && !w.parentId &&
    (w.yearMonth === month || items.some(child => child.parentId === w.id && child.yearMonth === month)))
    .sort((a,b) => a.priority-b.priority || a.title.localeCompare(b.title));
}
