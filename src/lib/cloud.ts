import type { Client, WorkItem, TimeEntry, TaskTemplate, User } from "./types";
import type {
  ClientRow,
  WorkRow,
  TimeRow,
  TemplateRow,
  ProfileRow,
} from "./database.types";
export const clientFromRow = (r: ClientRow): Client => ({
  id: r.id,
  name: r.name,
  archivedAt:r.archived_at,
  retainerHoursPerMonth: Number(r.retainer_hours_per_month),
  billingType:r.billing_type, hourLimitEnabled:r.hour_limit_enabled,
  hourlyRate:r.hourly_rate==null?null:Number(r.hourly_rate), monthlyFee:r.monthly_fee==null?null:Number(r.monthly_fee), overageRate:r.overage_rate==null?null:Number(r.overage_rate),
  shareToken: r.share_token,
  color: r.color ?? undefined,
  createdAt: r.created_at,
});
export const workFromRow = (r: WorkRow): WorkItem => ({
  id: r.id,
  archivedAt:r.archived_at,
  parentId: r.parent_id,
  clientId: r.client_id,
  yearMonth: r.year_month,
  title: r.title,
  description: r.description,
  source: r.source,
  status: r.status,
  scopeCategory: r.scope_category,
  estimatedHours: Number(r.estimated_hours),
  actualHours: Number(r.actual_hours),
  priority: r.priority,
  dueDate: r.due_date,
  assignedUserId: r.assigned_user_id,
  templateId: r.template_id,
  clientVisible: r.client_visible,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
export const timeFromRow = (r: TimeRow): TimeEntry => ({
  voidedAt: r.voided_at,
  id: r.id,
  workItemId: r.work_item_id,
  userId: r.user_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMinutes: r.duration_minutes,
  note: r.note,
  billable: r.billable,
  createdAt: r.created_at,
});
export const templateFromRow = (r: TemplateRow): TaskTemplate => ({
  id: r.id,
  clientId: r.client_id,
  name: r.name,
  defaultTitle: r.default_title,
  defaultDescription: r.default_description,
  defaultEstimatedHours: Number(r.default_estimated_hours),
  defaultScopeCategory: r.default_scope_category,
  createdAt: r.created_at,
});
export const userFromRow = (r: ProfileRow): User => ({
  id: r.id,
  name: r.display_name || "User",
  role: r.role,
  active: r.active,
  createdAt: r.created_at,
});
// Whitelisted mappings prevent patches from changing identifiers or audit dates.
export function workPatch(w: Partial<WorkItem>): Partial<WorkRow> {
  const out: Partial<WorkRow> = {};
  const fields = {
    parentId: "parent_id",
    clientId: "client_id",
    yearMonth: "year_month",
    title: "title",
    description: "description",
    source: "source",
    status: "status",
    scopeCategory: "scope_category",
    estimatedHours: "estimated_hours",
    actualHours: "actual_hours",
    priority: "priority",
    dueDate: "due_date",
    assignedUserId: "assigned_user_id",
    templateId: "template_id",
    clientVisible: "client_visible",
  } as const;
  for (const [key, col] of Object.entries(fields))
    if (key in w)
      Object.assign(out, { [col]: w[key as keyof WorkItem] ?? null });
  return out;
}
export function templatePatch(t: Partial<TaskTemplate>): Partial<TemplateRow> {
  const out: Partial<TemplateRow> = {};
  const fields = {
    clientId: "client_id",
    name: "name",
    defaultTitle: "default_title",
    defaultDescription: "default_description",
    defaultEstimatedHours: "default_estimated_hours",
    defaultScopeCategory: "default_scope_category",
  } as const;
  for (const [key, col] of Object.entries(fields))
    if (key in t) Object.assign(out, { [col]: t[key as keyof TaskTemplate] });
  return out;
}
