import { getSupabase } from './supabaseClient';
export type ClientChecklist = {business_name:boolean;contact_email:boolean;relationship_evidence:boolean;existing_clients_checked:boolean;identity_resolved:boolean;ready:boolean;explanation?:string;possible_matches?:string[]};
export type WebsiteCandidate = {url:string|null;explanation:string;sources:{url:string;title:string}[];query?:string};
export type SotPayload = {uncertainty?:string;project_proposal_key?:string|null;supporting_sources?:{thread:string;subject:string;quote:string}[];new_project_name?:string|null;project_match?:string;project_evidence?:string;project_id?:string|null;analysis_version?:number;checklist?:ClientChecklist;aliases?:string[];location?:string|null;business_type?:string|null;relationship_evidence?:string;website_candidate?:WebsiteCandidate;website_confirmed?:boolean;client_name:string;contact_email:string;client_id:string|null;parent_id:string|null;task_id:string|null;due_date:string|null;estimated_hours:number|null;expected_updated_at?:string|null};
export type SotSuggestion = {id:string;user_id:string;kind:'client'|'project'|'task'|'update'|'complete';title:string;description:string;payload:SotPayload;source_thread:string;source_subject:string;evidence:string;status:'pending'|'accepted'|'dismissed';created_at:string;updated_at:string;result_id:string|null;dedupe_key:string};
export type SotBudget={available:number;daily_used:number;daily_limit:number;rolling_used:number;rolling_limit:number;monthly_used:number;monthly_limit:number;next_check:string;daily_reset:string};
export type SotReport={fetch_retries?:number;manually_resolved_messages?:number;waiting:number;needs_review:number;oldest:string|null;reviewed_messages:number;input_tokens:number;output_tokens:number;estimated_usd:number;unpriced_calls:number;review_items:{thread_id:string;reason:string;oldest_at:string}[]};
export type SotConnection = {scan_report?:SotReport|null;collected_through?:string|null;last_attempt_at?:string|null;last_completed_at?:string|null;scan_status?:string;section_progress?:string|null;deferred_threads?:number;user_id:string;email:string;connected_at:string;last_scan_at:string|null;scan_cursor:string|null;scan_started_at:string|null;scanned_threads:number;next_scan_at:string;last_error:string|null;auto_scan:boolean};
export type SotNotification = {id:string;recipient_id:string;task_id:string;message:string;created_at:string;read_at:string|null};
export async function sotAction(action:string,params:Record<string,unknown>={}):Promise<{budget?:SotBudget;report?:SotReport;waiting?:number;configured?:boolean;url?:string;more?:boolean;created?:number;deferred?:number}> {
 const {data,error}=await getSupabase().functions.invoke('sot',{body:{action,...params}});
 if(error) {
  let message='SOT could not complete this request. Your saved progress is retained; refresh to check its status.';
  try {const body=await error.context?.json();if(body?.error) message=body.error;} catch { /* No readable server response. */ }
  throw new Error(message);
 }
 if(data?.error) throw new Error(data.error);
 return data;
}
