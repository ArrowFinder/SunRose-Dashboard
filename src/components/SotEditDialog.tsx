import {isAssignedProject} from '../lib/projectAssignment';
import {useState} from 'react';
import {useAppState} from '../context/AppStateContext';
import {getSupabase} from '../lib/supabaseClient';
import {isOwnerOrAdmin} from '../lib/permissions';
import {AddTeammate,type CreatedTeammate} from './AddTeammate';
import type {SotSuggestion} from '../lib/sot';
type Option={id:string;name:string;clientId?:string};
export function SotEditDialog({suggestion:s,onClose,onAdded}:{suggestion:SotSuggestion;onClose:()=>void;onAdded:()=>Promise<void>}) {
 const {data,currentUser,supportSnapshot,refresh}=useAppState();
 const [title,setTitle]=useState(s.kind==='client'?s.payload.client_name:s.title),[description,setDescription]=useState(s.description);
 const [client,setClient]=useState(s.payload.client_id||''),[project,setProject]=useState(data.workItems.find(w=>w.id===s.payload.parent_id)?.projectId||s.payload.project_id||''),[parent,setParent]=useState(s.payload.parent_id||'');
 const [assignee,setAssignee]=useState(s.user_id),[due,setDue]=useState(s.payload.due_date||''),[estimate,setEstimate]=useState(s.payload.estimated_hours?.toString()||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [inline,setInline]=useState<'client'|'project'|'teammate'|null>(null),[newName,setNewName]=useState(''),[newScope,setNewScope]=useState('');
 const [clients,setClients]=useState<Option[]>([]),[projects,setProjects]=useState<Option[]>([]),[members,setMembers]=useState<CreatedTeammate[]>([]);
 const manage=isOwnerOrAdmin(currentUser)&&!supportSnapshot;
 const merge=(base:Option[],extra:Option[])=>[...new Map([...base,...extra].map(x=>[x.id,x])).values()];
 const clientOptions=merge(data.clients.filter(c=>!c.archivedAt),clients);
 const projectOptions=merge((data.projects||[]).filter(p=>p.clientId===client&&isAssignedProject(p)&&p.stage!=='completed'),projects.filter(p=>p.clientId===client));
 const memberOptions=merge(data.users.filter(u=>u.active!==false&&u.role!=='client'),members);
 function start(kind:'client'|'project'|'teammate'){setInline(kind);setError('');setNewName(kind==='project'?s.payload.new_project_name||'':'');setNewScope('');}
 async function createRecord(){if(busy)return;setBusy(true);setError('');try{
  if(!newName.trim())throw new Error('Enter a name.');
  const r=inline==='client'?await getSupabase().rpc('review_create_client',{client_name:newName.trim(),client_context:newScope}):await getSupabase().rpc('review_create_project',{selected_client:client,project_name:newName.trim(),project_scope:newScope});
  if(r.error)throw r.error;
  if(inline==='client'){setClients(x=>[...x,{id:r.data,name:data.clients.find(c=>c.id===r.data)?.name||newName.trim()}]);setClient(r.data);setProject('');setParent('');}
  else{setProjects(x=>[...x,{id:r.data,name:data.projects?.find(p=>p.id===r.data)?.name||newName.trim(),clientId:client}]);setProject(r.data);setParent('');}
  setNotice(`${inline==='client'?'Client':'Project'} saved and selected. Your suggestion edits are preserved.`);setInline(null);await refresh?.();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 function message(e:unknown){return e&&typeof e==='object'&&'message'in e?String(e.message):'Could not save. Please retry.';}
 async function submit(e:React.FormEvent){e.preventDefault();if(busy||inline||supportSnapshot)return;setBusy(true);setError('');try{
  const r=await getSupabase().rpc('sot_review_submit',{suggestion_id:s.id,expected_updated_at:s.updated_at,edited_title:title,edited_description:description,selected_client:client||null,selected_project:project||null,selected_parent:parent||null,edited_due:due||null,edited_estimate:estimate===''?null:Number(estimate),selected_assignee:s.kind==='task'?assignee||null:null});
  if(r.error)throw r.error;await onAdded();onClose();
 }catch(e){setError(message(e));}finally{setBusy(false);}}
 async function dismiss(){if(busy||inline||supportSnapshot)return;if(!confirm('Delete this suggestion? Records you already created will remain.'))return;setBusy(true);setError('');try{const r=await getSupabase().rpc('sot_dismiss',{suggestion_id:s.id});if(r.error)throw r.error;await onAdded();onClose();}catch(e){setError(message(e));}finally{setBusy(false);}}
 return <div className="modal-backdrop"><section className="modal card sot-edit-modal" role="dialog" aria-modal="true" aria-label="Edit before adding">
 <h2>Edit before adding</h2><form className="stack" onSubmit={submit}>
 <fieldset disabled={busy||!!supportSnapshot} className="project-fields">
 <label>{s.kind==='client'?'Business name':s.kind==='project'?'Project name':'Task title'}<input autoFocus className="input" required maxLength={s.kind==='project'?160:200} readOnly={s.kind==='complete'} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 <label>{s.kind==='project'?'Project scope':'Description'}<textarea className="input" maxLength={10000} readOnly={s.kind==='complete'} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 {['task','project'].includes(s.kind)&&<div className="stack"><label>Client<select className="input" required value={client} disabled={!!inline} onChange={e=>{setClient(e.target.value);setProject('');setParent('');}}><option value="">Choose client</option>{clientOptions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{manage&&<button type="button" className="btn btn-ghost" disabled={!!inline} onClick={()=>start('client')}>+ Add client</button>}</div>}
 {s.kind==='task'&&<>
 <div className="stack"><label>Project<select className="input" required value={project} disabled={!!inline} onChange={e=>{setProject(e.target.value);setParent('');}}><option value="">Choose project</option>{projectOptions.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{manage&&<button type="button" className="btn btn-ghost" disabled={!client||!!inline} onClick={()=>start('project')}>+ Add project</button>}</div>
 <label>Main task (optional)<select className="input" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Create a main task</option>{data.workItems.filter(w=>w.clientId===client&&w.projectId===project&&!w.parentId&&!w.archivedAt&&w.status!=='done').map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
 <div className="stack"><label>Assigned to<select className="input" required value={assignee} onChange={e=>setAssignee(e.target.value)}>{memberOptions.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{manage&&<button type="button" className="btn btn-ghost" disabled={!!inline} onClick={()=>start('teammate')}>+ Add teammate</button>}</div>
 </>}
 {!['client','project','complete'].includes(s.kind)&&<><label>Due date<input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label>Estimated hours<input className="input" type="number" min="0" step="0.25" value={estimate} onChange={e=>setEstimate(e.target.value)}/></label></>}
 </fieldset>
 {(inline==='client'||inline==='project')&&<section className="inline-create stack" aria-label={`Add ${inline}`}><h3>Add {inline}</h3><label>Name<input className="input" maxLength={inline==='client'?200:160} value={newName} disabled={busy} onChange={e=>setNewName(e.target.value)}/></label><label>{inline==='client'?'Client context (optional)':'Project scope (optional)'}<textarea className="input" maxLength={10000} value={newScope} disabled={busy} onChange={e=>setNewScope(e.target.value)}/></label><div className="row"><button type="button" className="btn btn-primary" disabled={busy||!newName.trim()} onClick={()=>void createRecord()}>{busy?'Saving…':`Save ${inline} and select`}</button><button type="button" className="btn" disabled={busy} onClick={()=>setInline(null)}>Cancel {inline}</button></div><p className="muted">Saved immediately to the workspace. An existing matching name is selected instead of duplicated.</p></section>}
 {inline==='teammate'&&<AddTeammate onCreated={m=>{setMembers(x=>[...x,m]);setAssignee(m.id);setNotice(`${m.name} saved and selected.`);}} onCancel={()=>setInline(null)}/>}
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 {s.kind==='project'&&<p>This confirms the project under the selected client. Related task suggestions remain available for separate review.</p>}
 {s.kind==='complete'&&<p>Confirm completion of the existing task. Its saved title, description and assignment will be preserved.</p>}
 <p className="muted">New clients, projects and teammates remain saved even if you cancel this suggestion. The source email is unchanged.</p>
 <div className="row"><button className="btn btn-primary" disabled={busy||!!inline||!!supportSnapshot||(s.kind==='project'&&!manage)}>{busy?'Saving…':s.kind==='project'?'Add project':s.kind==='complete'?'Mark complete':'Save and add'}</button><button type="button" className="btn" disabled={busy||!!inline} onClick={onClose}>Cancel</button>{s.user_id===currentUser?.id&&<button type="button" className="btn btn-danger" disabled={busy||!!inline} onClick={()=>void dismiss()}>Delete suggestion</button>}</div>
 </form></section></div>;
}
