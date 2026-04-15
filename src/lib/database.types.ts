/** Minimal Supabase-generated types; expand when schema grows. */
export type AppRole = "owner" | "admin" | "employee" | "client";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          role: AppRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          role?: AppRole;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          role?: AppRole;
          updated_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name?: string; created_at?: string };
        Update: Partial<{ name: string }>;
        Relationships: [];
      };
      client_members: {
        Row: {
          user_id: string;
          client_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          client_id: string;
          created_at?: string;
        };
        Update: Partial<{ client_id: string }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      app_role: AppRole;
    };
  };
}
