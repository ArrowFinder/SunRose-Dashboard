import { isAssignedProject } from "../lib/projectAssignment";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isInternalUser, isOwnerOrAdmin } from '../lib/permissions';
import { currentYearMonth } from '../lib/month';
import { WorkItemModal } from './WorkItemModal';

export function ClientAddAction({clientId,defaultProjectId}:{clientId:string;defaultProjectId?:string}) {
 const {data,currentUser,cloud,addWorkItem,supportSnapshot}=useAppState();
 const [open,setOpen]=useState(false),[kind,setKind]=useState('task'),[projectId,setProjectId]=useState(defaultProjectId||''),[parentId,setParentId]=useState(''),[compose,setCompose]=useState(false);
 const client=data.clients.find(c=>c.id===clientId);
 if(!client||client.archivedAt||supportSnapshot||!isInternalUser(currentUser))return null;
 const projects=(data.projects||[]).filter(p=>p.clientId===clientId&&isAssignedProject(p)&&p.stage!=='completed');
 const parents=data.workItems.filter(t=>t.clientId===clientId&&!t.parentId&&!t.archivedAt&&t.status!=='done'&&(!projectId||t.projectId===projectId));
 const parent=parents.find(t=>t.id===parentId);
 return <div className="stack">
 <button className="btn btn-primary" aria-expanded={open} onClick={()=>{setOpen(!open);setProjectId(defaultProjectId||'');setParentId('');}}>Add action</button>
 {open&&<section className="card stack" aria-label="Add action"><h2>Add work for {client.name}</h2>
 {cloud&&isOwnerOrAdmin(currentUser)&&<Link className="btn" to={`/client/${clientId}/projects?create=1`} onClick={()=>setOpen(false)}>New project</Link>}
 <label>Action<select className="input" value={kind} onChange={e=>{setKind(e.target.value);setParentId('');}}><option value="task">New task in an existing project</option><option value="subtask">New subtask in an existing task</option></select></label>
 {cloud&&<label>Project<select className="input" value={projectId} onChange={e=>{setProjectId(e.target.value);setParentId('');}}><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 {kind==='subtask'&&<label>Parent task<select className="input" value={parentId} onChange={e=>setParentId(e.target.value)}><option value="">Choose a task</option>{parents.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>}
 {kind==='subtask'&&projectId&&!parents.length&&<p>No open main tasks in this project yet. Add a task first.</p>}
 <div className="row"><button className="btn btn-primary" disabled={(cloud&&!projectId)||(kind==='subtask'&&!parent)} onClick={()=>setCompose(true)}>Continue</button><button className="btn" onClick={()=>setOpen(false)}>Cancel</button></div></section>}
 <WorkItemModal open={compose} onClose={()=>{setCompose(false);setOpen(false);}} clientId={clientId} clientName={client.name} defaultProjectId={projectId} parentTask={kind==='subtask'?parent:null} defaultYearMonth={parent?.yearMonth||currentYearMonth()} assignableUsers={data.users.filter(u=>u.active!==false&&isInternalUser(u))} allowSaveAsTemplate={false} onSave={async payload=>{await addWorkItem(payload);}}/>
 </div>;
}
