import Dexie, { type Table } from "dexie";
import type {
  ActiveTimer,
  AppBundle,
  Client,
  ScopeCategory,
  TaskTemplate,
  TimeEntry,
  User,
  WorkItem,
} from "./types";
import { STORAGE_KEY } from "./types";
import type { AppDataV1 } from "./types";
import { colorForClientId } from "./color";

const META_TIMER_PREFIX = "timer:";

export class SunroseDB extends Dexie {
  clients!: Table<Client, string>;
  workItems!: Table<WorkItem, string>;
  users!: Table<User, string>;
  timeEntries!: Table<TimeEntry, string>;
  taskTemplates!: Table<TaskTemplate, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("sunrose-db");
    this.version(1).stores({
      clients: "id",
      workItems: "id, clientId, yearMonth, dueDate",
      users: "id, role, clientId",
      timeEntries: "id, workItemId, userId",
      taskTemplates: "id",
      meta: "key",
    });
    this.version(2)
      .stores({
        clients: "id",
        workItems: "id, clientId, yearMonth, dueDate",
        users: "id, role, clientId",
        timeEntries: "id, workItemId, userId",
        taskTemplates: "id, clientId",
        meta: "key",
      })
      .upgrade(async (tx) => {
        const tbl = tx.table("taskTemplates");
        const rows = await tbl.toArray();
        await tbl.clear();
        for (const r of rows as Record<string, unknown>[]) {
          const cid = (r.clientId ?? r.defaultClientId) as string | undefined;
          if (!cid) continue;
          await tbl.put({
            id: r.id,
            name: r.name,
            defaultTitle: r.defaultTitle,
            defaultDescription: r.defaultDescription,
            defaultEstimatedHours: r.defaultEstimatedHours,
            defaultScopeCategory: r.defaultScopeCategory,
            clientId: cid,
            createdAt: r.createdAt,
          });
        }
      });
  }
}

export const db = new SunroseDB();

function normalizeClient(c: Client): Client {
  return {
    ...c,
    color: c.color && /^#[0-9A-Fa-f]{6}$/.test(c.color) ? c.color : colorForClientId(c.id),
  };
}

function normalizeWorkItem(w: WorkItem): WorkItem {
  return {
    ...w,
    dueDate: w.dueDate ?? null,
    assignedUserId: w.assignedUserId ?? null,
    templateId: w.templateId ?? null,
  };
}

/** Persist templates with legacy `defaultClientId` from in-memory bundles */
function normalizeTaskTemplateRow(
  t: TaskTemplate & { defaultClientId?: string | null }
): TaskTemplate {
  const clientId = t.clientId ?? t.defaultClientId ?? "";
  if (!clientId) throw new Error("Template missing clientId");
  return {
    id: t.id,
    name: t.name,
    defaultTitle: t.defaultTitle,
    defaultDescription: t.defaultDescription,
    defaultEstimatedHours: t.defaultEstimatedHours,
    defaultScopeCategory: t.defaultScopeCategory as ScopeCategory,
    clientId,
    createdAt: t.createdAt,
  };
}

export async function loadBundle(): Promise<AppBundle> {
  const [clients, workItems, users, timeEntries, taskTemplates] = await Promise.all([
    db.clients.toArray(),
    db.workItems.toArray(),
    db.users.toArray(),
    db.timeEntries.toArray(),
    db.taskTemplates.toArray(),
  ]);
  return { clients, workItems, users, timeEntries, taskTemplates };
}

export async function replaceAllBundle(bundle: AppBundle): Promise<void> {
  await db.transaction(
    "rw",
    [db.clients, db.workItems, db.users, db.timeEntries, db.taskTemplates],
    async () => {
      await db.clients.clear();
      await db.workItems.clear();
      await db.users.clear();
      await db.timeEntries.clear();
      await db.taskTemplates.clear();
      await db.clients.bulkPut(bundle.clients.map(normalizeClient));
      await db.workItems.bulkPut(bundle.workItems.map(normalizeWorkItem));
      await db.users.bulkPut(bundle.users);
      await db.timeEntries.bulkPut(bundle.timeEntries);
      await db.taskTemplates.bulkPut(bundle.taskTemplates.map(normalizeTaskTemplateRow));
    }
  );
}

/** First launch: migrate legacy localStorage v1 into IndexedDB */
export async function migrateFromLocalStorageIfNeeded(): Promise<void> {
  const hasRows =
    (await db.clients.count()) +
      (await db.workItems.count()) +
      (await db.users.count()) >
    0;
  if (hasRows) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const old = JSON.parse(raw) as AppDataV1;
    if (!Array.isArray(old.clients) || !Array.isArray(old.workItems)) return;

    const ownerId = crypto.randomUUID();
    const owner: User = {
      id: ownerId,
      name: "Owner",
      role: "owner",
      createdAt: new Date().toISOString(),
    };

    await db.transaction("rw", db.clients, db.workItems, db.users, async () => {
      for (const c of old.clients) {
        await db.clients.put(normalizeClient({ ...c, color: c.color ?? colorForClientId(c.id) }));
      }
      for (const w of old.workItems) {
        await db.workItems.put(
          normalizeWorkItem({
            ...(w as WorkItem),
            assignedUserId: w.assignedUserId ?? null,
            dueDate: w.dueDate ?? null,
            templateId: w.templateId ?? null,
          })
        );
      }
      await db.users.put(owner);
    });

    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem("sunrose-session-user-id", ownerId);
  } catch {
    // ignore bad legacy data
  }
}

export async function getActiveTimer(userId: string): Promise<ActiveTimer | null> {
  const row = await db.meta.get(META_TIMER_PREFIX + userId);
  if (!row || typeof row.value !== "object" || row.value === null) return null;
  const v = row.value as ActiveTimer;
  if (!v.workItemId || !v.startedAt) return null;
  return { userId, workItemId: v.workItemId, startedAt: v.startedAt };
}

export async function setActiveTimer(timer: ActiveTimer): Promise<void> {
  const key = META_TIMER_PREFIX + timer.userId;
  await db.meta.put({
    key,
    value: { workItemId: timer.workItemId, startedAt: timer.startedAt },
  });
}

export async function clearActiveTimer(userId: string): Promise<void> {
  await db.meta.delete(META_TIMER_PREFIX + userId);
}

export async function clearAllActiveTimers(): Promise<void> {
  const rows = await db.meta.toArray();
  for (const r of rows) {
    if (r.key.startsWith(META_TIMER_PREFIX)) await db.meta.delete(r.key);
  }
}
