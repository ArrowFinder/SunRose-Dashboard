import {useAppState} from '../context/AppStateContext';
import type {SotSuggestion} from '../lib/sot';
export function SotProjectContext({suggestion:s}:{suggestion:SotSuggestion}) {
 const {data}=useAppState();
 if(s.kind==='client')return null;
 if(s.kind==='project')return <div className="sot-project-context"><strong>{s.payload.client_name} → {s.title}</strong><p>Proposed project · Approval creates only the project. Related tasks need separate review.</p></div>;
 const related=data.workItems.find(w=>w.id===(s.kind==='task'?s.payload.parent_id:s.payload.task_id));
 const project=data.projects?.find(p=>p.id===(related?.projectId||s.payload.project_id)&&p.clientId===s.payload.client_id);
 return <div className="sot-project-context"><strong>{s.payload.client_name} → {project?.name||'Project needed'} → {s.title}</strong>
  {!project&&s.payload.new_project_name&&<p><span className="badge">Awaiting project review</span> {s.payload.new_project_name} · Approval required</p>}
  {!project&&!s.payload.new_project_name&&<p>Choose a project in Edit before adding.</p>}
  {s.payload.project_evidence&&<p className="muted">Project context: {s.payload.project_evidence}</p>}
 </div>;
}
