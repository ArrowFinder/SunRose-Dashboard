import {ProjectRequired,ProjectAssignmentNotice} from "../components/ProjectRequired";
import { isAssignedProject, projectLabel } from "../lib/projectAssignment";
import {Link,Navigate,useSearchParams} from 'react-router-dom';
import {useAppState} from '../context/AppStateContext';
import {isInternalUser} from '../lib/permissions';
import {defaultTaskFilters,filterTasks,type TaskFilters} from '../lib/taskFilters';
import {taskSummary} from '../lib/taskTree';
import {STATUS_LABELS} from '../lib/labels';
import {hexOrDefault} from '../lib/color';
import {DueDateEditor} from '../components/DueDateEditor';
export function TasksPage(){
 const {data,currentUser,viewPath=(p:string)=>p}=useAppState();const [params,setParams]=useSearchParams();
 if(!isInternalUser(currentUser))return <Navigate to="/" replace/>;
 const f={...defaultTaskFilters};for(const k of Object.keys(f) as (keyof TaskFilters)[]){if(k==='archived')f.archived=params.get(k)==='true';else if(params.has(k))f[k]=params.get(k)||'';}
 function change(key:keyof TaskFilters,value:string){const next=new URLSearchParams(params);next.set(key,value);if(key==='client')next.delete('project');if(key==='due'){next.delete('from');next.delete('to');}if(key==='from'||key==='to')next.delete('due');setParams(next,{replace:true});}
 const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const tasks=filterTasks(data,f,today);
 return <div className="stack"><header><h1>Tasks</h1><p className="muted">All client work in one place. Combine filters to plan your day.</p></header>
 <ProjectAssignmentNotice/><section className="card task-filters" aria-label="Task filters">
 <label>Search<input className="input" value={f.search} placeholder="Task, client, project or person" onChange={e=>change('search',e.target.value)}/></label>
 <label>Client<select className="input" value={f.client} onChange={e=>change('client',e.target.value)}><option value="">All clients</option>{data.clients.filter(c=>f.archived||!c.archivedAt).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Project<select className="input" value={f.project} onChange={e=>change('project',e.target.value)}><option value="">All projects</option><option value="unassigned">Project required</option>{data.projects?.filter(p=>isAssignedProject(p)&&(!f.client||p.clientId===f.client)).map(p=><option key={p.id} value={p.id}>{p.name}{!f.client?` — ${data.clients.find(c=>c.id===p.clientId)?.name}`:''}</option>)}</select></label>
 <label>Assigned to<select className="input" value={f.assignee} onChange={e=>change('assignee',e.target.value)}><option value="">Everyone</option><option value="unassigned">Unassigned</option>{data.users.filter(u=>isInternalUser(u)).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
 <label>Status<select className="input" value={f.status} onChange={e=>change('status',e.target.value)}><option value="open">All open work</option><option value="">Any status</option>{Object.entries(STATUS_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <label>Deadline<select className="input" value={f.due} onChange={e=>change('due',e.target.value)}><option value="">All deadlines</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="undated">No due date</option><option value="dated">Has due date</option></select></label>
 <label>Due from<input className="input" type="date" value={f.from} onChange={e=>change('from',e.target.value)}/></label><label>Due through<input className="input" type="date" value={f.to} onChange={e=>change('to',e.target.value)}/></label>
 <label>Task type<select className="input" value={f.kind} onChange={e=>change('kind',e.target.value)}><option value="">Tasks and subtasks</option><option value="main">Main tasks</option><option value="subtask">Subtasks</option></select></label>
 <label>Sort<select className="input" value={f.sort} onChange={e=>change('sort',e.target.value)}><option value="due">Earliest deadline</option><option value="title">Alphabetical</option><option value="recent">Recently updated</option></select></label>
 <label><input type="checkbox" checked={f.archived} onChange={e=>change('archived',String(e.target.checked))}/> Include archived work</label>
 <button className="btn" onClick={()=>setParams({})}>Reset filters</button></section>
 {f.from&&f.to&&f.from>f.to&&<p role="alert">Choose an end date on or after the start date.</p>}
 <p role="status">{tasks.length} {tasks.length===1?'task':'tasks'} match</p>
 <div className="stack">{tasks.map(w=>{const c=data.clients.find(c=>c.id===w.clientId)!,p=data.projects?.find(p=>p.id===w.projectId),summary=taskSummary(w,data.workItems,data.timeEntries);return <article key={w.id} className="card task-result" style={{borderLeft:`4px solid ${hexOrDefault(c)}`}}><div><h2><Link to={viewPath(`/client/${c.id}/task/${w.id}`)}>{w.title}</Link></h2><p className="muted">{c.name} · {projectLabel(p)} · {data.users.find(u=>u.id===w.assignedUserId)?.name||'Unassigned'}</p>{w.parentId&&<p className="muted">Subtask of {data.workItems.find(p=>p.id===w.parentId)?.title}</p>}<span className="badge">{STATUS_LABELS[summary.status]}</span>{(w.archivedAt||c.archivedAt)&&<span className="badge">Archived</span>}</div><DueDateEditor task={w}/><ProjectRequired task={w}/></article>;})}</div>
 {!tasks.length&&<p className="card">No tasks match these filters.</p>}
 </div>;
}
