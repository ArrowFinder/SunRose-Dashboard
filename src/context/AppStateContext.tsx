import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ActiveTimer,
  AppBundle,
  Client,
  TaskTemplate,
  TimeEntry,
  User,
  UserRole,
  WorkItem,
} from "../lib/types";
import {
  clearActiveTimer,
  clearAllActiveTimers,
  getActiveTimer,
  loadBundle,
  migrateFromLocalStorageIfNeeded,
  replaceAllBundle,
  setActiveTimer,
} from "../lib/db";
import { demoData } from "../lib/seed";
import { uid, shareToken } from "../lib/id";
import { colorForClientId } from "../lib/color";
import { hashPin, verifyPin } from "../lib/pin";
import { msToMinutesRounded, elapsedMs } from "../lib/timer";
import { parseImportFile } from "../lib/exchange";
import { useAuth } from "./AuthContext";
import { isSupabaseConfigured } from "../lib/supabaseClient";

const SESSION_KEY = "sunrose-session-user-id";

type Ctx = {
  ready: boolean;
  data: AppBundle;
  currentUser: User | null;
  sessionUserId: string | null;
  activeTimer: ActiveTimer | null;
  login: (userId: string, pin?: string) => Promise<boolean>;
  logout: () => void;
  refreshActiveTimer: () => Promise<void>;
  update: (next: AppBundle) => void;
  addClient: (name: string, retainerHoursPerMonth: number) => Client;
  updateClient: (
    id: string,
    patch: Partial<Pick<Client, "name" | "retainerHoursPerMonth" | "color">>
  ) => void;
  deleteClient: (id: string) => void;
  regenerateShareToken: (clientId: string) => string;
  addWorkItem: (item: Omit<WorkItem, "id" | "createdAt" | "updatedAt">) => WorkItem;
  updateWorkItem: (id: string, patch: Partial<WorkItem>) => void;
  deleteWorkItem: (id: string) => void;
  addUser: (name: string, role: UserRole, clientId?: string, pin?: string) => Promise<User>;
  updateUser: (id: string, patch: Partial<Pick<User, "name" | "role" | "clientId">>) => void;
  deleteUser: (id: string) => void;
  setUserPin: (userId: string, pin: string | null) => Promise<void>;
  addTemplate: (t: Omit<TaskTemplate, "id" | "createdAt">) => TaskTemplate;
  updateTemplate: (id: string, patch: Partial<TaskTemplate>) => void;
  deleteTemplate: (id: string) => void;
  addTimeEntryManual: (e: Omit<TimeEntry, "id" | "createdAt">) => TimeEntry;
  deleteTimeEntry: (id: string) => void;
  startTimer: (workItemId: string) => Promise<void>;
  stopTimer: () => Promise<void>;
  loadDemo: () => void;
  importData: (text: string) => void;
};

const AppStateContext = createContext<Ctx | null>(null);

function emptyBundle(): AppBundle {
  return { clients: [], workItems: [], users: [], timeEntries: [], taskTemplates: [] };
}

