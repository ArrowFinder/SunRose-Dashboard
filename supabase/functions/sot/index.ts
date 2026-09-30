import { createClient } from 'npm:@supabase/supabase-js@2.103.2';
import { addresses, agencyRelated, bounded, gmailQuery, instructions, proposalSchema, STAFF_ROLES, STARTING_MAILBOX, validProposal, type Proposal } from './core.ts';
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
  const q=new URLSearchParams({q:gmailQuery(c.email,Date.parse(started)),maxResults:'3'});if(c.scan_cursor) q.set('pageToken',c.scan_cursor);
  const list=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/threads?'+q,{headers});
  const clients=checked(await db.from('clients').select('id,name').order('created_at').limit(300))||[];
  const tasks=checked(await db.from('work_items').select('id,client_id,parent_id,title,status,due_date,updated_at').order('updated_at',{ascending:false}).limit(300))||[];
  let made=0;
  for(const ref of list.threads||[]) {
   const thread=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/threads/'+encodeURIComponent(ref.id)+'?format=full',{headers});
   const cutoff=Date.parse(started)-90*86400000;
   const messages=(thread.messages||[]).filter((m:any)=>Number(m.internalDate)>=cutoff && !m.labelIds?.some((l:string)=>['TRASH','SPAM','DRAFT'].includes(l))).map((m:any)=>{
    const h=(name:string)=>m.payload?.headers?.find((h:any)=>h.name.toLowerCase()===name)?.value||'';
    return {id:m.id,messageId:h('message-id')||m.id,date:new Date(Number(m.internalDate)).toISOString(),from:h('from'),to:h('to'),cc:h('cc'),subject:h('subject'),body:bounded(body(m.payload||{}),9000)};
   }).filter((m:any)=>agencyRelated(m,c.email)).slice(-12);
   if(!messages.length) continue;
   const fingerprint=await hash(JSON.stringify(messages));
   const cached=checked(await db.from('sot_scan_cache').select('fingerprint').eq('user_id',uid).eq('thread_id',ref.id).maybeSingle());
   if(cached?.fingerprint===fingerprint) continue;
   const contacts=addresses(messages.map((m:any)=>m.from+' '+m.to+' '+m.cc).join(' '));
   // Bound the full request, including context, rather than silently creating an expensive scan.
   const context={clients:clients.slice(0,80),tasks:tasks.slice(0,60)};
   let selected=messages;
   const inputMessages=(items:any[])=>items.map(({id,messageId,...rest})=>({...rest,source_message_id:id}));
   let input=JSON.stringify({today:new Date().toISOString().slice(0,10),context,messages:inputMessages(selected)});
   while(new TextEncoder().encode(input).length>16000 && selected.length>1) {selected=selected.slice(1);input=JSON.stringify({context,messages:inputMessages(selected)});}
   if(new TextEncoder().encode(input).length>16000) {context.tasks=[];context.clients=clients.slice(0,30);selected=selected.map((m:any)=>({...m,body:bounded(m.body,8000)}));input=JSON.stringify({context,messages:inputMessages(selected)});}
   if(new TextEncoder().encode(input).length>16000) throw new Error('A conversation is too large to process safely. Contact the owner.');
   if(!checked(await db.rpc('sot_reserve_call'))) throw new Error('SOT reached its monthly scan allowance. Saved suggestions remain available; the scan can resume next month.');
   const response=await fetchJSON('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,instructions,input,max_output_tokens:2400,text:{format:{type:'json_schema',name:'sot_suggestions',strict:true,schema:proposalSchema}}})});
   if(response.status!=='completed') throw new Error('SOT could not finish reading a conversation. Retry the scan.');
   const output=response.output?.flatMap((o:any)=>o.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
   const proposals:Proposal[]=JSON.parse(output||'{}').suggestions;
   if(!Array.isArray(proposals)||proposals.length>8) throw new Error('SOT returned an incomplete suggestion. Retry the scan.');
   const rows=[];
   for(const p of proposals) {
    if(!validProposal(p,selected.map((m:any)=>m.id),contacts)) continue;
    if(p.client_id && !clients.some((x:any)=>x.id===p.client_id)) continue;
    const target=p.task_id?tasks.find((t:any)=>t.id===p.task_id):null;
    if(['update','complete'].includes(p.kind) && (!target || target.client_id!==p.client_id || tasks.some((t:any)=>t.parent_id===target.id))) continue;
    if(p.parent_id && !tasks.some((t:any)=>t.id===p.parent_id&&!t.parent_id&&t.client_id===p.client_id)) continue;
    const source=selected.find((m:any)=>m.id===p.source_message_id);
    const key=await hash(p.kind==='client'?'client:'+p.client_name.trim().toLowerCase():[p.kind,source.messageId,p.title.trim().toLowerCase(),p.task_id||''].join(':'));
    rows.push({kind:p.kind,dedupe_key:key,title:p.title,description:p.description,payload:{...p,expected_updated_at:target?.updated_at||null},source_subject:source.subject,evidence:p.evidence});
   }
   checked(await db.rpc('sot_store_thread',{uid,thread:ref.id,fingerprint_value:fingerprint,proposals:rows}));
   made+=rows.length;
  }
  const more=!!list.nextPageToken;
  checked(await db.from('sot_connections').update({scan_cursor:list.nextPageToken||null,scan_started_at:more?started:null,last_scan_at:more?c.last_scan_at:new Date().toISOString(),scanned_threads:(c.scan_started_at?c.scanned_threads:0)+(list.threads||[]).length}).eq('user_id',uid));
  return {more,created:made};
 } finally {await db.from('sot_scan_locks').delete().eq('user_id',uid).eq('lease_id',lease);}
}
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 try {
  if(req.method==='GET' && url.pathname.endsWith('/callback')) {
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
  const {action}=await req.json();
  if(action==='status') return json({configured:configured(),startingMailbox:STARTING_MAILBOX});
  if(action==='connect') {
   if(!configured()) return json({error:'Sierra’s Google connection setup is still needed.'},503);
   const state=crypto.randomUUID()+crypto.randomUUID();
   checked(await db.from('sot_oauth_states').delete().eq('user_id',user.id));
   checked(await db.from('sot_oauth_states').insert({state_hash:await hash(state),user_id:user.id,expires_at:new Date(Date.now()+600000).toISOString()}));
   return json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:env('GOOGLE_CLIENT_ID'),redirect_uri:callback,response_type:'code',scope,access_type:'offline',prompt:'consent select_account',state})});
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
