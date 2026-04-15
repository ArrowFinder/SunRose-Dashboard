import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User as SupabaseUser } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "../lib/supabaseClient";
import type { AppRole } from "../lib/database.types";

export type SupabaseProfile = {
  id: string;
  display_name: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
};

type AuthState = {
  isConfigured: boolean;
  session: Session | null;
  user: SupabaseUser | null;
  profile: SupabaseProfile | null;
  clientMemberClientId: string | null;
  loading: boolean;
  error: string | null;
};

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfileAndClient(
  userId: string
): Promise<{ profile: SupabaseProfile | null; clientId: string | null }> {
  const supabase = getSupabase();
  const { data: profileRow, error: pErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (pErr || !profileRow) {
    return { profile: null, clientId: null };
  }

  const profile: SupabaseProfile = {
    id: profileRow.id,
    display_name: profileRow.display_name,
    role: profileRow.role as AppRole,
    created_at: profileRow.created_at,
    updated_at: profileRow.updated_at,
  };

  let clientId: string | null = null;
  if (profile.role === "client") {
    const { data: cm } = await supabase
      .from("client_members")
      .select("client_id")
      .eq("user_id", userId)
      .maybeSingle();
    clientId = cm?.client_id ?? null;
  }

  return { profile, clientId };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<SupabaseProfile | null>(null);
  const [clientMemberClientId, setClientMemberClientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  const loadSessionAndProfile = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabase();
      const { data: { session: s }, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) {
        setError(sessErr.message);
        setSession(null);
        setUser(null);
        setProfile(null);
        setClientMemberClientId(null);
        return;
      }
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const { profile: p, clientId } = await fetchProfileAndClient(s.user.id);
        setProfile(p);
        setClientMemberClientId(clientId);
      } else {
        setProfile(null);
        setClientMemberClientId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auth error");
      setProfile(null);
      setClientMemberClientId(null);
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let sub: { subscription: { unsubscribe: () => void } } | undefined;
    try {
      void loadSessionAndProfile();
      const supabase = getSupabase();
      const { data } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          try {
            const { profile: p, clientId } = await fetchProfileAndClient(newSession.user.id);
            setProfile(p);
            setClientMemberClientId(clientId);
          } catch {
            setProfile(null);
            setClientMemberClientId(null);
          }
        } else {
          setProfile(null);
          setClientMemberClientId(null);
        }
      });
      sub = data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Supabase auth");
      setLoading(false);
    }
    return () => {
      sub?.subscription.unsubscribe();
    };
  }, [configured, loadSessionAndProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!configured) return { error: "Supabase not configured" };
    const supabase = getSupabase();
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) return { error: err.message };
    await loadSessionAndProfile();
    return { error: null };
  }, [configured, loadSessionAndProfile]);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      if (!configured) return { error: "Supabase not configured" };
      const supabase = getSupabase();
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: displayName ? { display_name: displayName } : undefined,
        },
      });
      if (err) return { error: err.message };
      await loadSessionAndProfile();
      return { error: null };
    },
    [configured, loadSessionAndProfile]
  );

  const signOut = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setProfile(null);
    setClientMemberClientId(null);
  }, [configured]);

  const refreshProfile = useCallback(async () => {
    if (!configured || !user) return;
    const { profile: p, clientId } = await fetchProfileAndClient(user.id);
    setProfile(p);
    setClientMemberClientId(clientId);
  }, [configured, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: configured,
      session,
      user,
      profile,
      clientMemberClientId,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [
      configured,
      session,
      user,
      profile,
      clientMemberClientId,
      loading,
      error,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

/** Safe hook when AuthProvider might not wrap (tests); returns null if missing. */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext);
}
