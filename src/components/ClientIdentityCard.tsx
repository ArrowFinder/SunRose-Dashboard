import { useEffect, useState } from 'react';
import { useAppState } from '../context/AppStateContext';
import { isOwnerOrAdmin } from '../lib/permissions';
import { getSupabase } from '../lib/supabaseClient';
const list=(value:string)=>[...new Set(value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean))];
export function ClientIdentityCard({clientId}:{clientId:string}) {
 const {currentUser}=useAppState();const manage=isOwnerOrAdmin(currentUser);
 const [description,setDescription]=useState(''),[services,setServices]=useState(''),[notes,setNotes]=useState('');
 const [aliases,setAliases]=useState(''),[domains,setDomains]=useState(''),[contacts,setContacts]=useState('');
 const [loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;setLoaded(false);const db=getSupabase();void Promise.all([
  db.from('sot_client_profiles').select('*').eq('client_id',clientId).maybeSingle(),
  db.from('sot_client_contacts').select('email').eq('client_id',clientId),
 ]).then(([p,c])=>{if(!active)return;if(p.error||c.error){setMessage('Could not load client context. Reload before editing.');return;}setDescription(p.data?.description??'');setServices(p.data?.services??'');setNotes(p.data?.context_notes??'');setAliases(p.data?.aliases.join('\n')??'');setDomains(p.data?.domains.join('\n')??'');setContacts(c.data?.map(row=>row.email).join('\n')??'');setLoaded(true);}).catch(()=>{if(active)setMessage('Could not load client context.');});return()=>{active=false;};},[clientId]);
 return <section className="card"><h2>Private context for SOT</h2><p className="muted">Help SOT recognize this client and understand their work. These details are never included in the client-facing view. Changes inform future email analysis.</p>
 <form onSubmit={async e=>{e.preventDefault();setSaving(true);setMessage('');try{const r=await getSupabase().rpc('save_client_context',{cid:clientId,description_value:description,services_value:services,notes_value:notes,aliases_value:list(aliases),domains_value:list(domains.toLowerCase()),contacts_value:list(contacts.toLowerCase())});if(r.error)throw r.error;setMessage('Client context saved. SOT will use it for future email analysis.');}catch(e){setMessage(e instanceof Error?e.message:(e as {message?:string}).message??'Could not save context.');}finally{setSaving(false);}}}>
 <fieldset className="client-details-fields" disabled={!manage||!loaded||saving}>
 <label>Business description<textarea className="input" maxLength={2000} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <label>Services SunRose provides<textarea className="input" maxLength={2000} rows={3} value={services} onChange={e=>setServices(e.target.value)}/></label>
 <label>Internal notes & SOT guidance<textarea className="input" maxLength={4000} rows={4} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Example: City of El Segundo is a sponsor within our LA Times work, not a separate client."/></label>
 <div className="grid-2"><label>Confirmed contact emails<textarea className="input" rows={4} value={contacts} onChange={e=>setContacts(e.target.value)} placeholder="One address per line"/></label><label>Confirmed business email domains<textarea className="input" rows={4} value={domains} onChange={e=>setDomains(e.target.value)} placeholder="example.com — no @ or https://"/></label></div>
 <p className="muted">Use individual contacts for Gmail and other shared email services. A contact can belong to more than one client; SOT will ask for clarification when needed.</p>
 <label>Alternate business names<textarea className="input" rows={3} value={aliases} onChange={e=>setAliases(e.target.value)} placeholder="One name per line"/></label>
 {manage&&<button className="btn btn-primary">{saving?'Saving…':'Save SOT context'}</button>}
 </fieldset></form>{message&&<p role="status">{message}</p>}</section>;
}
