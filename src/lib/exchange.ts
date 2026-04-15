import type { AppBundle, AppExportFile, ScopeCategory, TaskTemplate } from "./types";

export function bundleToExport(bundle: AppBundle): AppExportFile {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    clients: bundle.clients,
    workItems: bundle.workItems,
    users: bundle.users,
    timeEntries: bundle.timeEntries,
    taskTemplates: bundle.taskTemplates,
  };
}

function normalizeImportedTemplate(raw: unknown): TaskTemplate | null {
  const r = raw as Record<string, unknown>;
  const clientId = (r.clientId ?? r.defaultClientId) as string | undefined;
  if (!clientId || typeof clientId !== "string") return null;
  const sc = r.defaultScopeCategory as ScopeCategory | undefined;
  return {
    id: String(r.id),
    name: String(r.name ?? "Template"),
    defaultTitle: String(r.defaultTitle ?? ""),
    defaultDescription: String(r.defaultDescription ?? ""),
    defaultEstimatedHours: typeof r.defaultEstimatedHours === "number" ? r.defaultEstimatedHours : 0,
    defaultScopeCategory:
      sc === "in_scope" ||
      sc === "needs_approval" ||
      sc === "approved_overage" ||
      sc === "out_of_scope"
        ? sc
        : "in_scope",
    clientId,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

export function parseImportFile(text: string): AppBundle {
  const data = JSON.parse(text) as Record<string, unknown>;

  if (data.version === 2 && Array.isArray(data.clients) && Array.isArray(data.workItems)) {
    const rawTemplates = Array.isArray(data.taskTemplates) ? data.taskTemplates : [];
    const taskTemplates = (rawTemplates as unknown[])
      .map(normalizeImportedTemplate)
      .filter((x): x is TaskTemplate => x !== null);
    return {
      clients: data.clients as AppBundle["clients"],
      workItems: data.workItems as AppBundle["workItems"],
      users: Array.isArray(data.users) ? (data.users as AppBundle["users"]) : [],
      timeEntries: Array.isArray(data.timeEntries) ? (data.timeEntries as AppBundle["timeEntries"]) : [],
      taskTemplates,
    };
  }

  if (Array.isArray(data.clients) && Array.isArray(data.workItems)) {
    return {
      clients: data.clients as AppBundle["clients"],
      workItems: data.workItems as AppBundle["workItems"],
      users: [],
      timeEntries: [],
      taskTemplates: [],
    };
  }

  throw new Error("Invalid backup file");
}
