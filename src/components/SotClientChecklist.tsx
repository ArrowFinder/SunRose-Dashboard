import { useEffect, useState } from 'react';
import { useAppState } from '../context/AppStateContext';
import { getSupabase } from '../lib/supabaseClient';
import { sotAction, type SotSuggestion } from '../lib/sot';
export function SotClientChecklist({suggestion:s,disabled,onChanged}:{suggestion:SotSuggestion;disabled:boolean;onChanged:()=>Promise<void>}) {
 const {data}=useAppState();const p=s.payload,c=p.checklist;
 const [choice,setChoice]=useState(p.client_id||''),[relationship,setRelationship]=useState(false);
 const [query,setQuery]=useState([p.client_name,p.location,p.business_type].filter(Boolean).join(' ').slice(0,200));
 useEffect(()=>setQuery([p.client_name,p.location,p.business_type].filter(Boolean).join(' ').slice(0,200)),[p.client_name,p.location,p.business_type]);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();await onChanged();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
 const checks:[string,boolean][]=[['Business name',!!c?.business_name],['Email contact from the conversation',!!c?.contact_email],['Evidence of a Sunrose client relationship',!!c?.relationship_evidence],['Existing clients checked',!!c?.existing_clients_checked],['Business identity resolved',!!c?.identity_resolved]];
 return <div className="sot-client-checklist">
  <strong>{c?.ready?'Ready to add':'Needs clarification'}</strong>
  <ul>{checks.map(([label,ok])=><li key={label}><span aria-label={ok?'Complete':'Needs review'}>{ok?'✓':'○'}</span> {label}</li>)}</ul>
  {p.relationship_evidence&&<blockquote>{p.relationship_evidence}</blockquote>}
  {!c?.ready&&<div>
   <p>{c?.explanation||'Confirm the client relationship and business identity before adding.'}</p>
   <label htmlFor={`identity-${s.id}`}>Which business does this conversation concern?</label>
   <select id={`identity-${s.id}`} className="input" value={choice} disabled={disabled||busy} onChange={e=>setChoice(e.target.value)}>
    <option value="">Choose…</option><option value="new">A separate business: {p.client_name}</option>
    {data.clients.map(client=><option value={client.id} key={client.id}>{client.name}</option>)}
   </select>
   {!c?.relationship_evidence&&<label><input type="checkbox" checked={relationship} onChange={e=>setRelationship(e.target.checked)} disabled={disabled||busy}/> I confirm this business is requesting or receiving Sunrose’s services.</label>}
   <button className="btn" disabled={disabled||busy||!choice||(!c?.relationship_evidence&&!relationship)} onClick={()=>void run(async()=>{
    const r=await getSupabase().rpc('sot_confirm_identity',{suggestion_id:s.id,selected_client:choice==='new'?null:choice,separate_business:choice==='new',confirm_relationship:relationship});if(r.error)throw new Error(r.error.message);
   })}>Confirm business</button>
  </div>}
  {s.kind==='client'&&<details>
   <summary>Website and business details · optional</summary>
   <p>{[p.location,p.business_type].filter(Boolean).join(' · ')||'No location or business type found in the email.'}</p>
   <p>Alternate names: {p.aliases?.join(', ')||'None identified'}</p>
   <label htmlFor={`website-query-${s.id}`}>Public search query</label>
   <input id={`website-query-${s.id}`} className="input" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)} disabled={disabled||busy}/>
   <p className="muted">Only this query is sent to web search. Use the business name, city or industry—not private email details. A website is optional.</p>
   <button className="btn" disabled={disabled||busy||query.trim().length<2} onClick={()=>void run(async()=>{await sotAction('find_website',{suggestionId:s.id,query});})}>{busy?'Working…':'Find website'}</button>
   {p.website_candidate&&<div>
    <p>{p.website_candidate.explanation}</p>
    {p.website_candidate.url&&<p><a href={p.website_candidate.url} target="_blank" rel="noreferrer">{p.website_candidate.url}</a></p>}
    {p.website_candidate.sources.map((source,i)=><p key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></p>)}
    {p.website_candidate.url&&<button className="btn" disabled={disabled||busy} onClick={()=>void run(async()=>{const r=await getSupabase().rpc('sot_confirm_website',{suggestion_id:s.id,use_website:!p.website_confirmed});if(r.error)throw new Error(r.error.message);})}>{p.website_confirmed?'Website selected · Remove':'Use this website'}</button>}
   </div>}
  </details>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
