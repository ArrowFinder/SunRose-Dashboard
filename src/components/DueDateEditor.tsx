import {useState} from 'react';
import {useAppState} from '../context/AppStateContext';
import {isInternalUser} from '../lib/permissions';
import type {WorkItem} from '../lib/types';
export function DueDateEditor({task}:{task:WorkItem}){
 const {currentUser,supportSnapshot,updateWorkItem,data}=useAppState();
 const [open,setOpen]=useState(false),[date,setDate]=useState(task.dueDate||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const label=task.dueDate?new Date(task.dueDate.slice(0,10)+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'No due date';
 if(!isInternalUser(currentUser)||supportSnapshot||task.archivedAt||data.clients.find(c=>c.id===task.clientId)?.archivedAt)return <span>{label}</span>;
 async function save(value:string){if(busy)return;setBusy(true);setError('');try{await updateWorkItem(task.id,{dueDate:value||null,updatedAt:task.updatedAt});setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Could not save date.');}finally{setBusy(false);}}
 return <div className="due-editor"><button className="btn btn-ghost" aria-label={`Change due date for ${task.title}`} aria-expanded={open} onClick={()=>{setDate(task.dueDate||'');setError('');setOpen(!open);}}>{label}</button>{open&&<div className="card due-popover"><label>Due date<input autoFocus type="date" className="input" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label><div className="row"><button className="btn btn-primary" disabled={busy||!date} onClick={()=>void save(date)}>Save</button><button className="btn" disabled={busy} onClick={()=>void save('')}>No due date</button><button className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div>{error&&<p role="alert">{error}</p>}</div>}</div>;
}
