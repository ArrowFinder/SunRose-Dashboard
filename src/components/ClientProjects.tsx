import {WorkEditor} from './WorkEditor';
import { isAssignedProject } from "../lib/projectAssignment";
import { ViewControls,useViewPreference } from "./ViewControls";
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isOwnerOrAdmin } from '../lib/permissions';
import type { Project } from '../lib/types';
import { effectiveActualHours } from '../lib/hours';
export function ClientProjects({clientId}:{clientId:string}){
 const [params,setParams]=useSearchParams();
 const [view,setView]=useViewPreference("projects");
 const [sort,setSort]=useState("az");
 const {data,currentUser,cloud}=useAppState();
 const [editing,setEditing]=useState<Project|null|undefined>(undefined),[error,setError]=useState('');
 const client=data.clients.find(c=>c.id===clientId);
 const manage=cloud&&isOwnerOrAdmin(currentUser)&&!client?.archivedAt;
 useEffect(()=>{if(manage&&params.get('create')==='1'){setEditing(null);setError('');const next=new URLSearchParams(params);next.delete('create');setParams(next,{replace:true});}},[manage,params,setParams]);
 if(!cloud)return <p>Projects are available in the shared workspace.</p>;
 return <section className="stack"><div className="row" style={{justifyContent:'space-between'}}><h2>Projects</h2>{manage&&<button className="btn btn-primary" onClick={()=>{setEditing(null);setError('');}}>Add project</button>}</div>
 <p className="muted">Organize separate engagements for this client. Every task needs a specific project. Tasks awaiting assignment are listed on the Tasks page.</p>
 {error&&<p role="alert">{error}</p>}
 {editing!==undefined&&<WorkEditor key={editing?.id||'new'} project={editing} clientId={clientId} kind="project" onClose={()=>setEditing(undefined)}/>}
 <div className="row"><ViewControls view={view} onChange={setView}/><label>Sort<select className="input" value={sort} onChange={e=>setSort(e.target.value)}><option value="az">Name A–Z</option><option value="due">Nearest deadline</option></select></label></div>
 <div className={view==="grid"?"grid-2":"stack"}>{(data.projects||[]).filter(p=>p.clientId===clientId&&isAssignedProject(p)).sort((a,b)=>sort==="due"?(a.dueDate||"9999").localeCompare(b.dueDate||"9999")||a.name.localeCompare(b.name):a.name.localeCompare(b.name)).map(p=>{
  const work=data.workItems.filter(w=>w.projectId===p.id);const hours=work.reduce((sum,w)=>sum+effectiveActualHours(w,data.timeEntries),0);
  return <article className="card" key={p.id}><h3><Link to={`/client/${clientId}/tasks?project=${p.id}`}>{p.name}</Link></h3><p>{p.stage.replace('_',' ')} · {work.filter(w=>!w.archivedAt&&!w.parentId).length} main tasks · {hours.toFixed(2)}h recorded</p><p>{p.description}</p><p className="muted">Billing: {p.billingType==='inherit'?'Use client billing':p.billingType.replace('_',' ')}{p.dueDate?` · Due ${p.dueDate}`:''}</p>{manage&&<button className="btn" onClick={()=>{setEditing(p);setError('');}}>Edit project</button>}</article>;
 })}</div></section>;
}
