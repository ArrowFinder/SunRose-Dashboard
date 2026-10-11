import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAppState} from '../context/AppStateContext';
import {getSupabase} from '../lib/supabaseClient';
import {isOwnerOrAdmin} from '../lib/permissions';
import {isAssignedProject} from '../lib/projectAssignment';
import {SotEditDialog} from './SotEditDialog';
import type {SotSuggestion} from '../lib/sot';
type Request={id:string;client_id:string;title:string;description:string};
export function ReviewInbox(){
 const {cloud,currentUser,supportSnapshot,data,refresh}=useAppState();
 const enabled=cloud&&!supportSnapshot&&isOwnerOrAdmin(currentUser);
 const [requests,setRequests]=useState<Request[]>([]),[approvals,setApprovals]=useState<(SotSuggestion&{reviewer_name:string})[]>([]),[editing,setEditing]=useState<SotSuggestion|null>(null);
 const [project,setProject]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=useCallback(async()=>{if(!enabled)return;const [r,a]=await Promise.all([getSupabase().from('client_requests').select('id,client_id,title,description').eq('status','pending').order('created_at').limit(200),getSupabase().rpc('sot_project_approvals')]);if(r.error||a.error)throw new Error(r.error?.message||a.error?.message);setRequests(r.data||[]);setApprovals(a.data||[]);},[enabled,currentUser?.id]);
 useEffect(()=>{if(!enabled)return;void load().catch(e=>setError(e.message));const timer=setInterval(()=>void load().catch(e=>setError(e.message)),30000);return()=>clearInterval(timer);},[load,enabled]);
 async function review(r:Request,dismiss:boolean){setBusy(true);setError('');try{const result=await getSupabase().rpc('review_client_request',{request_id:r.id,selected_project:project[r.id]||null,dismiss});if(result.error)throw result.error;await load();await refresh?.();}catch(e){setError((e as {message:string}).message);}finally{setBusy(false);}}
 if(!enabled)return null;
 if(!requests.length&&!approvals.length&&!error)return null;
 return <section className="card stack"><h2>Owner review inbox</h2>{error&&<p role="alert">{error}</p>}
 {requests.length>0&&<h3>Client requests</h3>}{requests.map(r=><article className="card stack" key={r.id}><strong>{data.clients.find(c=>c.id===r.client_id)?.name} · {r.title}</strong><p>{r.description}</p><label>Project<select className="input" value={project[r.id]||''} onChange={e=>setProject({...project,[r.id]:e.target.value})}><option value="">Choose project</option>{data.projects?.filter(p=>p.clientId===r.client_id&&isAssignedProject(p)&&p.stage!=='completed').map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="row"><button className="btn btn-primary" disabled={busy||!project[r.id]} onClick={()=>void review(r,false)}>Add task</button><Link className="btn" to={`/client/${r.client_id}/projects?create=1`}>Add project</Link><button className="btn" disabled={busy} onClick={()=>void review(r,true)}>Dismiss request</button></div><p className="muted">Added tasks start private and are assigned to you. Adjust assignment and client visibility on the task.</p></article>)}
 {approvals.length>0&&<h3>Team project suggestions</h3>}{approvals.map(s=><article className="card" key={s.id}><strong>{s.title}</strong><p>{s.payload.client_name} · Suggested for {s.reviewer_name}</p><p>{s.description}</p><blockquote>{s.evidence}</blockquote><button className="btn btn-primary" onClick={()=>setEditing(s)}>Review and approve project</button><p className="muted">Approval creates the project and links the employee’s pending suggestions. It does not accept their tasks.</p></article>)}
 {editing&&<SotEditDialog key={editing.id} suggestion={editing} onClose={()=>setEditing(null)} onAdded={async()=>{await load();await refresh?.();}}/>}</section>;
}
