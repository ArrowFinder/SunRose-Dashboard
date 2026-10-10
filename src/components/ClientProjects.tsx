import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { getSupabase } from '../lib/supabaseClient';
import { isOwnerOrAdmin } from '../lib/permissions';
import type { Project } from '../lib/types';
import { effectiveActualHours } from '../lib/hours';
export function ClientProjects({clientId}:{clientId:string}){
 const {data,currentUser,cloud,refresh}=useAppState();
 const [editing,setEditing]=useState<Project|null|undefined>(undefined),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const client=data.clients.find(c=>c.id===clientId);
 const manage=cloud&&isOwnerOrAdmin(currentUser)&&!client?.archivedAt;
 if(!cloud)return <p>Projects are available in the shared workspace.</p>;
 return <section className="stack"><div className="row" style={{justifyContent:'space-between'}}><h2>Projects</h2>{manage&&<button className="btn btn-primary" onClick={()=>{setEditing(null);setError('');}}>Add project</button>}</div>
 <p className="muted">Organize separate engagements for this client. General holds work that has not yet been organized into a specific project.</p>
 {error&&<p role="alert">{error}</p>}
 {editing!==undefined&&<form key={editing?.id||'new'} className="card stack" onSubmit={async e=>{
  e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);setBusy(true);setError('');
  const number=(key:string)=>f.get(key)?Number(f.get(key)):null;
  const patch={client_id:clientId,name:String(f.get('name')).trim(),description:String(f.get('description')),stage:String(f.get('stage')) as Project['stage'],billing_type:String(f.get('billing')) as Project['billingType'],hourly_rate:number('rate'),fee:number('fee'),hour_budget:number('budget'),start_date:String(f.get('start'))||null,due_date:String(f.get('due'))||null};
  try{const db=getSupabase();const r=editing?await db.from('projects').update(patch).eq('id',editing.id).eq('updated_at',editing.updatedAt).select('id').single():await db.from('projects').insert(patch).select('id').single();if(r.error)throw r.error;await refresh?.();setEditing(undefined);}catch(e){setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message' in e?String(e.message):'Could not save project. Refresh and try again.');}finally{setBusy(false);}
 }}><h3>{editing?'Edit project':'New project'}</h3><fieldset disabled={busy} className="project-fields">
 <label>Name<input name="name" className="input" required maxLength={160} defaultValue={editing?.name}/></label>
 <label>Description<textarea name="description" className="input" defaultValue={editing?.description}/></label>
 <label>Stage<select name="stage" className="input" defaultValue={editing?.stage||'planned'}><option value="planned">Planned</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option></select></label>
 <label>Billing<select name="billing" className="input" defaultValue={editing?.billingType||'inherit'}><option value="inherit">Use client billing</option><option value="hourly">Hourly</option><option value="retainer">Retainer</option><option value="fixed_fee">Fixed fee</option></select></label>
 <label>Hourly rate (USD)<input name="rate" type="number" min="0" step="0.01" className="input" defaultValue={editing?.hourlyRate??''}/></label>
 <label>Fee (USD; monthly for retainers)<input name="fee" type="number" min="0" step="0.01" className="input" defaultValue={editing?.fee??''}/></label>
 <label>Project hour budget (optional)<input name="budget" type="number" min="0" step="0.25" className="input" defaultValue={editing?.hourBudget??''}/></label>
 <label>Start date<input name="start" type="date" className="input" defaultValue={editing?.startDate||''}/></label><label>Due date<input name="due" type="date" className="input" defaultValue={editing?.dueDate||''}/></label>
 <div className="row"><button className="btn btn-primary">{busy?'Saving…':'Save project'}</button><button type="button" className="btn" onClick={()=>setEditing(undefined)}>Cancel</button></div></fieldset><p className="muted">Billing settings record the agreement. They do not issue invoices or calculate payroll.</p></form>}
 <div className="grid-2">{(data.projects||[]).filter(p=>p.clientId===clientId).map(p=>{
  const work=data.workItems.filter(w=>w.projectId===p.id);const hours=work.reduce((sum,w)=>sum+effectiveActualHours(w,data.timeEntries),0);
  return <article className="card" key={p.id}><h3><Link to={`/client/${clientId}/tasks?project=${p.id}`}>{p.name}</Link></h3><p>{p.stage.replace('_',' ')} · {work.filter(w=>!w.archivedAt&&!w.parentId).length} main tasks · {hours.toFixed(2)}h recorded</p><p>{p.description}</p><p className="muted">Billing: {p.billingType==='inherit'?'Use client billing':p.billingType.replace('_',' ')}{p.dueDate?` · Due ${p.dueDate}`:''}</p>{manage&&<button className="btn" onClick={()=>{setEditing(p);setError('');}}>Edit project</button>}</article>;
 })}</div></section>;
}
