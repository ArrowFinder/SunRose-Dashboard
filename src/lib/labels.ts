import type { ScopeCategory, WorkStatus } from "./types";

export const STATUS_LABELS: Record<WorkStatus, string> = {
  backlog: "Backlog",
  planned: "Planned this month",
  in_progress: "In progress",
  done: "Done",
};

export const SCOPE_LABELS: Record<ScopeCategory, string> = {
  in_scope: "In scope",
  needs_approval: "Needs approval",
  approved_overage: "Approved overage",
  out_of_scope: "Out of scope (separate)",
};

export const SOURCE_LABELS = { internal: "Internal", client: "Client" } as const;
