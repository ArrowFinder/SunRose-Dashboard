import { getSupabase } from './supabaseClient';
export type ClientChecklist = {business_name:boolean;contact_email:boolean;relationship_evidence:boolean;existing_clients_checked:boolean;identity_resolved:boolean;ready:boolean;explanation?:string;possible_matches?:string[]};
export type WebsiteCandidate = {url:string|null;explanation:string;sources:{url:string;title:string}[];query?:string};
export type SotPayload = {checklist?:ClientChecklist;aliases?:string[];location?:string|null;business_type?:string|null;relationship_evidence?:string;website_candidate?:WebsiteCandidate;website_confirmed?:boolean;client_name:string;contact_email:string;client_id:string|null;parent_id:string|null;task_id:string|null;due_date:string|null;estimated_hours:number|null;expected_updated_at?:string|null};
export type SotSuggestion = {id:string;user_id:string;kind:'client'|'task'|'update'|'complete';title:string;description:string;payload:SotPayload;source_thread:string;source_subject:string;evidence:string;status:'pending'|'accepted'|'dismissed';created_at:string;updated_at:string;result_id:string|null;dedupe_key:string};
export type SotConnection = {user_id:string;email:string;connected_at:string;last_scan_at:string|null;scan_cursor:string|null;scan_started_at:string|null;scanned_threads:number};
export type SotNotification = {id:string;recipient_id:string;task_id:string;message:string;created_at:string;read_at:string|null};
export async function sotAction(action:string,params:Record<string,unknown>={}):Promise<{configured?:boolean;url?:string;more?:boolean;created?:number}> {
 const {data,error}=await getSupabase().functions.invoke('sot',{body:{action,...params}});
 if(error) {
  let message='SOT is not available yet. The Google connection setup may still be pending.';
  try {const body=await error.context?.json();if(body?.error) message=body.error;} catch { /* No readable server response. */ }
  throw new Error(message);
 }
 if(data?.error) throw new Error(data.error);
 return data;
}
