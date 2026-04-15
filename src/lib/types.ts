export type WorkStatus = "backlog" | "planned" | "in_progress" | "done";

export type ScopeCategory =
  | "in_scope"
  | "needs_approval"
  | "approved_overage"
  | "out_of_scope";

export type WorkSource = "internal" | "client";

export type UserRole = "owner" | "admin" | "employee" | "client";

export interface Client {
  id: string;
  name: string;
  retainerHoursPerMonth: number;
  shareToken: string;
  createdAt: string;
  /** Calendar / UI color (hex) */
  color?: string;
}

export interface WorkItem {
  id: string;
  clientId: string;
  yearMonth: string;
  title: string;
  description: string;
  source: WorkSource;
  status: WorkStatus;
  scopeCategory: ScopeCategory;
  estimatedHours: number;
  /** Manual fallback when no time entries exist */
  actualHours: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
  /** YYYY-MM-DD for calendar */
  dueDate?: string | null;
  assignedUserId?: string | null;
  templateId?: string | null;
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  /** When role is client, links to Client.id */
  clientId?: string;
  /** SHA-256 hex of PIN; omit = no PIN required to select user */
  pinHash?: string;
  createdAt: string;
}

export interface TimeEntry {
  id: string;
  workItemId: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  note: string;
  billable: boolean;
  createdAt: string;
}

/** Reusable task blueprint — always scoped to one client */
export interface TaskTemplate {
  id: string;
  name: string;
  defaultTitle: string;
  defaultDescription: string;
  defaultEstimatedHours: number;
  defaultScopeCategory: ScopeCategory;
  clientId: string;
  createdAt: string;
}

/** In-memory + export shape */
export interface AppBundle {
  clients: Client[];
  workItems: WorkItem[];
  users: User[];
  timeEntries: TimeEntry[];
  taskTemplates: TaskTemplate[];
}

/** Legacy v1 localStorage */
export interface AppDataV1 {
  clients: Client[];
  workItems: WorkItem[];
}

export const STORAGE_KEY = "sunrose-dashboard-v1";

export const EXPORT_VERSION = 2 as const;

export interface AppExportFile {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  clients: Client[];
  workItems: WorkItem[];
  users: User[];
  timeEntries: TimeEntry[];
  taskTemplates: TaskTemplate[];
}

export interface ActiveTimer {
  userId: string;
  workItemId: string;
  startedAt: string;
}
