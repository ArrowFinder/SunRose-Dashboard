import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const url = rawUrl?.trim();
const anon = rawAnon?.trim();

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anon && url.startsWith("http"));
}

let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  if (!client) {
    client = createClient<Database>(url!, anon!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
