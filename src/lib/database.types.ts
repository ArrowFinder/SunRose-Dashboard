import type { SotConnection, SotSuggestion, SotNotification } from "./sot";
import type { WorkItem, TaskTemplate } from "./types";
export type AppRole = "owner" | "admin" | "supervisor" | "employee" | "client";
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
  archived_at: string | null;
  id: string;
  name: string;
  retainer_hours_per_month: number;
  billing_type: "hourly" | "retainer";
  hour_limit_enabled: boolean;
  hourly_rate: number | null;
  monthly_fee: number | null;
  overage_rate: number | null;
  share_token: string;
  color: string | null;
  created_at: string;
};
export type ProjectRow = {
 id:string; client_id:string; name:string; description:string; stage:import('./types').Project['stage']; is_default:boolean;
 billing_type:import('./types').Project['billingType']; hourly_rate:number|null; fee:number|null; hour_budget:number|null;
 start_date:string|null; due_date:string|null; created_at:string; updated_at:string;
};
export type WorkRow = {
  project_id:string;
  archived_at: string | null;
  parent_id: string | null;
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
    projectId?:string; projectName?:string;
    title: string;
    status: WorkItem["status"];
    dueDate: string | null;
    parentId: string | null;
    completedSubtasks: number;
    totalSubtasks: number;
  }[];
};
export interface Database {
  public: {
    Tables: {
      projects: Table<ProjectRow>;
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
      sot_client_profiles: Table<{client_id:string;description:string;services:string;context_notes:string;aliases:string[];domains:string[];location:string|null;business_type:string|null;website_url:string|null;website_sources:{url:string;title:string}[]}>;
      sot_client_contacts: Table<{email:string;client_id:string}>;
      sot_connections: Table<SotConnection>;
      sot_suggestions: Table<SotSuggestion>;
      sot_notifications: Table<SotNotification>;
    };
    Views: Record<string, never>;
    Functions: {
      sot_approve_project_and_task: { Args: {suggestion_id:string;expected_updated_at:string;edited_title:string;edited_description:string;selected_client:string;approved_project_name:string;edited_due:string|null;edited_estimate:number|null}; Returns:string };
      sot_edit_and_accept:{Args:{suggestion_id:string;expected_updated_at:string;edited_title:string;edited_description:string;selected_client:string|null;selected_project:string|null;selected_parent:string|null;edited_due:string|null;edited_estimate:number|null};Returns:string};
      support_user_snapshot: { Args: { target_id:string }; Returns: import('./support').SupportSnapshot };
      set_task_archived: { Args:{task_id:string;archived:boolean};Returns:undefined };
      set_client_archived: { Args:{client_id:string;archived:boolean};Returns:undefined };
      save_client_context: { Args: { cid:string; description_value:string;services_value:string;notes_value:string;aliases_value:string[];domains_value:string[];contacts_value:string[] }; Returns: undefined };
      sot_confirm_identity: { Args: { suggestion_id:string;selected_client:string|null;separate_business:boolean;confirm_relationship:boolean }; Returns: undefined };
      sot_confirm_website: { Args: { suggestion_id:string;use_website:boolean }; Returns: undefined };
      sot_accept: { Args: { suggestion_id: string }; Returns: string };
      sot_dismiss_with_reason: { Args: { suggestion_id: string; reason: string }; Returns: undefined };
      sot_recheck_pending: { Args: Record<string,never>; Returns: undefined };
      sot_set_auto_scan: { Args: { enabled: boolean }; Returns: undefined };
      sot_dismiss: { Args: { suggestion_id: string }; Returns: undefined };
      sot_mark_read: { Args: { notification_id: string }; Returns: undefined };
      update_my_name: { Args: { new_name: string }; Returns: undefined };
      correct_time_entry: { Args: { entry_id: string; corrected_minutes: number; expected_minutes: number; expected_task_minutes: number }; Returns: undefined };
      member_client_view: { Args: Record<string, never>; Returns: { client: { id: string; name: string; color: string | null; createdAt: string }; items: { projectId?:string; projectName?:string; id: string; clientId: string; title: string; status: WorkItem["status"]; dueDate: string | null; yearMonth: string; parentId: string | null; completedSubtasks: number; totalSubtasks: number }[] } | null };
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
