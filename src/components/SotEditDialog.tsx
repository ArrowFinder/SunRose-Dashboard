import { isAssignedProject } from "../lib/projectAssignment";
import {useState} from 'react';
import {useAppState} from '../context/AppStateContext';
import {getSupabase} from '../lib/supabaseClient';
import {isOwnerOrAdmin} from '../lib/permissions';
import type {SotSuggestion} from '../lib/sot';
export function SotEditDialog({suggestion:s,onClose,onAdded}:{suggestion:SotSuggestion;onClose:()=>void;onAdded:()=>Promise<void>}) {
 const {data,currentUser}=useAppState();
 const [title,setTitle]=useState(s.kind==='client'?s.payload.client_name:s.title);
 const [description,setDescription]=useState(s.description);
 const [client,setClient]=useState(s.payload.client_id||'');
 const [project,setProject]=useState(data.workItems.find(w=>w.id===s.payload.parent_id)?.projectId||s.payload.project_id||'');
 const [parent,setParent]=useState(s.payload.parent_id||'');
 const [due,setDue]=useState(s.payload.due_date||'');
 const [estimate,setEstimate]=useState(s.payload.estimated_hours?.toString()||'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:React.FormEvent) {
  e.preventDefault();if(busy)return;setBusy(true);setError('');
  try {
   const common={suggestion_id:s.id,expected_updated_at:s.updated_at,edited_title:title,edited_description:description,edited_due:due||null,edited_estimate:estimate===''?null:Number(estimate)};
   const result=s.kind==='project'
    ?await getSupabase().rpc('sot_accept_project',{suggestion_id:s.id,expected_updated_at:s.updated_at,project_name:title,project_scope:description})
    :await getSupabase().rpc('sot_edit_and_accept',{...common,selected_client:client||null,selected_project:project||null,selected_parent:parent||null});
   if(result.error)throw result.error;
   await onAdded();onClose();
  } catch(e) {setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message' in e?String(e.message):'Could not add suggestion.');}
  finally{setBusy(false);}
 }
 return <div className="modal-backdrop"><section className="modal card sot-edit-modal" role="dialog" aria-modal="true" aria-label="Edit before adding">
  <h2>Edit before adding</h2><form className="stack" onSubmit={submit}>
   <fieldset disabled={busy} className="project-fields">
    <label>{s.kind==='client'?'Business name':s.kind==='project'?'Project name':'Task title'}<input autoFocus className="input" required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>{s.kind==='project'?'Project scope':'Description'}<textarea className="input" maxLength={10000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    {s.kind==='task'&&<>
     <label>Client<select className="input" required value={client} onChange={e=>{setClient(e.target.value);setProject('');setParent('');}}><option value="">Choose client</option>{data.clients.filter(c=>!c.archivedAt).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label>Project<select className="input" required value={project} onChange={e=>{setProject(e.target.value);setParent('');}}><option value="">Choose project</option>{data.projects?.filter(p=>p.clientId===client&&isAssignedProject(p)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     {s.payload.new_project_name&&<p>Review the separate project suggestion for <strong>{s.payload.new_project_name}</strong> first, or choose an existing project.</p>}
     <label>Main task (optional)<select className="input" value={parent} onChange={e=>setParent(e.target.value)}><option value="">Create a main task</option>{data.workItems.filter(w=>w.clientId===client&&w.projectId===project&&!w.parentId&&!w.archivedAt).map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
    </>}
    {!['client','project'].includes(s.kind)&&<><label>Due date<input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></label><label>Estimated hours<input className="input" type="number" min="0" step="0.25" value={estimate} onChange={e=>setEstimate(e.target.value)}/></label></>}
   </fieldset>
   {error&&<p role="alert">{error}</p>}
   {s.kind==='project'&&<p>Adding confirms this project and its scope under {s.payload.client_name}. Related task suggestions remain pending for separate review.</p>}
   <p className="muted">Your edits and approval are saved together. The source email is unchanged.</p>
   <div className="row"><button className="btn btn-primary" disabled={busy||(s.kind==='project'&&!isOwnerOrAdmin(currentUser))}>{busy?'Adding…':s.kind==='project'?'Add project':'Save and add'}</button><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button></div>
  </form>
 </section></div>;
}
