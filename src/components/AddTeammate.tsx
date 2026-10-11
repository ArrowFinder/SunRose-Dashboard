import {useRef,useState} from 'react';
import {getSupabase} from '../lib/supabaseClient';
import {useAppState} from '../context/AppStateContext';
import {isOwnerOrAdmin} from '../lib/permissions';
import type {UserRole} from '../lib/types';
export type CreatedTeammate={id:string;name:string;role:UserRole;email:string;setupLink:string};
export function AddTeammate({onCreated,onCancel}:{onCreated?:(member:CreatedTeammate)=>void;onCancel:()=>void}){
 const {currentUser,supportSnapshot,refresh}=useAppState();
 const requestId=useRef(crypto.randomUUID()),requestKey=useRef('');
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState<UserRole>('employee');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState<CreatedTeammate|null>(null),[copied,setCopied]=useState(false);
 if(!isOwnerOrAdmin(currentUser)||supportSnapshot)return null;
 async function save(){if(busy)return;setBusy(true);setError('');try{
  if(!name.trim()||!email.trim())throw new Error('Enter a name and email.');
  const key=JSON.stringify([name.trim(),email.trim().toLowerCase(),role]);if(requestKey.current!==key){requestKey.current=key;requestId.current=crypto.randomUUID();}
  const result=await getSupabase().functions.invoke('sot',{body:{action:'create_teammate',requestId:requestId.current,name:name.trim(),email:email.trim(),role}});
  if(result.error){let message='Could not create teammate. Try again.';try{message=(await result.error.context?.json())?.error||message;}catch{}throw new Error(message);}
  if(result.data?.error)throw new Error(result.data.error);
  const member=result.data as CreatedTeammate;setCreated(member);onCreated?.(member);await refresh?.();
 }catch(e){setError(e instanceof Error?e.message:'Could not create teammate.');}finally{setBusy(false);}}
 return <section className="inline-create stack" aria-label="Add teammate"><h3>Add teammate</h3>{!created?<>
 <label>Name<input className="input" maxLength={100} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
 <label>Email<input className="input" type="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={busy}/></label>
 <label>Role<select className="input" value={role} onChange={e=>setRole(e.target.value as UserRole)} disabled={busy}><option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option><option value="owner">Owner</option></select></label>
 <p className="muted">Creates a teammate you can assign work to now. No email is sent; share their setup link so they can choose a password.</p>
 <div className="row"><button type="button" className="btn btn-primary" disabled={busy||!name.trim()||!email.trim()} onClick={()=>void save()}>{busy?'Creating…':'Create teammate'}</button><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button></div>
 </>:<><p role="status">{created.name} is added. Share this private, one-use setup link only with {created.email}. It expires; generate a new link with the same details if needed before activation.</p><label>Setup link<input className="input" readOnly value={created.setupLink} onFocus={e=>e.target.select()}/></label><div className="row"><button type="button" className="btn" onClick={async()=>{try{await navigator.clipboard.writeText(created.setupLink);setCopied(true);}catch{setError('Select and copy the link above.');}}}>{copied?'Copied':'Copy setup link'}</button><button type="button" className="btn btn-primary" onClick={onCancel}>Done</button></div></>}
 {error&&<p role="alert">{error}</p>}</section>;
}
