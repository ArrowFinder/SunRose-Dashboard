/** Treat model project choices as proposals, never authority to create records. */
export type ProjectContext = {id:string;client_id:string;name:string;stage:string};
type TaskContext = {id:string;client_id:string;project_id?:string;parent_id:string|null;archived_at?:string|null};
type Choice = {kind:string;client_id:string|null;project_id?:string|null;parent_id:string|null;task_id:string|null;new_project_name?:string|null;project_evidence?:string|null};
export function resolveProject(p:Choice,projects:ProjectContext[],tasks:TaskContext[],sourceText:string){
 const uncertain={project_id:null,new_project_name:null,project_match:'uncertain',project_evidence:''};
 if(p.kind==='client')return uncertain;
 const related=tasks.find(t=>t.id===(p.kind==='task'?p.parent_id:p.task_id)&&t.client_id===p.client_id&&!t.archived_at);
 if(related){
  const project=projects.find(x=>x.id===related.project_id&&x.client_id===p.client_id);
  return project?{...uncertain,project_id:project.id,project_match:'existing',project_evidence:'Inherited from the existing task.'}:uncertain;
 }
 const normalize=(s:string)=>s.toLowerCase().replace(/\s+/g,' ').trim();
 const evidence=typeof p.project_evidence==='string'?p.project_evidence.trim():'';
 if(!evidence||evidence.length>600||!normalize(sourceText).includes(normalize(evidence)))return uncertain;
 const project=projects.find(x=>x.id===p.project_id&&x.client_id===p.client_id&&x.stage!=='completed');
 if(project&&!p.new_project_name)return {...uncertain,project_id:project.id,project_match:'existing',project_evidence:evidence};
 const name=typeof p.new_project_name==='string'?p.new_project_name.trim():'';
 if(p.project_id||!name||name.length>160)return uncertain;
 // Never turn a second spelling of an existing project into a new project.
 const duplicate=projects.find(x=>x.client_id===p.client_id&&normalize(x.name)===normalize(name));
 if(duplicate)return duplicate.stage==='completed'?uncertain:{...uncertain,project_id:duplicate.id,project_match:'existing',project_evidence:evidence};
 return {...uncertain,new_project_name:name,project_match:'new',project_evidence:evidence};
}