function ensureOwner(bundle: AppBundle): AppBundle {
  if (bundle.users.length > 0) return bundle;
  const owner: User = {
    id: crypto.randomUUID(),
    name: "Owner",
    role: "owner",
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(SESSION_KEY, owner.id);
  return { ...bundle, users: [owner] };
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const cloud = auth.isConfigured;

  const [bundleReady, setBundleReady] = useState(false);
  const [data, setData] = useState<AppBundle>(emptyBundle);
  const [sessionUserId, setSessionUserId] = useState<string | null>(() =>
    isSupabaseConfigured() ? null : localStorage.getItem(SESSION_KEY)
  );
  const [activeTimer, setActiveTimerState] = useState<ActiveTimer | null>(null);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ready = bundleReady && (!cloud || !auth.loading);

  const effectiveSessionUserId = cloud ? (auth.user?.id ?? null) : sessionUserId;

  useEffect(() => {
    let cancelled = false;
    const bootTimeout = window.setTimeout(() => {
      if (cancelled) return;
      // IndexedDB can stall on some browsers; unblock the UI so auth/login can show.
      setBundleReady(true);
    }, 20_000);
    (async () => {
      try {
        await migrateFromLocalStorageIfNeeded();
        let b = await loadBundle();
        if (!isSupabaseConfigured()) {
          b = ensureOwner(b);
        }
        if (cancelled) return;
        setData(b);
        if (!isSupabaseConfigured()) {
          let sid = localStorage.getItem(SESSION_KEY);
          if (sid && !b.users.some((u) => u.id === sid)) {
            localStorage.removeItem(SESSION_KEY);
            sid = null;
          }
          setSessionUserId(sid);
        } else {
          setSessionUserId(null);
        }
      } finally {
        window.clearTimeout(bootTimeout);
        if (!cancelled) setBundleReady(true);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(bootTimeout);
    };
  }, []);

  useEffect(() => {
    if (!bundleReady || !effectiveSessionUserId) {
      if (bundleReady && !effectiveSessionUserId) setActiveTimerState(null);
      return;
    }
    let cancelled = false;
    void getActiveTimer(effectiveSessionUserId).then((t) => {
      if (!cancelled) setActiveTimerState(t);
    });
    return () => {
      cancelled = true;
    };
  }, [bundleReady, effectiveSessionUserId]);

  useEffect(() => {
    if (!ready) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      void replaceAllBundle(data);
    }, 400);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [data, ready]);

  const currentUser = useMemo((): User | null => {
    if (cloud) {
      if (!auth.profile) return null;
      return {
        id: auth.profile.id,
        name: auth.profile.display_name?.trim() || "User",
        role: auth.profile.role as UserRole,
        clientId: auth.clientMemberClientId ?? undefined,
        createdAt: auth.profile.created_at,
      };
    }
    return sessionUserId ? data.users.find((u) => u.id === sessionUserId) ?? null : null;
  }, [cloud, auth.profile, auth.clientMemberClientId, sessionUserId, data.users]);

  const refreshActiveTimer = useCallback(async () => {
    if (!effectiveSessionUserId) {
      setActiveTimerState(null);
      return;
    }
    const t = await getActiveTimer(effectiveSessionUserId);
    setActiveTimerState(t);
  }, [effectiveSessionUserId]);

  const login = useCallback(
    async (userId: string, pin?: string): Promise<boolean> => {
      if (cloud) return false;
      const u = data.users.find((x) => x.id === userId);
      if (!u) return false;
      const ok = await verifyPin(pin ?? "", u.pinHash);
      if (!ok) return false;
      localStorage.setItem(SESSION_KEY, userId);
      setSessionUserId(userId);
      const t = await getActiveTimer(userId);
      setActiveTimerState(t);
      return true;
    },
    [cloud, data.users]
  );

  const logout = useCallback(() => {
    const uidForTimer = effectiveSessionUserId;
    if (uidForTimer && activeTimer) {
      const ms = elapsedMs(activeTimer.startedAt);
      const durationMinutes = msToMinutesRounded(ms);
      const endedAt = new Date().toISOString();
      const entry: TimeEntry = {
        id: uid(),
        workItemId: activeTimer.workItemId,
        userId: uidForTimer,
        startedAt: activeTimer.startedAt,
        endedAt,
        durationMinutes,
        note: "",
        billable: true,
        createdAt: new Date().toISOString(),
      };
      setData((d) => ({ ...d, timeEntries: [...d.timeEntries, entry] }));
    }
    if (uidForTimer) void clearActiveTimer(uidForTimer);
    if (cloud) {
      void auth.signOut();
    } else {
      localStorage.removeItem(SESSION_KEY);
      setSessionUserId(null);
    }
    setActiveTimerState(null);
  }, [cloud, auth, effectiveSessionUserId, activeTimer]);

  const update = useCallback((next: AppBundle) => {
    setData(next);
  }, []);

  const addClient = useCallback((name: string, retainerHoursPerMonth: number) => {
    const id = uid();
    const c: Client = {
      id,
      name: name.trim(),
      retainerHoursPerMonth,
      shareToken: shareToken(),
      createdAt: new Date().toISOString(),
      color: colorForClientId(id),
    };
    setData((d) => ({ ...d, clients: [...d.clients, c] }));
    return c;
  }, []);

  const updateClient = useCallback(
    (
      id: string,
      patch: Partial<Pick<Client, "name" | "retainerHoursPerMonth" | "color">>
    ) => {
      setData((d) => ({
        ...d,
        clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },
    []
  );

  const deleteClient = useCallback((id: string) => {
    setData((d) => {
      const removedWorkIds = d.workItems.filter((w) => w.clientId === id).map((w) => w.id);
      return {
        ...d,
        clients: d.clients.filter((c) => c.id !== id),
        workItems: d.workItems.filter((w) => w.clientId !== id),
        timeEntries: d.timeEntries.filter((e) => !removedWorkIds.includes(e.workItemId)),
        users: d.users.filter((u) => !(u.role === "client" && u.clientId === id)),
        taskTemplates: d.taskTemplates.filter((t) => t.clientId !== id),
      };
    });
  }, []);

  const regenerateShareToken = useCallback((clientId: string) => {
    const t = shareToken();
    setData((d) => ({
      ...d,
      clients: d.clients.map((c) => (c.id === clientId ? { ...c, shareToken: t } : c)),
    }));
    return t;
  }, []);

  const addWorkItem = useCallback((item: Omit<WorkItem, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    const w: WorkItem = {
      ...item,
      id: uid(),
      createdAt: now,
      updatedAt: now,
      dueDate: item.dueDate ?? null,
      assignedUserId: item.assignedUserId ?? null,
      templateId: item.templateId ?? null,
    };
    setData((d) => ({ ...d, workItems: [...d.workItems, w] }));
    return w;
  }, []);

  const updateWorkItem = useCallback((id: string, patch: Partial<WorkItem>) => {
    const now = new Date().toISOString();
    setData((d) => ({
      ...d,
      workItems: d.workItems.map((w) =>
        w.id === id ? { ...w, ...patch, updatedAt: now } : w
      ),
    }));
  }, []);

  const deleteWorkItem = useCallback((id: string) => {
    setData((d) => ({
      ...d,
      workItems: d.workItems.filter((w) => w.id !== id),
      timeEntries: d.timeEntries.filter((e) => e.workItemId !== id),
    }));
  }, []);

  const addUser = useCallback(
    async (name: string, role: UserRole, clientId?: string, pin?: string) => {
      const u: User = {
        id: uid(),
        name: name.trim(),
        role,
        clientId: role === "client" ? clientId : undefined,
        pinHash: pin ? await hashPin(pin) : undefined,
        createdAt: new Date().toISOString(),
      };
      setData((d) => ({ ...d, users: [...d.users, u] }));
      return u;
    },
    []
  );

  const updateUser = useCallback(
    (id: string, patch: Partial<Pick<User, "name" | "role" | "clientId">>) => {
      setData((d) => ({
        ...d,
        users: d.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
      }));
    },
    []
  );

  const deleteUser = useCallback((id: string) => {
    setData((d) => ({
      ...d,
      users: d.users.filter((u) => u.id !== id),
      workItems: d.workItems.map((w) =>
        w.assignedUserId === id ? { ...w, assignedUserId: null } : w
      ),
      timeEntries: d.timeEntries.filter((e) => e.userId !== id),
    }));
    const selfId = cloud ? auth.user?.id ?? null : sessionUserId;
    if (selfId === id) {
      if (!cloud) {
        localStorage.removeItem(SESSION_KEY);
        setSessionUserId(null);
      } else {
        void auth.signOut();
      }
      setActiveTimerState(null);
    }
  }, [sessionUserId, cloud, auth]);

  const setUserPin = useCallback(async (userId: string, pin: string | null) => {
    const pinHash = pin && pin.length > 0 ? await hashPin(pin) : undefined;
    setData((d) => ({
      ...d,
      users: d.users.map((u) => (u.id === userId ? { ...u, pinHash } : u)),
    }));
  }, []);

  const addTemplate = useCallback((t: Omit<TaskTemplate, "id" | "createdAt">) => {
    const row: TaskTemplate = {
      ...t,
      id: uid(),
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, taskTemplates: [...d.taskTemplates, row] }));
    return row;
  }, []);

  const updateTemplate = useCallback((id: string, patch: Partial<TaskTemplate>) => {
    setData((d) => ({
      ...d,
      taskTemplates: d.taskTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setData((d) => ({
      ...d,
      taskTemplates: d.taskTemplates.filter((t) => t.id !== id),
    }));
  }, []);

  const addTimeEntryManual = useCallback((e: Omit<TimeEntry, "id" | "createdAt">) => {
    const row: TimeEntry = {
      ...e,
      id: uid(),
      createdAt: new Date().toISOString(),
    };
    setData((d) => ({ ...d, timeEntries: [...d.timeEntries, row] }));
    return row;
  }, []);

  const deleteTimeEntry = useCallback((id: string) => {
    setData((d) => ({
      ...d,
      timeEntries: d.timeEntries.filter((e) => e.id !== id),
    }));
  }, []);

  const startTimer = useCallback(
    async (workItemId: string) => {
      if (!effectiveSessionUserId) return;
      const prev = await getActiveTimer(effectiveSessionUserId);
      if (prev?.workItemId) {
        const ms = elapsedMs(prev.startedAt);
        const durationMinutes = msToMinutesRounded(ms);
        const endedAt = new Date().toISOString();
        const entry: TimeEntry = {
          id: uid(),
          workItemId: prev.workItemId,
          userId: effectiveSessionUserId,
          startedAt: prev.startedAt,
          endedAt,
          durationMinutes,
          note: "",
          billable: true,
          createdAt: new Date().toISOString(),
        };
        setData((d) => ({ ...d, timeEntries: [...d.timeEntries, entry] }));
      }
      await clearActiveTimer(effectiveSessionUserId);
      const startedAt = new Date().toISOString();
      const timer: ActiveTimer = { userId: effectiveSessionUserId, workItemId, startedAt };
      await setActiveTimer(timer);
      setActiveTimerState(timer);
    },
    [effectiveSessionUserId]
  );

  const stopTimer = useCallback(async () => {
    if (!effectiveSessionUserId || !activeTimer) return;
    const { workItemId, startedAt } = activeTimer;
    const ms = elapsedMs(startedAt);
    const durationMinutes = msToMinutesRounded(ms);
    const endedAt = new Date().toISOString();
    const entry: TimeEntry = {
      id: uid(),
      workItemId,
      userId: effectiveSessionUserId,
      startedAt,
      endedAt,
      durationMinutes,
      note: "",
      billable: true,
      createdAt: new Date().toISOString(),
    };
    await clearActiveTimer(effectiveSessionUserId);
    setActiveTimerState(null);
    setData((d) => ({ ...d, timeEntries: [...d.timeEntries, entry] }));
  }, [effectiveSessionUserId, activeTimer]);

  const loadDemo = useCallback(() => {
    if (cloud) return;
    void clearAllActiveTimers();
    setActiveTimerState(null);
    const bundle = demoData();
    setData(bundle);
    const first = bundle.users[0];
    if (first) {
      localStorage.setItem(SESSION_KEY, first.id);
      setSessionUserId(first.id);
    }
  }, [cloud]);

  const importData = useCallback((text: string) => {
    let bundle = parseImportFile(text);
    if (!isSupabaseConfigured()) {
      bundle = ensureOwner(bundle);
    }
    void clearAllActiveTimers();
    setActiveTimerState(null);
    setData(bundle);
    if (!isSupabaseConfigured()) {
      const sid = localStorage.getItem(SESSION_KEY);
      if (sid && !bundle.users.some((u) => u.id === sid)) {
        localStorage.removeItem(SESSION_KEY);
        setSessionUserId(null);
      }
    }
  }, []);

  const value = useMemo(
    () => ({
      ready,
      data,
      currentUser,
      sessionUserId: effectiveSessionUserId,
      activeTimer,
      login,
      logout,
      refreshActiveTimer,
      update,
      addClient,
      updateClient,
      deleteClient,
      regenerateShareToken,
      addWorkItem,
      updateWorkItem,
      deleteWorkItem,
      addUser,
      updateUser,
      deleteUser,
      setUserPin,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      addTimeEntryManual,
      deleteTimeEntry,
      startTimer,
      stopTimer,
      loadDemo,
      importData,
    }),
    [
      ready,
      data,
      currentUser,
      effectiveSessionUserId,
      activeTimer,
      login,
      logout,
      refreshActiveTimer,
      update,
      addClient,
      updateClient,
      deleteClient,
      regenerateShareToken,
      addWorkItem,
      updateWorkItem,
      deleteWorkItem,
      addUser,
      updateUser,
      deleteUser,
      setUserPin,
      addTemplate,
      updateTemplate,
      deleteTemplate,
      addTimeEntryManual,
      deleteTimeEntry,
      startTimer,
      stopTimer,
      loadDemo,
      importData,
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): Ctx {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState outside provider");
  return ctx;
}
