import {ProjectAssignmentNotice} from "../components/ProjectRequired";
import { projectLabel } from "../lib/projectAssignment";
import { DueDateEditor } from "../components/DueDateEditor";
import { SotReview } from "../components/SotReview";
import { Link, Navigate } from "react-router-dom";
import { useAppState } from "../context/AppStateContext";
import { clientsVisibleToUser } from "../lib/permissions";
import { hexOrDefault } from "../lib/color";
import { taskSummary } from "../lib/taskTree";
import { CalendarPage } from "./CalendarPage";

export function Overview() {
  const { data, currentUser, viewPath = (p:string)=>p } = useAppState();
  if (currentUser?.role === "client") return currentUser.clientId
    ? <Navigate to={`/client/${currentUser.clientId}`} replace />
    : <div className="card"><h1>Welcome</h1><p>Your account is waiting for the owner to assign access.</p></div>;

  const clients = clientsVisibleToUser(currentUser, data.clients);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  const tasks = data.workItems.filter(w => !w.archivedAt && clients.some(c=>c.id===w.clientId)
    && !data.workItems.some(p=>p.id===w.parentId&&p.archivedAt)
    && taskSummary(w,data.workItems,data.timeEntries).status!=="done")
    .sort((a,b)=>(a.dueDate||"9999-12-31").localeCompare(b.dueDate||"9999-12-31")||a.title.localeCompare(b.title));
  const overdue = tasks.filter(w=>w.dueDate && w.dueDate<today).length;
  const dueToday = tasks.filter(w=>w.dueDate===today).length;

  return <div className="stack">
    <header><h1>Overview</h1><p className="muted">What needs attention, what SOT found, and what’s coming up.</p></header>
    <ProjectAssignmentNotice/><section className="card" aria-labelledby="overview-todo">
      <div className="overview-section-heading"><h2 id="overview-todo">To-do list</h2><span className="badge">{tasks.length} open</span></div>
      <p className="muted">Earliest deadlines first, including subtasks. Tasks without a due date appear last.</p>
      <div className="overview-counts"><span className={overdue?"badge badge-danger":"badge"}>{overdue} overdue</span><span className="badge">{dueToday} due today</span></div>
      {tasks.length===0 ? <p>No open tasks. Review SOT suggestions below or <Link to={viewPath("/clients")}>open a client</Link> to add work.</p> :
        <ul className="overview-todos">{tasks.map(w=>{
          const client=clients.find(c=>c.id===w.clientId)!;
          const parent=data.workItems.find(p=>p.id===w.parentId);
          const due=w.dueDate;
          return <li key={w.id}><div className="overview-todo" style={{borderLeftColor:hexOrDefault(client)}}>
            <div><strong><Link to={viewPath(`/client/${w.clientId}/task/${w.id}`)}>{w.title}</Link></strong><span className="overview-task-context">{client.name}{` / ${projectLabel(data.projects?.find(p=>p.id===w.projectId))}`} · {data.users.find(u=>u.id===w.assignedUserId)?.name||"Unassigned"}</span>{parent&&<span className="overview-task-context">Subtask of {parent.title}</span>}</div>
            <div className={`badge ${due&&due<today?"badge-danger":due===today?"badge-warn":""}`}>{due&&due<today?"Overdue · ":due===today?"Today · ":""}<DueDateEditor task={w}/></div>
          </div></li>;
        })}</ul>}
    </section>
    <SotReview />
    <section aria-label="All clients calendar"><CalendarPage embedded /></section>
  </div>;
}
