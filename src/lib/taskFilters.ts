import {isAssignedProject} from './projectAssignment';
import type {AppBundle,WorkItem} from './types';
import {taskSummary} from './taskTree';
export type TaskFilters={search:string;client:string;project:string;assignee:string;status:string;due:string;from:string;to:string;kind:string;archived:boolean;sort:string};
export const defaultTaskFilters:TaskFilters={search:'',client:'',project:'',assignee:'',status:'open',due:'',from:'',to:'',kind:'',archived:false,sort:'due'};
export function filterTasks(data:AppBundle,f:TaskFilters,today:string):WorkItem[]{
 const statuses=new Map(data.workItems.map(w=>[w.id,taskSummary(w,data.workItems,data.timeEntries).status]));
 return data.workItems.filter(w=>{
 const c=data.clients.find(c=>c.id===w.clientId),p=data.projects?.find(p=>p.id===w.projectId);
 if(!c||(!f.archived&&(c.archivedAt||w.archivedAt||data.workItems.some(parent=>parent.id===w.parentId&&parent.archivedAt))))return false;
 if(f.client&&w.clientId!==f.client)return false;
 if(f.project==='unassigned'?isAssignedProject(p):f.project&&w.projectId!==f.project)return false;
 if(f.assignee==='unassigned'?!!w.assignedUserId:f.assignee&&w.assignedUserId!==f.assignee)return false;
 const status=statuses.get(w.id);
 if(f.status==='open'?status==='done':f.status&&status!==f.status)return false;
 if(f.kind==='main'&&w.parentId||f.kind==='subtask'&&!w.parentId)return false;
 if(f.due==='undated'&&w.dueDate||f.due==='dated'&&!w.dueDate||f.due==='today'&&w.dueDate!==today||f.due==='overdue'&&(!w.dueDate||w.dueDate>=today||status==='done'))return false;
 if(f.from&&(!w.dueDate||w.dueDate<f.from)||f.to&&(!w.dueDate||w.dueDate>f.to))return false;
 const search=f.search.trim().toLowerCase();
 return !search||[w.title,w.description,c.name,p?.name,data.users.find(u=>u.id===w.assignedUserId)?.name].some(v=>v?.toLowerCase().includes(search));
 }).sort((a,b)=>{
 const byDate=(a.dueDate||'9999-12-31').localeCompare(b.dueDate||'9999-12-31');
 if(f.sort==='title')return a.title.localeCompare(b.title)||a.id.localeCompare(b.id);
 if(f.sort==='recent')return b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id);
 return byDate||a.title.localeCompare(b.title)||a.id.localeCompare(b.id);
 });
}
