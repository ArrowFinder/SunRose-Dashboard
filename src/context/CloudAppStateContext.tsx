import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppStateContext, type Ctx } from "./AppStateContext";
import { useAuth } from "./AuthContext";
import { getSupabase } from "../lib/supabaseClient";
import {
  clientFromRow,
  projectFromRow,
  workFromRow,
  userFromRow,
  templateFromRow,
  timeFromRow,
  workPatch,
  templatePatch,
} from "../lib/cloud";
import { colorForClientId } from "../lib/color";
import { shareToken, uid } from "../lib/id";
import type { ProfileRow } from "../lib/database.types";
import type { ActiveTimer, AppBundle, User } from "../lib/types";

const empty = (): AppBundle => ({
  clients: [],
  workItems: [],
  users: [],
  timeEntries: [],
  taskTemplates: [],
});
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "Could not reach the shared workspace.";
function required<T>(r: { data: T | null; error: unknown }): T {
  const value = checked(r);
  if (value === null)
    throw new Error("Record was not saved or access was denied.");
  return value;
}
function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}
// Supabase caps each response. Page explicitly rather than silently losing old work.
async function timed<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The connection timed out. Refresh before retrying a save.",
              ),
            ),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function pages<T>(
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 500) {
    const rows = checked(await timed(query(from, from + 499))) ?? [];
    all.push(...rows);
    if (rows.length < 500) return all;
  }
}
export function CloudAppStateProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const db = getSupabase();
  const [data, setData] = useState<AppBundle>(empty);
  const [activeTimer, setTimer] = useState<ActiveTimer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const generation = useRef(0);
  const lastRevision = useRef<number | null>(null);
  const account = useRef(auth.user?.id);
  account.current = auth.user?.id;

  const refresh = useCallback(async () => {
    const userId = auth.user?.id;
    const ticket = ++generation.current;
    if (!userId) {
      setData(empty());
      setTimer(null);
      setLoaded(true);
      return;
    }
    try {
      const revision = checked(await timed(db.rpc("workspace_revision", {})));
      if (revision !== null && revision === lastRevision.current) { setError(null); return; }
      if (revision === null) {
        const profile = required<ProfileRow>(await timed(db.from("profiles").select("*").eq("id", userId).single()));
        const view = checked(await timed(db.rpc("member_client_view", {})));
        if (ticket !== generation.current || account.current !== userId) return;
        const user = { ...userFromRow(profile), clientId: view?.client.id };
        setData({ ...empty(), users: [user],
          clients: view ? [{ ...view.client, color: view.client.color ?? undefined, shareToken: "", retainerHoursPerMonth: 0 }] : [],
          workItems: view ? view.items.map(w => ({ ...w, description: "", source: "internal", scopeCategory: "in_scope", estimatedHours: 0, actualHours: 0, priority: 0, createdAt: "", updatedAt: "" })) : [],
        });
        lastRevision.current = null; setTimer(null); setLoaded(true); setError(null); return;
      }
      const [clients, work, users, times, templates, timer, projects, memberships] =
        await Promise.all([
          pages((a, b) =>
            db.from("clients").select("*").order("id").range(a, b),
          ),
          pages((a, b) =>
            db.from("work_items").select("*").order("id").range(a, b),
          ),
          pages((a, b) =>
            db.from("profiles").select("*").order("id").range(a, b),
          ),
          pages((a, b) =>
            db.from("time_entries").select("*").order("id").range(a, b),
          ),
          pages((a, b) =>
            db.from("task_templates").select("*").order("id").range(a, b),
          ),
          timed(
            db
              .from("active_timers")
              .select("*")
              .eq("user_id", userId)
              .maybeSingle(),
          ),
          pages((a,b)=>db.from("projects").select("*").order("id").range(a,b)),
          pages((a, b) =>
            db.from("client_members").select("*").order("user_id").range(a, b),
          ),
        ]);
      const t = checked(timer);
      if (ticket !== generation.current || account.current !== userId) return;
      setData({
        clients: clients.map(clientFromRow),
        projects: projects.map(projectFromRow),
        workItems: work.map(workFromRow),
        users: users.map((r) => ({
          ...userFromRow(r),
          clientId: memberships.find((m) => m.user_id === r.id)?.client_id,
        })),
        timeEntries: times.map(t=>({...timeFromRow(t),clientId:projects.find(p=>p.id===t.project_id)?.client_id})),
        taskTemplates: templates.map(templateFromRow),
      });
      setTimer(
        t
          ? {
              userId: t.user_id,
              workItemId: t.work_item_id,
              projectId: t.project_id,
              startedAt: t.started_at,
            }
          : null,
      );
      lastRevision.current = revision;
      setLoaded(true);
      setError(null);
    } catch (e) {
      if (ticket === generation.current && account.current === userId)
        setError(message(e));
    }
  }, [auth.user?.id, db]);

  useEffect(() => {
    lastRevision.current = null;
    setData(empty());
    setTimer(null);
    setLoaded(false);
    setError(null);
    if (!auth.loading) void refresh();
    return () => {
      generation.current++;
    };
  }, [auth.user?.id, auth.loading, refresh]);
  useEffect(() => {
    const poll = () => {
      if (!writing.current && document.visibilityState === "visible")
        void refresh();
    };
    const interval = window.setInterval(poll, 30_000);
    window.addEventListener("focus", poll);
    window.addEventListener("online", poll);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", poll);
      window.removeEventListener("online", poll);
    };
  }, [refresh]);

  async function mutate<T>(action: () => Promise<T>): Promise<T> {
    if (writing.current) {
      setError("Another change is still saving. Please wait.");
      throw new Error("Another change is still saving. Please wait.");
    }
    if (!navigator.onLine) {
      setError("You are offline. Reconnect before saving.");
      throw new Error("You are offline. Your change has not been saved.");
    }
    writing.current = true;
    setSaving(true);
    generation.current++;
    setError(null);
    try {
      const result = await action();
      lastRevision.current = null;
      await refresh();
      return result;
    } catch (e) {
      setError(message(e));
      throw new Error(message(e));
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }
  const own = data.users.find((u) => u.id === auth.user?.id);
  const currentUser: User | null = own?.active !== false ? (own ?? null) : null;
  const unsupported = () => {
    throw new Error("This action is available only in offline mode.");
  };
  const value: Ctx = {
    correctTimeEntry: (entryId, minutes, expectedMinutes, expectedTotalMinutes) => mutate(async () => {
      checked(await db.rpc("correct_time_entry", { entry_id: entryId, corrected_minutes: minutes, expected_minutes: expectedMinutes, expected_task_minutes: expectedTotalMinutes }));
    }),
    cloud: true,
    ready: !auth.loading && (loaded || !!syncError),
    data,
    currentUser,
    sessionUserId: auth.user?.id ?? null,
    activeTimer,
    saving,
    syncError,
    refresh,
    login: async () => false,
    logout: async () => {
      if (writing.current)
        throw new Error("Wait for the current save before signing out.");
      await auth.signOut();
    },
    refreshActiveTimer: refresh,
    update: unsupported,
    importData: unsupported,
    loadDemo: unsupported,
    setUserPin: async () => unsupported(),
    addUser: async () => unsupported(),
    addClient: (name, hours) =>
      mutate(async () => {
        const id = uid();
        return clientFromRow(
          required(
            await db
              .from("clients")
              .insert({
                id,
                name: name.trim(),
                retainer_hours_per_month: hours,
                hour_limit_enabled: hours>0,
                share_token: shareToken(),
                color: colorForClientId(id),
              })
              .select()
              .single(),
          ),
        );
      }),
    updateClient: (id, p) =>
      mutate(async () => {
        checked(
          await db
            .from("clients")
            .update({
              ...(p.name !== undefined ? { name: p.name.trim() } : {}),
              ...(p.billingType !== undefined ? {billing_type:p.billingType}:{}),
              ...(p.hourLimitEnabled !== undefined ? {hour_limit_enabled:p.hourLimitEnabled}:{}),
              ...(p.hourlyRate !== undefined ? {hourly_rate:p.hourlyRate}:{}),
              ...(p.monthlyFee !== undefined ? {monthly_fee:p.monthlyFee}:{}),
              ...(p.overageRate !== undefined ? {overage_rate:p.overageRate}:{}),
              ...(p.retainerHoursPerMonth !== undefined
                ? { retainer_hours_per_month: p.retainerHoursPerMonth }
                : {}),
              ...("color" in p ? { color: p.color ?? null } : {}),
            })
            .eq("id", id)
            .select("id")
            .single(),
        );
      }),
    deleteClient: (id) =>
      mutate(async () => {
        checked(
          await db.from("clients").delete().eq("id", id).select("id").single(),
        );
      }),
    regenerateShareToken: (id) =>
      mutate(async () => {
        const token = shareToken();
        checked(
          await db
            .from("clients")
            .update({ share_token: token })
            .eq("id", id)
            .select("id")
            .single(),
        );
        return token;
      }),
    addWorkItem: (w) =>
      mutate(async () =>
        workFromRow(
          required(
            await db
              .from("work_items")
              .insert({ ...workPatch(w), id: uid() })
              .select()
              .single(),
          ),
        ),
      ),
    updateWorkItem: (id, p) =>
      mutate(async () => {
        checked(
          await db
            .from("work_items")
            .update(workPatch(p))
            .eq("id", id)
            .eq(
              "updated_at",
              p.updatedAt ??
                data.workItems.find((w) => w.id === id)?.updatedAt ??
                "",
            )
            .select("id")
            .single(),
        );
      }),
    deleteWorkItem: (id) =>
      mutate(async () => {
        checked(
          await db
            .from("work_items")
            .delete()
            .eq("id", id)
            .select("id")
            .single(),
        );
      }),
    updateUser: (id, p) =>
      mutate(async () => {
        const u = data.users.find((u) => u.id === id);
        if (!u) throw new Error("Member not found.");
        checked(
          await db.rpc("manage_member", {
            member_id: id,
            member_role: p.role ?? u.role,
            member_name: p.name ?? u.name,
            member_active: u.active !== false,
            member_client_id: p.clientId ?? u.clientId ?? null,
          }),
        );
      }),
    deleteUser: (id) =>
      mutate(async () => {
        const u = data.users.find((u) => u.id === id);
        if (!u) throw new Error("Member not found.");
        checked(
          await db.rpc("manage_member", {
            member_id: id,
            member_role: u.role,
            member_name: u.name,
            member_active: false,
            member_client_id: u.clientId ?? null,
          }),
        );
      }),
    addTemplate: (t) =>
      mutate(async () =>
        templateFromRow(
          required(
            await db
              .from("task_templates")
              .insert({ ...templatePatch(t), id: uid() })
              .select()
              .single(),
          ),
        ),
      ),
    updateTemplate: (id, p) =>
      mutate(async () => {
        checked(
          await db
            .from("task_templates")
            .update(templatePatch(p))
            .eq("id", id)
            .select("id")
            .single(),
        );
      }),
    deleteTemplate: (id) =>
      mutate(async () => {
        checked(
          await db
            .from("task_templates")
            .delete()
            .eq("id", id)
            .select("id")
            .single(),
        );
      }),
    addTimeEntryManual: (e) =>
      mutate(async () =>
        timeFromRow(
          required(
            await db
              .from("time_entries")
              .insert({
                id: uid(),
                work_item_id: e.workItemId,
                user_id: auth.user!.id,
                started_at: e.startedAt,
                ended_at: e.endedAt,
                duration_minutes: e.durationMinutes,
                note: e.note,
                billable: e.billable,
              })
              .select()
              .single(),
          ),
        ),
      ),
    deleteTimeEntry: (id) => {
      const reason = window.prompt(
        "Why should this time entry be voided? Its history will be retained.",
      );
      if (!reason?.trim()) return;
      return mutate(async () => {
        checked(
          await db.rpc("void_time_entry", {
            entry_id: id,
            reason: reason.trim(),
          }),
        );
      });
    },
    startTimer: (id) =>
      mutate(async () => {
        const t = required(
          await db.rpc("start_work_timer", { task_id: id, request_id: uid() }),
        );
        setTimer(
          t?.user_id
            ? {
                userId: t.user_id,
                workItemId: t.work_item_id,
              projectId: t.project_id,
                startedAt: t.started_at,
              }
            : null,
        );
      }),
    correctTimer: (end, reason) =>
      mutate(async () => {
        if (!activeTimer) return;
        checked(
          await db.rpc("correct_work_timer", {
            expected_task_id: activeTimer.workItemId,
            expected_started_at: activeTimer.startedAt,
            corrected_end: end,
            reason,
          }),
        );
        setTimer(null);
      }),
    stopTimer: () =>
      mutate(async () => {
        if (!activeTimer) return;
        checked(
          await db.rpc("stop_work_timer", {
            expected_task_id: activeTimer.workItemId,
            expected_started_at: activeTimer.startedAt,
          }),
        );
        setTimer(null);
      }),
  };
  // Fail closed on initial loading errors: never show an empty editable workspace.
  if (auth.user && !auth.loading && (!loaded || !currentUser))
    return (
      <div className="layout">
        <h1>SunRose</h1>
        <p role={syncError ? "alert" : "status"}>
          {syncError
            ? `Workspace unavailable: ${syncError}`
            : loaded
              ? "Your account needs access from the owner."
              : "Loading shared workspace…"}
        </p>
        <button className="btn" onClick={() => void refresh()}>
          Retry
        </button>{" "}
        <button className="btn" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    );
  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}
