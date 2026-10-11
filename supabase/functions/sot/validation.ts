import {supportedProposal,quoted,duplicateWork,proposalIdentity,canonical,suggestionCaution} from './truth.ts';
import {resolveProject} from './projects.ts';
import {clientChecklist} from './identity.ts';
import {addresses,validProposal,type Proposal} from './core.ts';
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function validateBatchThread(proposals:Proposal[],selected:any[],context:any,relationship:any,clients:any[],tasks:any[],pending:any[],diagnostics:string[]=[]){
 const contacts=addresses(selected.map(m=>m.from+" "+m.to+" "+m.cc).join(" "));const matched=relationship.matched;
   const rows:any[]=[];
   for(const p of proposals) {
    if(p.kind!=='client'&&matched) {p.client_id=matched.id;p.client_name=matched.name;}
    if(!validProposal(p,selected.map((m:any)=>m.id),contacts,relationship.candidates.filter((c:any)=>!c.archived_at).map((c:any)=>c.id))) {diagnostics.push('invalid_fields_or_contact:'+JSON.stringify({contactPresent:contacts.includes(p.contact_email?.toLowerCase()),titleLength:p.title?.length,descriptionLength:p.description?.length,evidenceLength:p.evidence?.length,clientNamePresent:!!p.client_name?.trim(),sourcePresent:selected.some(m=>m.id===p.source_message_id),dueDateValid:p.due_date===null||(/^\d{4}-\d{2}-\d{2}$/.test(p.due_date)&&Number.isFinite(Date.parse(p.due_date))),estimateValid:p.estimated_hours===null||(typeof p.estimated_hours==='number'&&p.estimated_hours>=0&&p.estimated_hours<=1000)}));continue;}
    if(p.kind==='client' && (p.relationship_type!=='client'||!relationship.allowNewClient)) {diagnostics.push('not_new_client');continue;}
    if(p.kind!=='client'&&matched) {p.client_id=matched.id;p.client_name=matched.name;}
    if(!['client','project'].includes(p.kind) && p.responsibility!=='sunrose') {diagnostics.push('not_sunrose_responsibility');continue;}
    if(p.kind==='client') {p.parent_id=null;p.task_id=null;p.due_date=null;p.estimated_hours=null;}
    if(p.client_id && relationship.candidates.length && !relationship.candidates.some((x:any)=>x.id===p.client_id)){diagnostics.push('client_outside_context');continue;}
    if(p.client_id && !clients.some((x:any)=>x.id===p.client_id&&!x.archived_at)) {diagnostics.push('unknown_or_archived_client');continue;}
    const target=p.task_id?tasks.find((t:any)=>t.id===p.task_id):null;
    if(['update','complete'].includes(p.kind) && (!target || target.archived_at || target.client_id!==p.client_id || tasks.some((t:any)=>t.parent_id===target.id))) {diagnostics.push('invalid_update_target');continue;}
    if(p.parent_id && !tasks.some((t:any)=>t.id===p.parent_id&&!t.parent_id&&t.client_id===p.client_id)) {diagnostics.push('invalid_parent');continue;}
    const source=selected.find((m:any)=>m.id===p.source_message_id);
    if(!source||!supportedProposal(p,source)){diagnostics.push('unsupported_evidence_or_state:'+JSON.stringify({kind:p.kind,state:p.work_state,evidenceMatches:!!source&&quoted(p.evidence,source.body),projectEvidenceMatches:!!source&&quoted(p.project_evidence,source.body)}));continue;}
    if(p.due_date&&!selected.some(m=>quoted(p.due_evidence,m.body)))p.due_date=null;
    if(p.estimated_hours!==null&&!selected.some(m=>quoted(p.estimate_evidence,m.body)))p.estimated_hours=null;
    if(p.kind==='project'){p.parent_id=null;p.task_id=null;p.due_date=null;p.estimated_hours=null;p.new_project_name=p.title;p.project_id=null;if(p.title.length>160){diagnostics.push('project_name_too_long');continue;}}


    const checklist=clientChecklist(p,clients,source.body);
    if(p.kind==='client'&&!checklist.ready) {diagnostics.push('client_checklist_incomplete');continue;}
    if(p.kind!=='client'&&matched) {checklist.identity_resolved=true;checklist.matched_client_id=matched.id;}
    if(p.kind!=='client'&&relationship.candidates.length>1) {checklist.ready=false;checklist.identity_resolved=false;checklist.possible_matches=relationship.candidates.map((c:any)=>c.id);checklist.explanation='Multiple existing clients appear in this conversation. Confirm which client owns this work.';}
    if(!p.client_id && checklist.matched_client_id && checklist.identity_resolved) p.client_id=checklist.matched_client_id;
    if(p.kind==='client'&&checklist.matched_client_id&&checklist.identity_resolved) {diagnostics.push('client_already_exists');continue;}
    const projectSource=selected.find(m=>quoted(p.project_evidence,m.body));
    const project=resolveProject(p,context.projects,tasks,projectSource?.body||source.body);
    if(p.kind==='project'&&(!p.client_id||!checklist.identity_resolved||project.project_match!=='new')){diagnostics.push('project_not_supported');continue;}
    Object.assign(p,project);
    const duplicate=duplicateWork(p,[...tasks,...pending,...rows]);
    if(duplicate?.exact){diagnostics.push('duplicate_work');continue;}
    const key=p.kind==='project'?proposalIdentity(p):await hash(proposalIdentity(p));
    const projectKey=p.new_project_name&&p.client_id?'project:'+p.client_id+':'+canonical(p.new_project_name):null;
    rows.push({kind:p.kind,dedupe_key:key,title:p.title,description:p.description,payload:{...p,project_proposal_key:projectKey,possible_duplicate_id:duplicate?.id||null,uncertainty:[p.uncertainty,suggestionCaution(p),duplicate?'Possible duplicate: compare the existing work before adding.':''].filter(Boolean).join(' '),analysis_version:4,checklist,expected_updated_at:target?.updated_at||null},source_subject:source.subject,evidence:p.evidence});
   }

 return rows;
}
