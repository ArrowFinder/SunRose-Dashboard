import { SotClientChecklist } from './SotClientChecklist';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppState } from '../context/AppStateContext';
import { isInternalUser } from '../lib/permissions';
import { getSupabase } from '../lib/supabaseClient';
import { sotAction, type SotConnection, type SotSuggestion, type SotNotification } from '../lib/sot';

export function SotReview() {
 const {cloud,currentUser,data,refresh}=useAppState();
 const [params,setParams]=useSearchParams();
 const [connection,setConnection]=useState<SotConnection|null>(null);
 const [suggestions,setSuggestions]=useState<SotSuggestion[]>([]);
 const [notifications,setNotifications]=useState<SotNotification[]>([]);
 const [loaded,setLoaded]=useState(false),[configured,setConfigured]=useState(false);
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
 const mounted=useRef(true),stop=useRef(false),running=useRef(false);
 const userId=currentUser?.id;
 const load=useCallback(async()=>{
  if(!cloud||!userId) return;
  const db=getSupabase();
  const results=await Promise.all([
   db.from('sot_connections').select('*').eq('user_id',userId).maybeSingle(),
   db.from('sot_suggestions').select('*').eq('user_id',userId).eq('status','pending').order('created_at').limit(200),
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
   await load();setMessage(`Reading your conversations… ${batches*3} or fewer threads checked this session.`);
  }
  if(mounted.current)setMessage(more?'Scan paused. Your progress is saved; choose Continue scan when ready.':'Scan complete. Review suggested clients first, then tasks.');
 },'scan');}
 useEffect(()=>{
  if(loaded&&configured&&connection&&params.get('connection')==='connected'){
   const next=new URLSearchParams(params);next.delete('connection');setParams(next,{replace:true});void scan();
  }
 },[loaded,configured,connection?.user_id,params]);
 if(!cloud||!isInternalUser(currentUser)) return null;
 async function decide(s:SotSuggestion,add:boolean){await run(async()=>{
  const {error}=await getSupabase().rpc(add?'sot_accept':'sot_dismiss',{suggestion_id:s.id});if(error)throw new Error(error.message);
  await load();await refresh?.();
  setMessage(add?(s.kind==='client'?'Client added. You can now add their suggested tasks.':s.kind==='task'?'Task is on the task list. Any matching existing task was kept without creating a duplicate.':'Task updated.'):'Suggestion deleted. Your email was not changed.');
 },s.id);}
 const sorted=[...suggestions].sort((a,b)=>Number(b.kind==='client')-Number(a.kind==='client'));
 return <section className="card sot-panel" aria-label="SOT — Source of Truth">
  <div className="row" style={{justifyContent:'space-between',flexWrap:'wrap'}}>
   <div><p className="sot-eyebrow">SOURCE OF TRUTH</p><h2>SOT · Task Suggestion List {suggestions.length>0&&<span className="badge">{suggestions.length}</span>}</h2></div>
   <span className="badge">You review. SOT prepares.</span>
  </div>
  <p className="muted">Discover clients and work from the last 90 days of received and sent email. Only you see your suggestions. Nothing becomes official until you add it.</p>
  {connection?<div className="sot-connection">
   <strong>{connection.email}</strong><span className="muted"> · Read-only Gmail access</span>
   <p className="muted">{connection.last_scan_at?`Last completed scan: ${new Date(connection.last_scan_at).toLocaleString()}`:'Ready for the initial 90-day scan.'}</p>
   <div className="row" style={{flexWrap:'wrap'}}>
    <button className="btn btn-primary" disabled={!!busy||!configured} onClick={()=>void scan()}>{busy==='scan'?'Reading email…':connection.scan_cursor?'Continue scan':'Scan emails'}</button>
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
  <div className="stack">{sorted.map(s=><article className="sot-suggestion" key={s.id}>
   <span className="badge">{s.kind==='client'?'Suggested client':s.kind==='complete'?'Suggested completion':s.kind==='update'?'Suggested update':s.payload.parent_id?'Suggested subtask':'Suggested task'}</span>
   <h3>{s.title}</h3><p>{s.description}</p>
   <p className="muted">Client: {s.payload.client_name}{s.kind!=='client'&&<> · {s.kind==='task'?`Assigned to: ${currentUser?.name}`:'Existing assignee stays unchanged'} · {s.payload.due_date?`Due: ${s.payload.due_date}`:'No deadline specified'}{s.payload.estimated_hours!==null?` · Estimated: ${s.payload.estimated_hours}h`:' · No hours estimate supplied'}</>}</p>
   {s.kind==='client'&&<p className="muted">{s.payload.contact_email} · Retainer starts at 0 hours until configured.</p>}
   {(s.kind==='client'||s.payload.checklist?.identity_resolved===false)&&<SotClientChecklist suggestion={s} disabled={!!busy} onChanged={load}/>}
   {s.kind==='update'&&<p className="muted">The description above will be appended to the task. Tracked hours remain unchanged.</p>}
   {s.payload.task_id && data.workItems.some(t=>t.id===s.payload.task_id) && (()=>{const t=data.workItems.find(t=>t.id===s.payload.task_id)!;return <p><Link to={`/client/${t.clientId}?month=${t.yearMonth}&task=${t.id}`}>Open existing task</Link></p>;})()}
   <details><summary>Why SOT suggested this</summary><blockquote>{s.evidence}</blockquote><p>{s.source_subject}</p>{connection&&<a href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(connection.email)}#all/${encodeURIComponent(s.source_thread)}`} target="_blank" rel="noreferrer">Open source email</a>}</details>
   <div className="row" style={{marginTop:'1rem'}}>
    <button className="btn btn-primary" disabled={!!busy||(s.kind==='client'&&!s.payload.checklist?.ready)||s.payload.checklist?.identity_resolved===false} onClick={()=>void decide(s,true)}>{busy===s.id?'Saving…':s.kind==='complete'?'Mark complete':s.kind==='update'?'Apply update':'Add'}</button>
    <button className="btn btn-danger" disabled={!!busy} onClick={()=>void decide(s,false)}>Delete</button>
   </div>
  </article>)}</div>
  {suggestions.length===200&&<p className="muted">Showing the first 200 suggestions. Review these to reveal the next ones.</p>}
 </section>;
}
