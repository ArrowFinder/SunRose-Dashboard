import type { Client, User } from "./types";

export function clientsVisibleToUser(user: User | null, clients: Client[]): Client[] {
  if (!user) return [];
  if (user.role === "client") {
    if (!user.clientId) return [];
    return clients.filter((c) => c.id === user.clientId);
  }
  return clients;
}

export function userCanAccessClient(user: User | null, clientId: string): boolean {
  if (!user) return false;
  if (user.role === "client") return user.clientId === clientId;
  return true;
}

export function isInternalUser(user: User | null): boolean {
  const r = user?.role;
  return r === "owner" || r === "admin" || r === "employee";
}

export function isOwner(user: User | null): boolean {
  return user?.role === "owner";
}

/** Team / settings actions that only owner or Supabase admin should perform (until finer RLS UI). */
export function isOwnerOrAdmin(user: User | null): boolean {
  return user?.role === "owner" || user?.role === "admin";
}
