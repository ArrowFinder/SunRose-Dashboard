import { SotProjectContext } from "./SotProjectContext";
import { SotEditDialog } from "./SotEditDialog";
import { hexOrDefault } from "../lib/color";
import { SotClientChecklist } from './SotClientChecklist';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isInternalUser, isOwnerOrAdmin } from '../lib/permissions';
import { getSupabase } from '../lib/supabaseClient';
import { sotAction, type SotConnection, type SotSuggestion, type SotNotification } from '../lib/sot';

export function SotReview() {
 const {supportSnapshot}=useAppState();
 return supportSnapshot ? <SupportSotReview/> : <LiveSotReview/>;
}
function SupportSotReview(){
 const {supportSnapshot:s,currentUser,data}=useAppState();
 return <section className="card stack" aria-label="SOT — Source of Truth"><h2>SOT · Suggestions {s?.suggestions?.length||0}</h2>
 <p className="muted">Read-only suggestions for {currentUser?.name}. Review actions are available in their own account.</p>
 <p>{s?.connection?`${s.connection.email} · ${s.connection.auto_scan?'Automatic checks enabled':'Automatic checks paused'}`:'Gmail is not connected.'}</p>
 {s?.connection?.last_error&&<p role="status">Scan paused: {s.connection.last_error}</p>}
 {s?.notifications?.map(n=><p key={n.id}>{n.message}</p>)}
 {!s?.suggestions?.length&&<p>No pending suggestions.</p>}
 {s?.suggestions?.map(item=><article className="card" key={item.id} style={{borderLeft:`5px solid ${data.clients.find(c=>c.id===item.payload.client_id)?hexOrDefault(data.clients.find(c=>c.id===item.payload.client_id)!):"#78716c"}`}}><span className="badge">{({client:'Possible client',project:'Suggested project',task:'Suggested task',update:'Task update',complete:'Task completion'})[item.kind]}</span><h3>{item.title}</h3><SotProjectContext suggestion={item}/><p>{item.description}</p>{item.payload.uncertainty&&<p><strong>Needs review:</strong> {item.payload.uncertainty}</p>}<p className="muted">Client: {data.clients.find(c=>c.id===item.payload.client_id)?.name||item.payload.client_name}{item.kind!=='project'&&<> · Assigned to: {currentUser?.name} · {item.payload.due_date||'No deadline specified'}</>}</p>{(item.kind==='client'&&!item.payload.checklist?.ready||item.payload.checklist?.identity_resolved===false)&&<p>Needs clarification: {item.payload.checklist?.explanation||'Confirm the client relationship before adding.'}</p>}<blockquote>{item.evidence}</blockquote><details><summary>Source email</summary>{item.source_subject}</details></article>)}
 </section>;
}
function LiveSotReview() {
 const [editing,setEditing]=useState<SotSuggestion|null>(null);
 const {cloud,currentUser,data,refresh}=useAppState();
 const [params,setParams]=useSearchParams();
 const [connection,setConnection]=useState<SotConnection|null>(null);
 const [suggestions,setSuggestions]=useState<SotSuggestion[]>([]);
 const [notifications,setNotifications]=useState<SotNotification[]>([]);
 const [loaded,setLoaded]=useState(false),[configured,setConfigured]=useState(false);
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
 const mounted=useRef(true),stop=useRef(false),running=useRef(false);
 const [reasons,setReasons]=useState<Record<string,string>>({});
 const userId=currentUser?.id;
 const load=useCallback(async()=>{
  if(!cloud||!userId) return;
  const db=getSupabase();
  const results=await Promise.all([
   db.from('sot_connections').select('*').eq('user_id',userId).maybeSingle(),
   db.from('sot_suggestions').select('*').eq('user_id',userId).eq('status','pending').is('archived_at',null).order('created_at',{ascending:false}).limit(200),
   db.from('sot_notifications').select('*').eq('recipient_id',userId).is('read_at',null).order('created_at',{ascending:false}).limit(50),
  ]);
  if(results.some(r=>r.error)) throw new Error('SOT setup is not complete yet. Your existing dashboard is still available.');
  if(mounted.current){setConnection(results[0].data);setSuggestions(results[1].data||[]);setNotifications(results[2].data||[]);setLoaded(true);}
 },[cloud,userId]);
 useEffect(()=>{mounted.current=true;stop.current=false;return()=>{mounted.current=false;stop.current=true;};},[]);
 useEffect(()=>{
  if(!cloud||!isInternalUser(currentUser)) return;
  void load().catch(e=>setError(e.message));
  void sotAction('status').then(r=>setConfigured(!!r.configured)).catch(()=>setConfigured(false));
  const id=setInterval(()=>{if(!running.current) void load().catch(e=>setError(e.message));},30000);
  return()=>clearInterval(id);
 },[load,cloud,currentUser?.role]);
 async function run(fn:()=>Promise<void>,label:string){if(running.current)return;running.current=true;setBusy(label);setError('');setMessage('');try{await fn();}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Please try again.');}finally{running.current=false;if(mounted.current)setBusy('');}}
 async function scan(){await run(async()=>{
  stop.current=false;
  let more=true,batches=0;
  while(more&&!stop.current&&batches<100){
   const result=await sotAction('scan');more=!!result.more;batches++;
   if(!mounted.current)return;
   await load();setMessage(`Reading your conversations… ${batches} or fewer threads checked this session.`);
  }
  if(mounted.current)setMessage(more?'Scan paused. Your progress is saved; choose Continue scan when ready.':'Scan complete. Review current task suggestions.');
 },'scan');}
 useEffect(()=>{
  if(loaded&&configured&&connection&&params.get('connection')==='connected'){
   const next=new URLSearchParams(params);next.delete('connection');setParams(next,{replace:true});void scan();
  }
 },[loaded,configured,connection?.user_id,params]);
 if(!cloud||!isInternalUser(currentUser)) return null;
 async function decide(s:SotSuggestion,add:boolean){await run(async()=>{
  const {error}=add?await getSupabase().rpc('sot_accept',{suggestion_id:s.id}):await getSupabase().rpc('sot_dismiss_with_reason',{suggestion_id:s.id,reason:reasons[s.id]||'unspecified'});if(error)throw new Error(error.message);
  await load();await refresh?.();
  setMessage(add?(s.kind==='project'?'Project added. Related tasks still await your review.':s.kind==='client'?'Client added. You can now add their suggested tasks.':s.kind==='task'?'Task is on the task list. Any matching existing task was kept without creating a duplicate.':'Task updated.'):'Suggestion deleted. Your email was not changed.');
 },s.id);}
 const sorted=[...suggestions].sort((a,b)=>({client:0,project:1,task:2,update:2,complete:2}[a.kind])-({client:0,project:1,task:2,update:2,complete:2}[b.kind]));
 return <section className="card sot-panel" aria-label="SOT — Source of Truth">
  <div className="row" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
   <div><p className="sot-eyebrow">SOURCE OF TRUTH</p><h2>SOT · Suggestions {suggestions.length>0&&<span className="badge">{suggestions.length}</span>}</h2></div>
   <span className="badge">You review. SOT prepares.</span>
  </div>
  <p className="muted">Find current work in received and sent email, starting with the last seven days. Existing client relationships come first. Only you see your suggestions. Nothing becomes official until you add it.</p>
  {connection?<div className="sot-connection">
   <strong>{connection.email}</strong><span className="muted"> · Read-only Gmail access</span>
   <p className="muted">{connection.last_scan_at?`Last completed scan: ${new Date(connection.last_scan_at).toLocaleString()}`:connection.scan_started_at?`Recent email scan in progress · ${connection.scanned_threads} conversations checked.`:'Ready to check the last seven days of email.'}</p>
   <p className="muted">AI allowance: up to 10 calls per three hours and 20 per day across the workspace, within the monthly limit. Earlier unreviewed suggestions are retained outside this list.</p>
   {connection.last_error&&<p role="alert">Scan paused: {connection.last_error}</p>}
   <p className="muted">{connection.auto_scan?'Automatic checks run every three hours; small batches continue between checks within spending limits.':'Automatic checks are paused.'} Next eligible check: {new Date(connection.next_scan_at).toLocaleString()}.</p>
   <button className="btn" disabled={!!busy} onClick={()=>void run(async()=>{const r=await getSupabase().rpc('sot_set_auto_scan',{enabled:!connection.auto_scan});if(r.error)throw new Error(r.error.message);await load();},'auto')}>{connection.auto_scan?'Pause automatic checks':'Enable automatic checks'}</button>
   <div className="row" style={{flexWrap:'wrap'}}>
    <button className="btn btn-primary" disabled={!!busy||!configured} onClick={()=>void scan()}>{busy==='scan'?'Reading email…':connection.scan_cursor?'Continue scan':'Scan recent emails'}</button>
    {busy==='scan'&&<button className="btn" onClick={()=>{stop.current=true;setMessage('Pausing after the current batch…');}}>Pause scan</button>}
    <button className="btn" disabled={!!busy||!configured} onClick={()=>void run(async()=>{const r=await sotAction('connect');if(r.url)window.location.assign(r.url);},'connect')}>Reconnect</button>
    <button className="btn btn-danger" disabled={!!busy} onClick={()=>void run(async()=>{await sotAction('disconnect');await load();setMessage('Gmail disconnected. Pending suggestions were removed; accepted tasks remain.');},'disconnect')}>Disconnect Gmail</button>
   </div>
  </div>:<div className="sot-connection">
   <button className="btn btn-primary" disabled={!!busy||!configured} onClick={()=>void run(async()=>{const r=await sotAction('connect');if(r.url)window.location.assign(r.url);},'connect')}>Connect Gmail</button>
   <p className="muted">{configured?'SOT reads relevant conversations to suggest work. Relevant email text is processed by OpenAI; attachments are not scanned. It cannot send or delete emails.':'Google connection setup is pending. Sierra’s starting mailbox is sierra@sunrosecreative.com.'}</p>
  </div>}
  {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {notifications.length>0&&<div className="stack"><h3>New tasks from SOT</h3>{notifications.map(n=>{const task=data.workItems.find(t=>t.id===n.task_id);return <div className="sot-notification" key={n.id}><p>{n.message}</p><div className="row">{task&&<Link to={`/client/${task.clientId}?month=${task.yearMonth}&task=${task.id}`}>View task</Link>}<button className="btn btn-ghost" disabled={!!busy} onClick={()=>void run(async()=>{const r=await getSupabase().rpc('sot_mark_read',{notification_id:n.id});if(r.error)throw new Error(r.error.message);await load();},n.id)}>Mark read</button></div></div>;})}</div>}
  {loaded&&suggestions.length===0&&<p className="muted">No suggestions waiting for review.{connection?' Scan emails to look for client requests.':''}</p>}
  <div className="stack">{sorted.map((s,i)=><div key={s.id}>{(i===0||(['client','project'].includes(sorted[i-1].kind)?sorted[i-1].kind:'work')!==(['client','project'].includes(s.kind)?s.kind:'work'))&&<h3>{s.kind==='client'?'Possible Clients':s.kind==='project'?'Suggested Projects':'Task Suggestions'}</h3>}<article className="sot-suggestion" key={s.id} style={{borderLeft:`5px solid ${data.clients.find(c=>c.id===s.payload.client_id)?hexOrDefault(data.clients.find(c=>c.id===s.payload.client_id)!):"#78716c"}`}}>
   <span className="badge">{s.kind==='client'?'Suggested client':s.kind==='project'?'Suggested project':s.kind==='complete'?'Suggested completion':s.kind==='update'?'Suggested update':s.payload.parent_id?'Suggested subtask':'Suggested task'}</span>
   {![3,4].includes(s.payload.analysis_version||0)&&<p role="status">From the earlier scan: reassess this suggestion before adding it.</p>}
   <h3>{s.title}</h3><SotProjectContext suggestion={s}/><p>{s.description}</p>{s.payload.uncertainty&&<p role="status"><strong>Needs review:</strong> {s.payload.uncertainty}</p>}
   <p className="muted">Client: {s.payload.client_name}{!['client','project'].includes(s.kind)&&<> · {s.kind==='task'?`Assigned to: ${currentUser?.name}`:'Existing assignee stays unchanged'} · {s.payload.due_date?`Due: ${s.payload.due_date}`:'No deadline specified'}{s.payload.estimated_hours!==null?` · Estimated: ${s.payload.estimated_hours}h`:' · No hours estimate supplied'}</>}</p>
   {s.kind==='client'&&<p className="muted">{s.payload.contact_email} · Retainer starts at 0 hours until configured.</p>}
   {(s.kind==='client'||s.payload.checklist?.identity_resolved===false)&&<SotClientChecklist suggestion={s} disabled={!!busy} onChanged={load}/>}
   {s.kind==='update'&&<p className="muted">The description above will be appended to the task. Tracked hours remain unchanged.</p>}
   {s.payload.task_id && data.workItems.some(t=>t.id===s.payload.task_id) && (()=>{const t=data.workItems.find(t=>t.id===s.payload.task_id)!;return <p><Link to={`/client/${t.clientId}?month=${t.yearMonth}&task=${t.id}`}>Open existing task</Link></p>;})()}
   <details><summary>Why SOT suggested this</summary><blockquote>{s.evidence}</blockquote><p>{s.source_subject}</p>{connection&&<a href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(connection.email)}#all/${encodeURIComponent(s.source_thread)}`} target="_blank" rel="noreferrer">Open source email</a>}</details>
   {s.kind==='project'&&<><p>Related task suggestions: {suggestions.filter(t=>t.kind==='task'&&t.payload.project_proposal_key===s.dedupe_key).length}. These are not added automatically.</p>{!isOwnerOrAdmin(currentUser)&&<p>An Owner/Admin must create this project. You can still review or dismiss this proposal.</p>}{s.payload.supporting_sources?.length&&<details><summary>Supporting conversations ({s.payload.supporting_sources.length})</summary>{s.payload.supporting_sources.map((proof,i)=><div key={i}><strong>{proof.subject}</strong><blockquote>{proof.quote}</blockquote>{connection&&<a href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(connection.email)}#all/${encodeURIComponent(proof.thread)}`} target="_blank" rel="noreferrer">Open source email</a>}</div>)}</details>}</>}
   <label>Reason if deleting (optional)<select value={reasons[s.id]||'unspecified'} onChange={e=>setReasons({...reasons,[s.id]:e.target.value})}><option value="unspecified">Just dismiss this suggestion</option><option value="vendor">Vendor, not a client</option><option value="sponsor_partner">Sponsor or partner</option><option value="not_client">Not a client</option><option value="duplicate">Duplicate</option><option value="already_done">Already completed</option><option value="not_our_responsibility">Someone else's responsibility</option><option value="not_actionable">Not actionable</option></select></label>
   <div className="row" style={{marginTop:'1rem'}}>
    <button className="btn btn-primary" disabled={!!busy||(s.kind==='project'&&!isOwnerOrAdmin(currentUser))||(s.kind==='task'&&!s.payload.project_id&&!s.payload.parent_id)||![3,4].includes(s.payload.analysis_version||0)||(s.kind==='client'&&!s.payload.checklist?.ready)||s.payload.checklist?.identity_resolved===false} onClick={()=>void decide(s,true)}>{busy===s.id?'Saving…':s.kind==='project'?'Add project':s.kind==='complete'?'Mark complete':s.kind==='update'?'Apply update':'Add'}</button>
    {s.kind!=="complete"&&<button className="btn" disabled={!!busy||(s.kind==='project'&&!isOwnerOrAdmin(currentUser))||![3,4].includes(s.payload.analysis_version||0)} onClick={()=>setEditing(s)}>Edit before adding</button>}
    <button className="btn btn-danger" disabled={!!busy} onClick={()=>void decide(s,false)}>Delete</button>
   </div>
  </article></div>)}</div>
  {editing&&<SotEditDialog key={editing.id} suggestion={editing} onClose={()=>setEditing(null)} onAdded={async()=>{await load();await refresh?.();}}/>}
  {suggestions.length===200&&<p className="muted">Showing the first 200 suggestions. Review these to reveal the next ones.</p>}
 </section>;
}
