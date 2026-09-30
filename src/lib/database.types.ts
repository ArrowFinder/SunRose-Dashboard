import type { WorkItem, TaskTemplate } from "./types";
export type AppRole = "owner" | "admin" | "employee" | "client";
type Table<T> = {
  Row: T;
  Insert: Partial<T>;
  Update: Partial<T>;
  Relationships: [];
};
export type ProfileRow = {
  id: string;
  display_name: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};
export type ClientRow = {
  id: string;
  name: string;
  retainer_hours_per_month: number;
  share_token: string;
  color: string | null;
  created_at: string;
};
export type WorkRow = {
  id: string;
  client_id: string;
  year_month: string;
  title: string;
  description: string;
  source: WorkItem["source"];
  status: WorkItem["status"];
  scope_category: WorkItem["scopeCategory"];
  estimated_hours: number;
  actual_hours: number;
  priority: number;
  due_date: string | null;
  assigned_user_id: string | null;
  template_id: string | null;
  client_visible: boolean;
  created_at: string;
  updated_at: string;
};
export type TimeRow = {
  id: string;
  work_item_id: string;
  user_id: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  note: string;
  billable: boolean;
  created_at: string;
  voided_at: string | null;
};
export type TemplateRow = {
  id: string;
  client_id: string;
  name: string;
  default_title: string;
  default_description: string;
  default_estimated_hours: number;
  default_scope_category: TaskTemplate["defaultScopeCategory"];
  created_at: string;
};
export type TimerRow = {
  user_id: string;
  work_item_id: string;
  started_at: string;
};
export type SharedView = {
  client: { name: string };
  items: {
    id: string;
    title: string;
    status: WorkItem["status"];
    dueDate: string | null;
  }[];
};
export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      clients: Table<ClientRow>;
      client_members: Table<{
        user_id: string;
        client_id: string;
        created_at: string;
      }>;
      work_items: Table<WorkRow>;
      time_entries: Table<TimeRow>;
      task_templates: Table<TemplateRow>;
      active_timers: Table<TimerRow>;
    };
    Views: Record<string, never>;
    Functions: {
      correct_time_entry: { Args: { entry_id: string; corrected_minutes: number; expected_minutes: number; expected_task_minutes: number }; Returns: undefined };
      member_client_view: { Args: Record<string, never>; Returns: { client: { id: string; name: string; color: string | null; createdAt: string }; items: { id: string; clientId: string; title: string; status: WorkItem["status"]; dueDate: string | null; yearMonth: string }[] } | null };
      workspace_revision: { Args: Record<string, never>; Returns: number | null };
      start_work_timer: {
        Args: { task_id: string; request_id: string };
        Returns: TimerRow;
      };
      stop_work_timer: {
        Args: { expected_task_id: string; expected_started_at: string };
        Returns: undefined;
      };
      correct_work_timer: {
        Args: {
          expected_task_id: string;
          expected_started_at: string;
          corrected_end: string;
          reason: string;
        };
        Returns: undefined;
      };
      manage_member: {
        Args: {
          member_id: string;
          member_role: AppRole;
          member_name: string;
          member_active: boolean;
          member_client_id: string | null;
        };
        Returns: undefined;
      };
      void_time_entry: {
        Args: { entry_id: string; reason: string };
        Returns: undefined;
      };
      shared_client_view: {
        Args: { token: string; month: string };
        Returns: SharedView;
      };
      submit_client_request: {
        Args: {
          token: string;
          request_id: string;
          request_title: string;
          request_description: string;
        };
        Returns: undefined;
      };
    };
    Enums: { app_role: AppRole };
  };
}
