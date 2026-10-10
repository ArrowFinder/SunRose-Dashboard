import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useAppState} from '../context/AppStateContext';
import {isAssignedProject} from '../lib/projectAssignment';
import {isInternalUser,isOwnerOrAdmin} from '../lib/permissions';
import type {WorkItem} from '../lib/types';
export function ProjectRequired({task}:{task:WorkItem}){
 const {data,currentUser,updateWorkItem,supportSnapshot,viewPath=(p:string)=>p}=useAppState();
 const [selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!isInternalUser(currentUser)||isAssignedProject(data.projects?.find(p=>p.id===task.projectId)))return null;
 const root=task.parentId?data.workItems.find(w=>w.id===task.parentId):task;
 const editable=!supportSnapshot&&!task.archivedAt&&!data.clients.find(c=>c.id===task.clientId)?.archivedAt;
 return <section className="card" aria-label="Project required"><strong>Project required</strong><p>Assign this task to a project, or add a new project to this client.{task.parentId?' Subtasks use their parent task’s project.':''}</p>
 {editable&&root&&<form className="row" onSubmit={async e=>{e.preventDefault();if(!selected||busy)return;setBusy(true);setError('');try{await updateWorkItem(root.id,{projectId:selected});}catch(e){setError(e instanceof Error?e.message:'Could not assign project.');}finally{setBusy(false);}}}><label>Project<select className="input" required value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="">Choose a project</option>{data.projects?.filter(p=>p.clientId===task.clientId&&isAssignedProject(p)&&p.stage!=='completed').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="btn btn-primary" disabled={busy||!selected}>{busy?'Assigning…':'Assign project'}</button>{isOwnerOrAdmin(currentUser)?<Link className="btn" to={`/client/${task.clientId}/projects?create=1`}>Add new project</Link>:<span>Ask an owner or admin if a new project is needed.</span>}</form>}
 {supportSnapshot&&<p>Assignment is available in the user’s own account. <Link to={viewPath(`/client/${task.clientId}`)}>View client work</Link></p>}{error&&<p role="alert">{error}</p>}</section>;
}
export function ProjectAssignmentNotice(){
 const {data,currentUser,viewPath=(p:string)=>p}=useAppState();
 const tasks=data.workItems.filter(w=>!w.parentId&&!w.archivedAt&&!data.clients.find(c=>c.id===w.clientId)?.archivedAt&&!isAssignedProject(data.projects?.find(p=>p.id===w.projectId)));
 if(!isInternalUser(currentUser)||!tasks.length)return null;
 return <aside className="card" role="status"><strong>{tasks.length} {tasks.length===1?'task needs':'tasks need'} a project</strong><p>Choose an existing project or add a new project under the client.</p><Link className="btn" to={viewPath('/tasks?project=unassigned&status=&kind=main')}>Review tasks needing a project</Link></aside>;
}
