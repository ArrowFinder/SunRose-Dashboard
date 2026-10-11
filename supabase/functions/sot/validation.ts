import {supportedProposal,quoted,duplicateWork,proposalIdentity,canonical} from './truth.ts';
import {resolveProject} from './projects.ts';
import {clientChecklist} from './identity.ts';
import {addresses,validProposal,type Proposal} from './core.ts';
async function hash(s:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function validateBatchThread(proposals:Proposal[],selected:any[],context:any,relationship:any,clients:any[],tasks:any[],pending:any[]){
 const contacts=addresses(selected.map(m=>m.from+" "+m.to+" "+m.cc).join(" "));const matched=relationship.matched;
   const rows:any[]=[];
   for(const p of proposals) {
    if(p.kind!=='client'&&matched) {p.client_id=matched.id;p.client_name=matched.name;}
    if(!validProposal(p,selected.map((m:any)=>m.id),contacts,relationship.candidates.filter((c:any)=>!c.archived_at).map((c:any)=>c.id))) continue;
    if(p.kind==='client' && (p.relationship_type!=='client'||!relationship.allowNewClient)) continue;
    if(p.kind!=='client'&&matched) {p.client_id=matched.id;p.client_name=matched.name;}
    if(!['client','project'].includes(p.kind) && p.responsibility!=='sunrose') continue;
    if(p.kind==='client') {p.parent_id=null;p.task_id=null;p.due_date=null;p.estimated_hours=null;}
    if(p.client_id && relationship.candidates.length && !relationship.candidates.some((x:any)=>x.id===p.client_id))continue;
    if(p.client_id && !clients.some((x:any)=>x.id===p.client_id&&!x.archived_at)) continue;
    const target=p.task_id?tasks.find((t:any)=>t.id===p.task_id):null;
    if(['update','complete'].includes(p.kind) && (!target || target.archived_at || target.client_id!==p.client_id || tasks.some((t:any)=>t.parent_id===target.id))) continue;
    if(p.parent_id && !tasks.some((t:any)=>t.id===p.parent_id&&!t.parent_id&&t.client_id===p.client_id)) continue;
    const source=selected.find((m:any)=>m.id===p.source_message_id);
    if(!source||!supportedProposal(p,source))continue;
    if(p.due_date&&!quoted(p.due_evidence,source.body))p.due_date=null;
    if(p.estimated_hours!==null&&!quoted(p.estimate_evidence,source.body))p.estimated_hours=null;
    if(p.kind==='project'){p.parent_id=null;p.task_id=null;p.due_date=null;p.estimated_hours=null;p.new_project_name=p.title;p.project_id=null;if(p.title.length>160)continue;}


    const checklist=clientChecklist(p,clients,source.body);
    if(p.kind==='client'&&!checklist.ready) continue;
    if(p.kind!=='client'&&matched) {checklist.identity_resolved=true;checklist.matched_client_id=matched.id;}
    if(p.kind!=='client'&&relationship.candidates.length>1) {checklist.ready=false;checklist.identity_resolved=false;checklist.possible_matches=relationship.candidates.map((c:any)=>c.id);checklist.explanation='Multiple existing clients appear in this conversation. Confirm which client owns this work.';}
    if(!p.client_id && checklist.matched_client_id && checklist.identity_resolved) p.client_id=checklist.matched_client_id;
    if(p.kind==='client'&&checklist.matched_client_id&&checklist.identity_resolved) continue;
    const project=resolveProject(p,context.projects,tasks,source.body);
    if(p.kind==='project'&&(!p.client_id||!checklist.identity_resolved||project.project_match!=='new'))continue;
    Object.assign(p,project);
    const duplicate=duplicateWork(p,[...tasks,...pending,...rows]);
    if(duplicate?.exact)continue;
    const key=p.kind==='project'?proposalIdentity(p):await hash(proposalIdentity(p));
    const projectKey=p.new_project_name&&p.client_id?'project:'+p.client_id+':'+canonical(p.new_project_name):null;
    rows.push({kind:p.kind,dedupe_key:key,title:p.title,description:p.description,payload:{...p,project_proposal_key:projectKey,possible_duplicate_id:duplicate?.id||null,uncertainty:[p.uncertainty,duplicate?'Possible duplicate: compare the existing work before adding.':''].filter(Boolean).join(' '),analysis_version:4,checklist,expected_updated_at:target?.updated_at||null},source_subject:source.subject,evidence:p.evidence});
   }

 return rows;
}
