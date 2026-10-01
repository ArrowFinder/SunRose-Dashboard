import { useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabaseClient';
import type { Database } from '../lib/database.types';
type Profile=Database['public']['Tables']['sot_client_profiles']['Row'];
export function ClientIdentityCard({clientId}:{clientId:string}) {
 const [profile,setProfile]=useState<Profile|null>(null),[contacts,setContacts]=useState<string[]>([]);
 useEffect(()=>{let active=true;setProfile(null);setContacts([]);const db=getSupabase();void Promise.all([
  db.from('sot_client_profiles').select('*').eq('client_id',clientId).maybeSingle(),
  db.from('sot_client_contacts').select('email').eq('client_id',clientId),
 ]).then(([p,c])=>{if(active){setProfile(p.data);setContacts(c.data?.map(row=>row.email)||[]);}});return()=>{active=false;};},[clientId]);
 if(!profile&&!contacts.length)return null;
 return <details className="card"><summary>Client identity · used by SOT for future email matching</summary>
  <p>Known contacts: {contacts.join(', ')||'None saved'}</p>
  <p>Confirmed email domains: {profile?.domains?.join(', ')||'None saved'}</p>
  <p>Alternate names: {profile?.aliases.join(', ')||'None saved'}</p>
  <p>{[profile?.location,profile?.business_type].filter(Boolean).join(' · ')}</p>
  {profile?.website_url?<p>Approved website: <a href={profile.website_url} target="_blank" rel="noreferrer">{profile.website_url}</a></p>:<p className="muted">No website approved.</p>}
 </details>;
}
