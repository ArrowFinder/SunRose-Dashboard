import { currentYearMonth } from "./month";
import { shareToken, uid } from "./id";
import type { AppBundle, Client, TaskTemplate, TimeEntry, User, WorkItem } from "./types";
import { colorForClientId } from "./color";

export function demoData(): AppBundle {
  const ym = currentYearMonth();
  const ownerId = uid();
  const employeeId = uid();

  const owner: User = {
    id: ownerId,
    name: "Alex (owner)",
    role: "owner",
    createdAt: new Date().toISOString(),
  };
  const employee: User = {
    id: employeeId,
    name: "Jamie",
    role: "employee",
    createdAt: new Date().toISOString(),
  };

  const c1: Client = {
    id: uid(),
    name: "Acme Co.",
    retainerHoursPerMonth: 40,
    shareToken: shareToken(),
    createdAt: new Date().toISOString(),
    color: colorForClientId("demo-acme"),
  };
  const c2: Client = {
    id: uid(),
    name: "River Studio",
    retainerHoursPerMonth: 20,
    shareToken: shareToken(),
    createdAt: new Date().toISOString(),
    color: colorForClientId("demo-river"),
  };

  const now = () => new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const w1: WorkItem = {
    id: uid(),
    clientId: c1.id,
    yearMonth: ym,
    title: "Monthly analytics report",
    description: "",
    source: "internal",
    status: "in_progress",
    scopeCategory: "in_scope",
    estimatedHours: 6,
    actualHours: 0,
    priority: 1,
    createdAt: now(),
    updatedAt: now(),
    dueDate: today,
    assignedUserId: ownerId,
    templateId: null,
  };
  const w2: WorkItem = {
    id: uid(),
    clientId: c1.id,
    yearMonth: ym,
    title: "Landing page refresh — new hero",
    description: "Client asked Thursday",
    source: "client",
    status: "backlog",
    scopeCategory: "needs_approval",
    estimatedHours: 12,
    actualHours: 0,
    priority: 2,
    createdAt: now(),
    updatedAt: now(),
    dueDate: null,
    assignedUserId: null,
    templateId: null,
  };
  const w3: WorkItem = {
    id: uid(),
    clientId: c2.id,
    yearMonth: ym,
    title: "Social templates batch",
    source: "internal",
    status: "planned",
    scopeCategory: "in_scope",
    estimatedHours: 8,
    actualHours: 0,
    priority: 1,
    description: "",
    createdAt: now(),
    updatedAt: now(),
    dueDate: null,
    assignedUserId: employeeId,
    templateId: null,
  };

  const te1: TimeEntry = {
    id: uid(),
    workItemId: w1.id,
    userId: ownerId,
    startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    endedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    durationMinutes: 60,
    note: "",
    billable: true,
    createdAt: now(),
  };

  const tpl: TaskTemplate = {
    id: uid(),
    name: "Monthly email campaign",
    defaultTitle: "Email campaign — ",
    defaultDescription: "Copy, design, schedule, report",
    defaultEstimatedHours: 4,
    defaultScopeCategory: "in_scope",
    clientId: c1.id,
    createdAt: now(),
  };

  return {
    clients: [c1, c2],
    workItems: [w1, w2, w3],
    users: [owner, employee],
    timeEntries: [te1],
    taskTemplates: [tpl],
  };
}
