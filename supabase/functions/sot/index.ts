import { resolveProject } from './projects.ts';
import { clientChecklist, clientContext, websiteRequest, websiteResult } from './identity.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.103.2';
import { addresses, agencyRelated, bounded, incrementalQuery, passInstructions, proposalSchema, STAFF_ROLES, STARTING_MAILBOX, validProposal, type Proposal } from './core.ts';
const env = (name: string) => Deno.env.get(name) || '';
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {auth:{persistSession:false,autoRefreshToken:false}});
const app = env('SOT_APP_URL') || 'https://arrowfinder.github.io/SunRose-Dashboard/';
const origin = new URL(app).origin;
const callback = env('SUPABASE_URL') + '/functions/v1/sot/callback';
const scope = 'https://www.googleapis.com/auth/gmail.readonly';
const cors = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const json = (data: unknown, status=200) => new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
function checked<T>(r:{data:T;error:unknown}):T {if(r.error) throw new Error('SOT could not save its progress. Please retry.');return r.data;}
async function hash(s:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
function base64(bytes:Uint8Array) {return btoa(String.fromCharCode(...bytes));}
function unbase64(value:string) {return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
async function crypt(value:string, decrypt=false) {
 const raw=unbase64(env('SOT_TOKEN_KEY')); if(raw.length!==32) throw new Error('Email encryption is not configured.');
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
 if(decrypt) {const [iv,data]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv)},key,unbase64(data)));}
 const iv=crypto.getRandomValues(new Uint8Array(12));return base64(iv)+'.'+base64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(value))));
}
async function fetchJSON(url:string, init:RequestInit={}) {
 const r=await fetch(url,{...init,signal:AbortSignal.timeout(35000)});
 if(!r.ok) throw new Error(r.status===401||r.status===403?'Email access expired or was denied. Reconnect Gmail.':r.status===429?'Provider limit reached. Try again later.':'Email or AI service is temporarily unavailable. Please retry.');
 return await r.json();
}
function configured(){return ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','SOT_TOKEN_KEY','OPENAI_API_KEY'].every(n=>!!env(n));}
async function staff(uid:string) {
 const p=checked(await db.from('profiles').select('role,active').eq('id',uid).single());
 if(!p?.active || !STAFF_ROLES.includes(p.role)) throw new Error('Active staff account required.');
}
async function token(uid:string) {
 const c=checked(await db.from('sot_credentials').select('encrypted_refresh').eq('user_id',uid).single());
 if(!c) throw new Error('Connect Gmail first.');
 return (await fetchJSON('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),client_secret:env('GOOGLE_CLIENT_SECRET'),refresh_token:await crypt(c.encrypted_refresh,true),grant_type:'refresh_token'})})).access_token as string;
}
function decode(data:string) {try {return new TextDecoder().decode(unbase64(data.replace(/-/g,'+').replace(/_/g,'/')));}catch{return '';}}
// Do not fetch attachments or remote content. Prefer plain text, fall back to inert HTML text.
function body(part:any):string {
 if(part.filename) return '';
 if(part.mimeType==='text/plain') return decode(part.body?.data||'');
 const parts=(part.parts||[]).filter((p:any)=>!p.filename);
 const plain=parts.filter((p:any)=>p.mimeType==='text/plain');
 if(plain.length) return plain.map(body).join('\n');
 if(parts.length) return parts.map(body).join('\n');
 return part.mimeType==='text/html'?decode(part.body?.data||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' '):'';
}
async function scan(uid:string) {
 const lease=crypto.randomUUID();
 if(!checked(await db.rpc('sot_claim_scan',{uid,lease}))) throw new Error('A scan is already running. Wait a moment and refresh.');
 try {
  const c=checked(await db.from('sot_connections').select('*').eq('user_id',uid).single());
  if(!c) throw new Error('Connect Gmail first.');
  const access=await token(uid), headers={Authorization:'Bearer '+access};
  const started=c.scan_started_at||new Date().toISOString();
  const q=new URLSearchParams({q:incrementalQuery(c.email,started,c.last_scan_at,c.scan_floor),maxResults:'1'});if(c.scan_cursor) q.set('pageToken',c.scan_cursor);
  if(!c.scan_started_at) checked(await db.from('sot_connections').update({scan_started_at:started,scanned_threads:0,last_error:null}).eq('user_id',uid));
  const list=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/threads?'+q,{headers});
  const clientRows=checked(await db.from('clients').select('id,name,archived_at').order('created_at').limit(1000))||[];
  const contactRows=checked(await db.from('sot_client_contacts').select('email,client_id').limit(3000))||[];
  const profiles=checked(await db.from('sot_client_profiles').select('client_id,aliases,domains,location,business_type,website_url,description,services,context_notes').limit(1000))||[];
  const clients=clientRows.map((c:any)=>({...c,...profiles.find((p:any)=>p.client_id===c.id),emails:contactRows.filter((r:any)=>r.client_id===c.id).map((r:any)=>r.email)}));
  const tasks=checked(await db.from('work_items').select('id,client_id,project_id,parent_id,title,status,due_date,updated_at,archived_at').order('updated_at',{ascending:false}).limit(300))||[];
  const projects=checked(await db.from('projects').select('id,client_id,name,description,stage').order('updated_at',{ascending:false}).limit(1000))||[];
  const reviews=checked(await db.from('sot_review_history').select('decision,reason,kind,client_name,contact_email,title').eq('user_id',uid).order('reviewed_at',{ascending:false}).limit(200))||[];
  let made=0;
  for(const ref of list.threads||[]) {
   const thread=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/threads/'+encodeURIComponent(ref.id)+'?format=full',{headers});
   const cutoff=Date.parse(started)-90*86400000;
   const messages=(thread.messages||[]).filter((m:any)=>Number(m.internalDate)>=cutoff && !m.labelIds?.some((l:string)=>['TRASH','SPAM','DRAFT'].includes(l))).map((m:any)=>{
    const h=(name:string)=>m.payload?.headers?.find((h:any)=>h.name.toLowerCase()===name)?.value||'';
    return {id:m.id,messageId:h('message-id')||m.id,date:new Date(Number(m.internalDate)).toISOString(),from:h('from'),to:h('to'),cc:h('cc'),subject:h('subject'),body:bounded(body(m.payload||{}),9000)};
   }).filter((m:any)=>agencyRelated(m,c.email)).slice(-12);
   if(!messages.length) continue;
   const fingerprint=await hash(JSON.stringify({messages,engine:'current-work-v3'}));
   const cached=checked(await db.from('sot_scan_cache').select('fingerprint').eq('user_id',uid).eq('thread_id',ref.id).maybeSingle());
   if(cached?.fingerprint===fingerprint) continue;
   const contacts=addresses(messages.map((m:any)=>m.from+' '+m.to+' '+m.cc).join(' '));
   // Bound the full request, including context, rather than silently creating an expensive scan.
   const relationship=clientContext(contacts,messages.map((m:any)=>m.subject+' '+m.body).join(' '),clients);
   const relevantClients=[...clients].sort((a:any,b:any)=>Number(relationship.candidates.some(c=>c.id===b.id))-Number(relationship.candidates.some(c=>c.id===a.id))).map((c:any)=>({...c,description:bounded(c.description||'',400),services:bounded(c.services||'',400),context_notes:bounded(c.context_notes||'',1600)}));
   const matched=relationship.matched;
   if(matched && clients.find((c:any)=>c.id===matched.id)?.archived_at) continue;
   const relevantReviews=reviews.filter((r:any)=>contacts.includes(r.contact_email)||r.client_name===matched?.name).slice(0,12);
   const context={clients:relevantClients.slice(0,80),projects:projects.filter((p:any)=>matched?p.client_id===matched.id:relationship.candidates.some(c=>c.id===p.client_id)).slice(0,30).map((p:any)=>({...p,description:bounded(p.description||'',500)})),tasks:tasks.filter((t:any)=>!matched||t.client_id===matched.id).slice(0,60),review_history:relevantReviews,matched_client:matched?.id||null,client_candidates:relationship.candidates.map(c=>c.id),allow_new_client:relationship.allowNewClient,current_window:{after:c.last_scan_at?new Date(Math.max(Date.parse(c.scan_floor),Date.parse(c.last_scan_at)-86400000)).toISOString():c.scan_floor,before:started},mailbox:c.email};
   let selected=messages;
   const inputMessages=(items:any[])=>items.map(({id,messageId,...rest})=>({...rest,source_message_id:id}));
   let input=JSON.stringify({today:new Date().toISOString().slice(0,10),context,messages:inputMessages(selected)});
   while(new TextEncoder().encode(input).length>16000 && selected.length>1) {selected=selected.slice(1);input=JSON.stringify({today:new Date().toISOString().slice(0,10),context,messages:inputMessages(selected)});}
   if(new TextEncoder().encode(input).length>16000) {context.tasks=[];context.projects=context.projects.map((p:any)=>({...p,description:''}));context.clients=relevantClients.slice(0,30);selected=selected.map((m:any)=>({...m,body:bounded(m.body,8000)}));input=JSON.stringify({today:new Date().toISOString().slice(0,10),context,messages:inputMessages(selected)});}
   while(new TextEncoder().encode(input).length>16000 && context.clients.length>1) {context.clients=context.clients.slice(0,-1);input=JSON.stringify({today:new Date().toISOString().slice(0,10),context,messages:inputMessages(selected)});}
   if(new TextEncoder().encode(input).length>16000) throw new Error('A conversation is too large to process safely. Contact the owner.');
   const passes:('clients'|'tasks')[]=relationship.allowNewClient?['clients','tasks']:['tasks'];
   if(!checked(await db.rpc('sot_reserve_current_calls',{calls:passes.length}))) throw new Error('SOT reached a spending limit (10 calls per three hours, 20 per UTC day, or the monthly allowance). Progress is saved; automatic checks will retry later.');
   const proposals:Proposal[]=[];
   for(const pass of passes) {
    const response=await fetchJSON('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,instructions:passInstructions(pass),input,max_output_tokens:2400,text:{format:{type:'json_schema',name:'sot_suggestions',strict:true,schema:proposalSchema}}})});
    if(response.status!=='completed') throw new Error('SOT could not finish reading a conversation. Retry the scan.');
    const output=response.output?.flatMap((o:any)=>o.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
    const found:Proposal[]=JSON.parse(output||'{}').suggestions;
    if(!Array.isArray(found)||found.length>8) throw new Error('SOT returned an incomplete suggestion. Retry the scan.');
    proposals.push(...found.filter(p=>pass==='clients'?p.kind==='client':p.kind!=='client'));
   }
   const rows=[];
   for(const p of proposals) {
    if(!validProposal(p,selected.map((m:any)=>m.id),contacts)) continue;
    if(p.kind==='client' && (p.relationship_type!=='client'||!relationship.allowNewClient)) continue;
    if(p.kind!=='client'&&matched) {p.client_id=matched.id;p.client_name=matched.name;}
    if(p.kind!=='client' && p.responsibility!=='sunrose') continue;
    if(p.kind==='client') {p.parent_id=null;p.task_id=null;p.due_date=null;p.estimated_hours=null;}
    if(p.client_id && !clients.some((x:any)=>x.id===p.client_id&&!x.archived_at)) continue;
    const target=p.task_id?tasks.find((t:any)=>t.id===p.task_id):null;
    if(['update','complete'].includes(p.kind) && (!target || target.archived_at || target.client_id!==p.client_id || tasks.some((t:any)=>t.parent_id===target.id))) continue;
    if(p.parent_id && !tasks.some((t:any)=>t.id===p.parent_id&&!t.parent_id&&t.client_id===p.client_id)) continue;
    const source=selected.find((m:any)=>m.id===p.source_message_id);
    if(Date.parse(source.date)<Date.parse(context.current_window.after)||Date.parse(source.date)>=Date.parse(started)) continue;
    const key=await hash(p.kind==='client'?'client:'+p.client_name.trim().toLowerCase():[p.kind,source.messageId,p.title.trim().toLowerCase(),p.task_id||''].join(':'));
    const checklist=clientChecklist(p,clients,source.body);
    if(p.kind==='client'&&!checklist.ready) continue;
    if(p.kind!=='client'&&matched) {checklist.identity_resolved=true;checklist.matched_client_id=matched.id;}
    if(p.kind!=='client'&&relationship.candidates.length>1) {checklist.ready=false;checklist.identity_resolved=false;checklist.possible_matches=relationship.candidates.map(c=>c.id);checklist.explanation='Multiple existing clients appear in this conversation. Confirm which client owns this work.';}
    if(!p.client_id && checklist.matched_client_id && checklist.identity_resolved) p.client_id=checklist.matched_client_id;
    if(p.kind==='client'&&checklist.matched_client_id&&checklist.identity_resolved) continue;
    rows.push({kind:p.kind,dedupe_key:key,title:p.title,description:p.description,payload:{...p,...resolveProject(p,context.projects,tasks,source.subject+' '+source.body),analysis_version:3,checklist,expected_updated_at:target?.updated_at||null},source_subject:source.subject,evidence:p.evidence});
   }
   checked(await db.rpc('sot_store_thread',{uid,thread:ref.id,fingerprint_value:fingerprint,proposals:rows}));
   made+=rows.length;
  }
  const more=!!list.nextPageToken;
  checked(await db.from('sot_connections').update({scan_cursor:list.nextPageToken||null,scan_started_at:more?started:null,last_scan_at:more?c.last_scan_at:started,last_error:null,next_scan_at:new Date(Date.now()+(more?60000:3*3600000)).toISOString(),scanned_threads:(c.scan_started_at?c.scanned_threads:0)+(list.threads||[]).length}).eq('user_id',uid));
  return {more,created:made};
 } catch(error) {
  const message=error instanceof Error?error.message:'Scan interrupted';
  const next=message.includes('monthly scan allowance')?new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()+1,1)):new Date(Date.now()+3*3600000);
  await db.from('sot_connections').update({last_error:message,next_scan_at:next.toISOString()}).eq('user_id',uid);
  throw error;
 } finally {await db.from('sot_scan_locks').delete().eq('user_id',uid).eq('lease_id',lease);}
}
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 try {
  if(req.method==='POST' && url.pathname.endsWith('/scheduled')) {
   const expected=env('SOT_SCHEDULER_KEY');
   const supplied=req.headers.get('x-sot-scheduler')||'';
   if(!expected||await hash(supplied)!==await hash(expected)) return json({error:'Unauthorized'},401);
   if(!configured()) return json({error:'SOT setup incomplete'},503);
   const due=checked(await db.from('sot_connections').select('user_id').eq('auto_scan',true).lte('next_scan_at',new Date().toISOString()).order('next_scan_at').limit(1));
   if(!due?.length) return json({idle:true});
   try {await staff(due[0].user_id);} catch {await db.from('sot_connections').update({auto_scan:false,last_error:'Account is no longer active staff.'}).eq('user_id',due[0].user_id);return json({skipped:true});}
   return json(await scan(due[0].user_id));
  }
  if(req.method==='GET'  && url.pathname.endsWith('/callback')) {
   const state=url.searchParams.get('state');if(!state) return json({error:'Missing authorization state'},400);
   const row=checked(await db.from('sot_oauth_states').delete().eq('state_hash',await hash(state)).gt('expires_at',new Date().toISOString()).select('user_id').maybeSingle());
   if(!row) return json({error:'Authorization expired. Reconnect from SunRose.'},400);
   await staff(row.user_id);
   if(url.searchParams.has('error')) return Response.redirect(app+'#/sot?connection=cancelled',303);
   const code=url.searchParams.get('code');if(!code) return json({error:'Missing authorization code'},400);
   const oauthLease=crypto.randomUUID();
   if(!checked(await db.rpc('sot_claim_scan',{uid:row.user_id,lease:oauthLease}))) throw new Error('A scan or connection change is in progress. Reconnect when it finishes.');
   try {
   const tokens=await fetchJSON('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code,client_id:env('GOOGLE_CLIENT_ID'),client_secret:env('GOOGLE_CLIENT_SECRET'),redirect_uri:callback,grant_type:'authorization_code'})});
   if(!tokens.refresh_token || !tokens.scope?.split(' ').includes(scope)) throw new Error('Gmail read access was not granted. Reconnect and approve read access.');
   const profile=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+tokens.access_token}});
   const old=checked(await db.from('sot_connections').select('email').eq('user_id',row.user_id).maybeSingle());
   if(old && old.email.toLowerCase()!==profile.emailAddress.toLowerCase()) throw new Error('Disconnect your existing mailbox before connecting another.');
   const encrypted=await crypt(tokens.refresh_token);
   checked(await db.from('sot_connections').upsert({user_id:row.user_id,email:profile.emailAddress}));
   checked(await db.from('sot_credentials').upsert({user_id:row.user_id,encrypted_refresh:encrypted}));
   return Response.redirect(app+'#/sot?connection=connected',303);
   } finally {await db.from('sot_scan_locks').delete().eq('user_id',row.user_id).eq('lease_id',oauthLease);}
  }
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  if(req.headers.get('origin') && req.headers.get('origin')!==origin) return json({error:'Origin not allowed'},403);
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'');
  if(!bearer) return json({error:'Sign in first'},401);
  const {data:{user},error}=await db.auth.getUser(bearer);if(error||!user) return json({error:'Sign in again'},401);
  await staff(user.id);
  const {action,suggestionId,query}=await req.json();
  if(action==='status') return json({configured:configured(),startingMailbox:STARTING_MAILBOX});
  if(action==='connect') {
   if(!configured()) return json({error:'Sierra’s Google connection setup is still needed.'},503);
   const state=crypto.randomUUID()+crypto.randomUUID();
   checked(await db.from('sot_oauth_states').delete().eq('user_id',user.id));
   checked(await db.from('sot_oauth_states').insert({state_hash:await hash(state),user_id:user.id,expires_at:new Date(Date.now()+600000).toISOString()}));
   return json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),redirect_uri:callback,response_type:'code',scope,access_type:'offline',prompt:'consent select_account',state})});
  }
  if(action==='find_website') {
   const s=checked(await db.from('sot_suggestions').select('id,kind,payload,updated_at').eq('id',suggestionId).eq('user_id',user.id).eq('status','pending').single());
   if(!s||s.kind!=='client') throw new Error('Pending client suggestion required.');
   if(typeof query!=='string'||query.trim().length<2||query.length>200) throw new Error('Enter a business name and optional city or business type (up to 200 characters).');
   if(!env('OPENAI_API_KEY')) throw new Error('SOT AI setup is incomplete.');
   if(!checked(await db.rpc('sot_reserve_website_search'))) throw new Error('The monthly website-search allowance has been reached. You can still add clients without a website.');
   const result=websiteResult(await fetchJSON('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify(websiteRequest(query.trim()))}));
   const saved=checked(await db.from('sot_suggestions').update({payload:{...s.payload,website_candidate:{...result,query:query.trim()},website_confirmed:false},updated_at:new Date().toISOString()}).eq('id',s.id).eq('user_id',user.id).eq('status','pending').eq('updated_at',s.updated_at).select('id'));
   if(!saved?.length) throw new Error('The suggestion changed during search. Refresh it before trying again.');
   return json({found:!!result.url});
  }
  if(action==='disconnect') {
   const lease=crypto.randomUUID();if(!checked(await db.rpc('sot_claim_scan',{uid:user.id,lease}))) throw new Error('Wait for the current scan to finish before disconnecting.');
   try {
    const c=checked(await db.from('sot_credentials').select('encrypted_refresh').eq('user_id',user.id).maybeSingle());
    if(c) {const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:await crypt(c.encrypted_refresh,true)}),signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==400) throw new Error('Could not revoke Google access. Retry disconnecting.');}
    checked(await db.from('sot_oauth_states').delete().eq('user_id',user.id));
    checked(await db.from('sot_connections').delete().eq('user_id',user.id));
    checked(await db.from('sot_suggestions').delete().eq('user_id',user.id).eq('status','pending'));
    return json({disconnected:true});
   } finally {await db.from('sot_scan_locks').delete().eq('user_id',user.id).eq('lease_id',lease);}
  }
  if(action==='scan') {if(!configured()) throw new Error('Email setup is incomplete.');return json(await scan(user.id));}
  return json({error:'Unknown action'},400);
 } catch(error) {
  // Never log provider payloads, tokens, email bodies, or Authorization headers.
  return json({error:error instanceof Error?error.message:'SOT could not complete this request.'},400);
 }
});
