import {useEffect,useState} from 'react';
import {getSupabase} from '../lib/supabaseClient';
export function SotRecovery({thread,onDone}:{thread:string;onDone:()=>void}){
 const [messages,setMessages]=useState<{id:string;subject:string;date:string;bytes:number}[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
 useEffect(()=>{let live=true;void getSupabase().rpc('sot_review_messages',{thread}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else{setMessages(r.data||[]);setLoaded(true);}});return()=>{live=false;};},[thread]);
 async function act(action:string){setBusy(true);setError('');try{const r=await getSupabase().rpc('sot_recover_thread',{thread,action,selected_ids:selected,reason});if(r.error)throw r.error;onDone();}catch(e){setError((e as {message?:string}).message||'Could not update review item');}finally{setBusy(false);}}
 return <div className="card stack"><p>Retrying queues another analysis within the existing budget. An interrupted earlier request may already have been billed. Unselected messages remain for review.</p>
 {messages.map(m=><label key={m.id}><input type="checkbox" disabled={busy} checked={selected.includes(m.id)} onChange={e=>setSelected(e.target.checked?[...selected,m.id]:selected.filter(id=>id!==m.id))}/> {new Date(m.date).toLocaleString()} · {m.subject} · {Math.ceil(m.bytes/1024)} KB</label>)}
 {loaded&&!messages.length&&<p>The saved email content is unavailable. Retry will retrieve it from Gmail first.</p>}
 <button className="btn" disabled={busy||!loaded||!!messages.length&&!selected.length} onClick={()=>void act('retry')}>Queue retry</button>
 <label>What did you do after reviewing in Gmail?<input className="input" maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="For example: added the task manually, or no action needed"/></label>
 <button className="btn" disabled={busy||reason.trim().length<3} onClick={()=>void act('resolve')}>Mark handled manually</button>{error&&<p role="alert">{error}</p>}</div>;
}
