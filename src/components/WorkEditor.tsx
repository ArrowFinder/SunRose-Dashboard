import {useState} from 'react';
import {useAppState} from '../context/AppStateContext';
import {getSupabase} from '../lib/supabaseClient';
import {isOwnerOrAdmin,isInternalUser} from '../lib/permissions';
import {isAssignedProject} from '../lib/projectAssignment';
import {currentYearMonth} from '../lib/month';
import {taskSummary} from '../lib/taskTree';
import type {Project,WorkItem} from '../lib/types';
import type {SotSuggestion} from '../lib/sot';
import {AddTeammate,type CreatedTeammate} from './AddTeammate';
export type EditorKind='client'|'project'|'task'|'subtask'|'update'|'complete';
type Props={onClose:()=>void;onSaved?:()=>void|Promise<void>;suggestion?:SotSuggestion;task?:WorkItem|null;project?:Project|null;clientId?:string;projectId?:string;parentTask?:WorkItem|null;kind?:EditorKind;yearMonth?:string;onTaskSave?:(item:Omit<WorkItem,'id'|'createdAt'|'updatedAt'>,opts?:{saveAsTemplate?:boolean;templateName?:string})=>void|Promise<void>;allowTemplate?:boolean};
const message=(e:unknown)=>e&&typeof e==='object'&&'message'in e?String(e.message):'Could not save. Please retry.';
export function WorkEditor(props:Props){
 const {suggestion:s,task:w,project:p,parentTask,onClose}=props;
 const {data,currentUser,supportSnapshot,refresh,addWorkItem,updateWorkItem}=useAppState();
 const linked=s?.payload.task_id?data.workItems.find(t=>t.id===s.payload.task_id):undefined;
 const manage=isOwnerOrAdmin(currentUser)&&!supportSnapshot;
 const [kind,setKind]=useState<EditorKind>(s?(s.kind==='task'&&s.payload.parent_id?'subtask':s.kind):p?'project':w?.parentId||parentTask?'subtask':props.kind||'task');
 const [title,setTitle]=useState(s?(s.kind==='client'?s.payload.client_name:s.title):w?.title||p?.name||'');
 const [description,setDescription]=useState(s?.description||w?.description||p?.description||'');
 const [client,setClient]=useState(s?.payload.client_id||w?.clientId||p?.clientId||props.clientId||'');
 const initialProject=data.workItems.find(t=>t.id===s?.payload.parent_id)?.projectId||s?.payload.project_id||linked?.projectId||w?.projectId||parentTask?.projectId||props.projectId;
 const [project,setProject]=useState(isAssignedProject(data.projects?.find(x=>x.id===initialProject))?initialProject!:'');
 const [parent,setParent]=useState(s?.payload.parent_id||linked?.parentId||w?.parentId||parentTask?.id||'');
 const [assignee,setAssignee]=useState(linked?.assignedUserId||s?.user_id||w?.assignedUserId||currentUser?.id||'');
 const [due,setDue]=useState(s?.payload.due_date||w?.dueDate||p?.dueDate||'');
 const [estimate,setEstimate]=useState(String(s?.payload.estimated_hours??w?.estimatedHours??0));
 const [month,setMonth]=useState(w?.yearMonth||parentTask?.yearMonth||props.yearMonth||currentYearMonth());
 const [status,setStatus]=useState(linked?.status||w?.status||'backlog'),[visible,setVisible]=useState(w?.clientVisible||false);
 const [stage,setStage]=useState(p?.stage||'planned'),[billing,setBilling]=useState(p?.billingType||'inherit');
 const [rate,setRate]=useState(p?.hourlyRate?.toString()||''),[fee,setFee]=useState(p?.fee?.toString()||''),[budget,setBudget]=useState(p?.hourBudget?.toString()||''),[start,setStart]=useState(p?.startDate||'');
 const [template,setTemplate]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [inline,setInline]=useState<'client'|'project'|'task'|'teammate'|null>(null),[name,setName]=useState(''),[scope,setScope]=useState('');
 const [extras,setExtras]=useState<{clients:{id:string;name:string}[];projects:{id:string;name:string;clientId:string}[];tasks:WorkItem[];members:CreatedTeammate[]}>({clients:[],projects:[],tasks:[],members:[]});
 const merge=<T extends {id:string}>(a:T[],b:T[])=>[...new Map([...a,...b].map(x=>[x.id,x])).values()];
 const clients=merge(data.clients.filter(c=>!c.archivedAt).map(c=>({id:c.id,name:c.name})),extras.clients);
 const projects=merge((data.projects||[]).filter(x=>x.clientId===client&&isAssignedProject(x)).map(x=>({id:x.id,name:x.name,clientId:x.clientId})),extras.projects.filter(x=>x.clientId===client));
 const tasks=merge(data.workItems,extras.tasks).filter(t=>t.clientId===client&&t.projectId===project&&!t.parentId&&!t.archivedAt&&t.id!==w?.id);
 const members=merge(data.users.filter(u=>u.active!==false&&isInternalUser(u)).map(u=>({id:u.id,name:u.name})),extras.members);
 const isTask=['task','subtask','update','complete'].includes(kind);
 const hasChildren=!!w&&data.workItems.some(t=>t.parentId===w.id);
 const num=(v:string)=>v===''?null:Number(v);
 function openInline(k:typeof inline){setInline(k);setName(k==='project'?s?.payload.new_project_name||'':'');setScope('');setError('');}
 async function createInline(){if(busy||!name.trim())return;setBusy(true);setError('');try{
  if(inline==='task'){
   const item=await addWorkItem({clientId:client,projectId:project,parentId:null,title:name.trim(),description:scope,assignedUserId:assignee||null,dueDate:null,yearMonth:month,estimatedHours:0,actualHours:0,priority:10,source:'internal',status:'backlog',scopeCategory:'in_scope',clientVisible:false});
   setExtras(x=>({...x,tasks:[...x.tasks,item]}));setParent(item.id);setKind('subtask');
  }else{
   const r=inline==='client'?await getSupabase().rpc('review_create_client',{client_name:name.trim(),client_context:scope}):await getSupabase().rpc('review_create_project',{selected_client:client,project_name:name.trim(),project_scope:scope});if(r.error)throw r.error;
   if(inline==='client'){setExtras(x=>({...x,clients:[...x.clients,{id:r.data,name:name.trim()}]}));setClient(r.data);setProject('');setParent('');}
   else {setExtras(x=>({...x,projects:[...x.projects,{id:r.data,name:name.trim(),clientId:client}]}));setProject(r.data);setParent('');}
  }
  setNotice(`${inline==='task'?'Parent task':inline==='project'?'Project':'Client'} saved and selected. Your edits are preserved.`);setInline(null);await refresh?.();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 async function save(e:React.FormEvent){e.preventDefault();if(busy||inline||supportSnapshot)return;setBusy(true);setError('');try{
  if(!title.trim())throw new Error('Enter a title.');
  if(isTask&&!['update','complete'].includes(kind)&&(!project||(kind==='subtask'&&!parent)))throw new Error('Choose a project and, for a subtask, a parent task.');
  if(s){
   const r=await getSupabase().rpc('sot_editor_submit',{suggestion_id:s.id,expected_updated_at:s.updated_at,editor_kind:kind,fields:{title:title.trim(),description,client_id:client||null,project_id:project||null,parent_id:['subtask','update','complete'].includes(kind)?parent||null:null,assigned_user_id:assignee||null,due_date:due||null,estimated_hours:num(estimate),year_month:month,status,client_visible:visible,stage,billing_type:billing,hourly_rate:num(rate),fee:num(fee),hour_budget:num(budget),start_date:start||null}});if(r.error)throw r.error;
  }else if(kind==='project'){
   const patch={client_id:client,name:title.trim(),description,stage,billing_type:billing,hourly_rate:num(rate),fee:num(fee),hour_budget:num(budget),start_date:start||null,due_date:due||null};
   const r=p?await getSupabase().from('projects').update(patch).eq('id',p.id).eq('updated_at',p.updatedAt).select('id').single():await getSupabase().from('projects').insert(patch).select('id').single();if(r.error)throw r.error;
  }else if(kind==='client'){
   const r=await getSupabase().rpc('review_create_client',{client_name:title.trim(),client_context:description});if(r.error)throw r.error;
  }else{
   const item:Omit<WorkItem,'id'|'createdAt'|'updatedAt'>={clientId:client,projectId:project,parentId:kind==='subtask'?parent:null,title:title.trim(),description,yearMonth:month,dueDate:due||null,assignedUserId:assignee||null,estimatedHours:Number(estimate||0),actualHours:w?.actualHours||0,status,clientVisible:visible,source:w?.source||'internal',scopeCategory:w?.scopeCategory||'in_scope',priority:w?.priority??10,templateId:w?.templateId||null};
   if(props.onTaskSave)await props.onTaskSave(item,template?{saveAsTemplate:true,templateName:title.trim()}:undefined);
   else if(w)await updateWorkItem(w.id,{...item,updatedAt:w.updatedAt});else await addWorkItem(item);
  }
  await refresh?.();await props.onSaved?.();onClose();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 async function dismiss(){if(!s||busy||inline||supportSnapshot||!confirm('Delete this suggestion? Records created in this editor will remain.'))return;setBusy(true);setError('');try{const r=await getSupabase().rpc('sot_dismiss',{suggestion_id:s.id});if(r.error)throw r.error;await props.onSaved?.();onClose();}catch(e){setError(message(e));}finally{setBusy(false);}}
 const choices:EditorKind[]=p?['project']:w?['task','subtask']:['client','project','task','subtask',...(s&&['update','complete'].includes(s.kind)?[s.kind]:[])];
 const label=(k:EditorKind)=>({client:'Client',project:'Project',task:'Task',subtask:'Subtask',update:'Update existing task',complete:'Complete existing task'}[k]);
 return <div className="modal-backdrop"><section className="modal card sot-edit-modal" role="dialog" aria-modal="true" aria-label={s?'Edit before adding':'Work editor'}>
 <h2>{s?'Edit before adding':w||p?'Edit work':'Add action'}</h2>
 <form className="stack" onSubmit={save}><fieldset className="project-fields" disabled={busy||!!inline||!!supportSnapshot}>
 <label>Category<select className="input" value={kind} onChange={e=>setKind(e.target.value as EditorKind)}>{choices.map(k=><option key={k} value={k} disabled={(k==='client'||k==='project')&&!manage||k==='subtask'&&hasChildren}>{label(k)}</option>)}</select></label>
 {hasChildren&&<small>A task with subtasks stays a main task. Move its subtasks first to change its category.</small>}
 {(w||p)&&<small>Existing records keep their client and history. Tasks can become subtasks or move between projects within this client.</small>}
 <label>{kind==='client'?'Business name':'Title'}<input autoFocus className="input" required maxLength={kind==='project'?160:200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>Description / scope<textarea className="input" maxLength={10000} rows={4} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 {kind!=='client'&&<div className="stack"><label>Client<select className="input" required value={client} disabled={!!w||!!p||kind==='update'||kind==='complete'} onChange={e=>{setClient(e.target.value);setProject('');setParent('');}}><option value="">Choose client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{manage&&!w&&!p&&<button type="button" className="btn btn-ghost" onClick={()=>openInline('client')}>+ Add client</button>}</div>}
 {isTask&&<><div className="stack"><label>Project<select className="input" required value={project} onChange={e=>{setProject(e.target.value);setParent('');}}><option value="">Choose project</option>{projects.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>{manage&&<button type="button" className="btn btn-ghost" disabled={!client} onClick={()=>openInline('project')}>+ Add project</button>}</div>
 {['subtask','update','complete'].includes(kind)&&<div className="stack"><label>Parent task<select className="input" required={kind==='subtask'} value={parent} onChange={e=>setParent(e.target.value)}><option value="">{kind==='subtask'?'Choose parent task':'No parent (main task)'}</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label><button type="button" className="btn btn-ghost" disabled={!project} onClick={()=>openInline('task')}>+ Add parent task</button></div>}
 <div className="stack"><label>Assigned to<select className="input" value={assignee} required={!!s} onChange={e=>setAssignee(e.target.value)}><option value="">Unassigned</option>{members.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>{manage&&<button type="button" className="btn btn-ghost" onClick={()=>openInline('teammate')}>+ Add teammate</button>}</div>
 <label>Month<input className="input" type="month" required value={month} onChange={e=>setMonth(e.target.value)}/></label>
 <label>Status<select className="input" value={status} onChange={e=>setStatus(e.target.value as WorkItem['status'])}><option value="backlog">Backlog</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="done">Complete</option></select></label>
 <label>Estimated hours<input className="input" type="number" min="0" step="0.25" readOnly={hasChildren} value={hasChildren&&w?taskSummary(w,data.workItems,data.timeEntries).estimated:estimate} onChange={e=>setEstimate(e.target.value)}/></label>
 <label>Actual hours<input className="input" readOnly value={w?taskSummary(w,data.workItems,data.timeEntries).actual:0}/><small>Calculated from saved time entries. Correct individual sessions in Time tracking.</small></label>
 <label><input type="checkbox" disabled={!manage} checked={visible} onChange={e=>setVisible(e.target.checked)}/> Share with client (subtasks also require a shared parent)</label>
 {props.allowTemplate&&<label><input type="checkbox" checked={template} onChange={e=>setTemplate(e.target.checked)}/> Save as reusable template</label>}
 </>}
 {kind==='project'&&<><label>Stage<select className="input" value={stage} onChange={e=>setStage(e.target.value as Project['stage'])}>{['planned','active','on_hold','completed'].map(v=><option key={v} value={v}>{v.replace('_',' ')}</option>)}</select></label><label>Billing<select className="input" value={billing} onChange={e=>setBilling(e.target.value as Project['billingType'])}>{['inherit','hourly','retainer','fixed_fee'].map(v=><option key={v} value={v}>{v==='inherit'?'Use client billing':v.replace('_',' ')}</option>)}</select></label><label>Hourly rate (USD)<input className="input" type="number" min="0" step="0.01" value={rate} onChange={e=>setRate(e.target.value)}/></label><label>Fee (USD; monthly for retainers)<input className="input" type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(e.target.value)}/></label><label>Hour budget<input className="input" type="number" min="0" step="0.25" value={budget} onChange={e=>setBudget(e.target.value)}/></label><label>Start date<input className="input" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label></>}
 {kind!=='client'&&<label>Due date<input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>}
 </fieldset>
 {inline&&inline!=='teammate'&&<section className="inline-create stack" aria-label={`Add ${inline}`}><h3>Add {inline==='task'?'parent task':inline}</h3><label>Name<input className="input" value={name} maxLength={inline==='project'?160:200} onChange={e=>setName(e.target.value)} disabled={busy}/></label><label>Description / scope<textarea className="input" value={scope} maxLength={10000} onChange={e=>setScope(e.target.value)} disabled={busy}/></label><div className="row"><button type="button" className="btn btn-primary" onClick={()=>void createInline()} disabled={busy||!name.trim()}>Save and select</button><button type="button" className="btn" disabled={busy} onClick={()=>setInline(null)}>Cancel</button></div></section>}
 {inline==='teammate'&&<AddTeammate onCreated={m=>{setExtras(x=>({...x,members:[...x.members,m]}));setAssignee(m.id);setNotice(`${m.name} saved and selected.`);}} onCancel={()=>setInline(null)}/>}
 {s&&<details><summary>Suggestion source</summary><p>{s.source_subject}</p><blockquote>{s.evidence}</blockquote></details>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 <p className="muted">Records created with “Save and select” stay in the workspace even if you cancel these edits.</p>
 <div className="row"><button className="btn btn-primary" disabled={busy||!!inline||!!supportSnapshot}>{busy?'Saving…':s?'Save and add':'Save'}</button><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>{s&&s.user_id===currentUser?.id&&<button type="button" className="btn btn-danger" disabled={busy||!!inline} onClick={()=>void dismiss()}>Delete suggestion</button>}</div>
 </form></section></div>;
}
