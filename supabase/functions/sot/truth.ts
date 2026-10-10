import type {Proposal} from './core.ts';
export const canonical=(s:string)=>s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function quoted(quote:unknown,text:string){return typeof quote==='string'&&quote.trim().length>=8&&text.toLowerCase().replace(/\s+/g,' ').includes(quote.trim().toLowerCase().replace(/\s+/g,' '));}
export function supportedProposal(p:Proposal,source:{subject:string;body:string}){
 // A model-supplied quotation must actually occur in the cited message body.
 if(!quoted(p.evidence,source.body))return false;
 if(/^(copyright|unsubscribe|all rights reserved|sent from)/i.test(p.evidence.trim()))return false;
 if(p.kind==='project')return p.work_state==='ongoing'&&!!p.client_id&&quoted(p.project_evidence,source.body);
 if(p.kind==='task'&&p.work_state!=='outstanding')return false;
 if(p.kind==='complete'&&p.work_state!=='completed')return false;
 if(p.kind==='update'&&p.work_state!=='changed')return false;
 // Don't turn an explicit sent/completed/cancelled statement into a fresh task.
 if(p.kind==='task'&&/\b(?:already (?:sent|completed|finished|done)|we (?:have )?sent|no (?:more|further) (?:emails|promotion)|cancel(?:led|ed))\b/i.test(p.evidence))return false;
 return true;
}
export type KnownWork={id?:string;kind?:string;title:string;client_id?:string|null;project_id?:string|null;new_project_name?:string|null;parent_id?:string|null;due_date?:string|null;status?:string;payload?:Record<string,any>};
export function duplicateWork(p:Proposal,known:KnownWork[]){
 if(p.kind!=='task'||!p.client_id)return null;
 const normalized=canonical(p.title), words=new Set(normalized.split(' '));
 for(const k of known){
  if(k.kind&&k.kind!=='task')continue;
  const v=k.payload||k;
  if(v.client_id!==p.client_id||(v.parent_id||null)!==(p.parent_id||null))continue;
  // Keep repeated events / dated deliverables separate. Unknown scope isn't proof of sameness.
  if((v.project_id||null)!==(p.project_id||null)||(v.new_project_name||null)!==(p.new_project_name||null)||(v.due_date||null)!==p.due_date)continue;
  const other=canonical(k.title);
  if(other===normalized)return {id:k.id,exact:true};
  const ow=new Set(other.split(' ')); const overlap=[...words].filter(w=>ow.has(w)).length;
  if(words.size>=5&&overlap/new Set([...words,...ow]).size>=0.8)return {id:k.id,exact:false};
 }
 return null;
}
export function proposalIdentity(p:Proposal){
 if(p.kind==='project')return ['project',p.client_id,canonical(p.title)].join(':');
 if(p.kind==='client')return 'client:'+canonical(p.client_name);
 return [p.kind,p.client_id||canonical(p.client_name),p.project_id||canonical(p.new_project_name||''),p.parent_id||'',canonical(p.title),p.due_date||'',p.task_id||''].join(':');
}
