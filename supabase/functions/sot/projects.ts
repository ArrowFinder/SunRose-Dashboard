/** Treat model project choices as proposals, never authority to create records. */
export type ProjectContext = {id:string;client_id:string;name:string;stage:string};
type TaskContext = {id:string;client_id:string;project_id?:string;parent_id:string|null;archived_at?:string|null};
type Choice = {kind:string;client_id:string|null;project_id?:string|null;parent_id:string|null;task_id:string|null;new_project_name?:string|null;project_evidence?:string|null};
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
function eventDates(text:string){
 const found:string[]=[];
 for(const m of text.toLowerCase().matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/g)){
  const month=months.findIndex(x=>x.startsWith(m[1].slice(0,3)))+1;
  found.push(`${month}-${Number(m[2])}-${m[3]||''}`);
 }
 for(const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))found.push(`${Number(m[2])}-${Number(m[3])}-${m[1]}`);
 return [...new Set(found)];
}
function supportsEvent(name:string,evidence:string,projects:ProjectContext[]){
 const dates=eventDates(name);if(!dates.length)return true;
 const cited=eventDates(evidence);if(cited.length!==1||dates.length!==1)return false;
 const [month,day,year]=dates[0].split('-'),[cm,cd,cy]=cited[0].split('-');
 if(month!==cm||day!==cd||year&&cy&&year!==cy)return false;
 // An omitted year is only safe when it cannot select another annual occurrence.
 if(!cy&&new Set(projects.flatMap(p=>eventDates(p.name)).filter(d=>d.startsWith(`${month}-${day}-`))).size>1)return false;
 return true;
}
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
 if(project&&!p.new_project_name&&supportsEvent(project.name,evidence,projects.filter(x=>x.client_id===p.client_id)))return {...uncertain,project_id:project.id,project_match:'existing',project_evidence:evidence};
 const name=typeof p.new_project_name==='string'?p.new_project_name.trim():'';
 if(p.project_id||!name||name.length>160||!supportsEvent(name,evidence,projects.filter(x=>x.client_id===p.client_id)))return uncertain;
 // Never turn a second spelling of an existing project into a new project.
 const duplicate=projects.find(x=>x.client_id===p.client_id&&normalize(x.name)===normalize(name));
 if(duplicate)return duplicate.stage==='completed'?uncertain:{...uncertain,project_id:duplicate.id,project_match:'existing',project_evidence:evidence};
 return {...uncertain,new_project_name:name,project_match:'new',project_evidence:evidence};
}
