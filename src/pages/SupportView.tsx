import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppStateContext, useAppState, type Ctx } from '../context/AppStateContext';
import { getSupabase } from '../lib/supabaseClient';
import { isOwnerOrAdmin } from '../lib/permissions';
import { userFromRow } from '../lib/cloud';
import type { SupportSnapshot } from '../lib/support';
import { Overview } from './Overview';
import { CalendarPage } from './CalendarPage';
import { SotReview } from '../components/SotReview';
import { taskSummary } from '../lib/taskTree';

export function SupportView(){
 const actor=useAppState(); const {userId}=useParams();
 if(!isOwnerOrAdmin(actor.currentUser))return <Navigate to="/" replace/>;
 return <SupportSession key={userId} targetId={userId||''} actor={actor}/>;
}
function SupportSession({targetId,actor}:{targetId:string;actor:Ctx}){
 const [snapshot,setSnapshot]=useState<SupportSnapshot|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{
  let cancelled=false;setSnapshot(null);setError('');
  void Promise.resolve(getSupabase().rpc('support_user_snapshot',{target_id:targetId})).then(({data,error})=>{
   if(cancelled)return;
   if(error||!data)setError(error?.message||'User unavailable.');else setSnapshot(data);
  }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Could not load user view.');});return()=>{cancelled=true;};
 },[targetId,reload]);
 const prefix=`/support/${targetId}`;
 const target=snapshot?userFromRow(snapshot.user):null;
 const value={...actor,currentUser:target,sessionUserId:targetId,supportSnapshot:snapshot||undefined,activeTimer:null,viewPath:(p:string)=>prefix+p} as Ctx;
 // This route only renders read-only components. Also block context mutations.
 for(const key of Object.keys(value) as (keyof Ctx)[]){
  if(typeof value[key]==='function'&&key!=='viewPath')Object.assign(value,{[key]:()=>{throw new Error('Exit support view to make changes.');}});
 }
 if(target?.role==='client'){
  const cv=snapshot?.clientView;
  value.data={clients:cv?[{...cv.client,color:cv.client.color||undefined,retainerHoursPerMonth:0,shareToken:''}]:[],workItems:cv?cv.items.map(w=>({...w,description:'',source:'internal',scopeCategory:'in_scope',estimatedHours:0,actualHours:0,priority:0,createdAt:'',updatedAt:''})):[],users:[target],timeEntries:[],taskTemplates:[]};
 }
 return <div className="stack">
  <section className="card support-banner" aria-label="Support viewing mode"><h1>Viewing {target?.name||'user'}’s dashboard</h1><p><strong>Read-only support view</strong> · You remain signed in as {actor.currentUser?.name}. No actions are performed as this user.</p>
   <div className="row"><Link className="btn btn-primary" to="/team">Exit to Team</Link><button className="btn" onClick={()=>setReload(n=>n+1)}>Refresh user view</button></div>
   <label>View another user <select className="input" value={targetId} onChange={e=>{window.location.hash=`/support/${e.target.value}`;}}>{actor.data.users.map(u=><option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}</select></label>
  </section>
  {error?<p role="alert">{error}</p>:!snapshot?<p role="status">Loading user view…</p>:snapshot.inactive?<p className="card">This account is inactive and cannot access the dashboard.</p>:<AppStateContext.Provider value={value}>
   {target?.role==='client'?<ReadOnlyWork/>:<>
    <nav className="row" aria-label="User dashboard sections"><Link className="btn" to={prefix}>Overview</Link><Link className="btn" to={prefix+'/sot'}>SOT</Link><Link className="btn" to={prefix+'/calendar'}>Calendar</Link><Link className="btn" to={prefix+'/clients'}>Clients</Link></nav>
    {snapshot.timer&&<p className="card">Running timer: {actor.data.workItems.find(w=>w.id===snapshot.timer?.work_item_id)?.title||'Task'} · Started {new Date(snapshot.timer.started_at).toLocaleString()}</p>}
    <Routes><Route index element={<Overview/>}/><Route path="sot" element={<SotReview/>}/><Route path="calendar" element={<CalendarPage/>}/><Route path="clients" element={<ReadOnlyWork/>}/><Route path="client/:clientId/*" element={<ReadOnlyWork/>}/><Route path="*" element={<Navigate to={prefix} replace/>}/></Routes>
   </>}
  </AppStateContext.Provider>}
 </div>;
}
function ReadOnlyWork(){
 const {data,currentUser,viewPath=(p:string)=>p}=useAppState();const {clientId,'*':rest}=useParams();
 const taskId=rest?.startsWith('task/')?rest.slice(5):null;
 const clientRole=currentUser?.role==='client';
 const clients=data.clients.filter(c=>!c.archivedAt&&(!clientId||c.id===clientId));
 if(!clients.length)return <p className="card">{clientRole?'This user has no active client access.':'Client unavailable.'}</p>;
 return <div className="stack">{clients.map(c=>{
 const items=data.workItems.filter(w=>w.clientId===c.id&&!w.archivedAt);
 const selected=items.find(w=>w.id===taskId);const root=selected?.parentId?items.find(w=>w.id===selected.parentId):selected;
 const shown=taskId?items.filter(w=>w.id===root?.id||w.parentId===root?.id):items;
 return <section className="card stack" key={c.id}><h2>{c.name}</h2>{!clientRole&&<Link to={viewPath(`/client/${c.id}`)}>Open client work</Link>}
 {!clientRole&&clientId&&!taskId&&<CalendarPage clientId={c.id}/>}
 {taskId&&!selected&&<p>Task unavailable.</p>}
 {shown.map(w=>{const summary=taskSummary(w,data.workItems,data.timeEntries);return <article className="card" key={w.id}><h3>{w.parentId?'↳ ':''}{clientRole?w.title:<Link to={viewPath(`/client/${c.id}/task/${w.id}`)}>{w.title}</Link>}</h3><p>{summary.status.replace('_',' ')} · Due: {w.dueDate||'Not scheduled'}{!clientRole&&` · ${data.users.find(u=>u.id===w.assignedUserId)?.name||'Unassigned'}`}</p>{summary.total>0&&<p>{summary.done}/{summary.total} subtasks complete</p>}{!clientRole&&<><p>{w.description}</p><p>Estimated: {summary.estimated}h · Actual: {summary.actual.toFixed(2)}h</p>{data.timeEntries.filter(t=>t.workItemId===w.id).map(t=><p className="muted" key={t.id}>{data.users.find(u=>u.id===t.userId)?.name||'Team member'} · {t.durationMinutes} minutes · {new Date(t.startedAt).toLocaleString()}{t.voidedAt?' · Voided':''}{t.note?` · ${t.note}`:''}</p>)}</>}</article>;})}
 {!shown.length&&<p>No tasks to display.</p>}
 </section>;})}</div>;
}
