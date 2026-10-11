import {createTeammate} from './team.ts';
import { allPages, relevantWork } from './context.ts';
import { cleanMessages, byteSize } from './sections.ts';
import { packRelated, pacificHour, tokenCost, BATCH_RULES } from './batches.ts';
import {validateBatchThread} from './validation.ts';
import { clientContext, websiteRequest, websiteResult } from './identity.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.103.2';
import { addresses, agencyRelated, bounded, incrementalQuery, instructions, proposalSchema, STAFF_ROLES, STARTING_MAILBOX } from './core.ts';
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
 return part.mimeType==='text/html'?decode(part.body?.data||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|tr)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' '):'';
}

async function scan(uid:string,manual=false) {
 const lease=crypto.randomUUID();
 if(!checked(await db.rpc('sot_claim_scan',{uid,lease})))throw new Error('A scan is already running. Wait a moment and refresh.');
 const runId=crypto.randomUUID();let made=0;
 try {
  const budget=()=>db.rpc('sot_budget',{manual}).then(checked);
  let allowance:any=await budget();
  if(!manual&&pacificHour(new Date())<6){checked(await db.from('sot_connections').update({next_scan_at:allowance.next_check,scan_status:'scheduled'}).eq('user_id',uid));return {more:false,created:0};}
  checked(await db.from('sot_scan_runs').insert({id:runId,user_id:uid}));
  const c:any=checked(await db.from('sot_connections').select('*').eq('user_id',uid).single());
  checked(await db.from('sot_connections').update({last_attempt_at:new Date().toISOString(),scan_status:'running',section_progress:null}).eq('user_id',uid));
  // A saved answer is replayed without another AI request. A lost response is never silently charged again.
  let job:any=checked(await db.from('sot_batch_jobs').select('*').eq('user_id',uid).in('status',['prepared','reserved','answered']).order('created_at').limit(1).maybeSingle());
  if(job?.status==='reserved'){
   for(const t of job.snapshot.threads)checked(await db.from('sot_mail_queue').update({status:'review',reason:'An AI request was interrupted. Review is needed before retrying to avoid duplicate charges.'}).eq('user_id',uid).eq('thread_id',t.thread_id));
   checked(await db.from('sot_batch_jobs').update({status:'review',reason:'Response not saved',finished_at:new Date().toISOString()}).eq('id',job.id));job=null;
  }
  const clientRows:any[]=await allPages((a,b)=>db.from('clients').select('id,name,archived_at').order('id').range(a,b));
  const contactRows:any[]=await allPages((a,b)=>db.from('sot_client_contacts').select('email,client_id').order('email').order('client_id').range(a,b));
  const profiles:any[]=await allPages((a,b)=>db.from('sot_client_profiles').select('client_id,aliases,domains,location,business_type,website_url,description,services,context_notes').order('client_id').range(a,b));
  const clients=clientRows.map(c=>({...c,...profiles.find(p=>p.client_id===c.id),emails:contactRows.filter(r=>r.client_id===c.id).map(r=>r.email)}));
  let tasks:any[]=[],projects:any[]=[];
  const reviews:any[]=checked(await db.from('sot_review_history').select('decision,reason,kind,client_name,contact_email,title').eq('user_id',uid).order('reviewed_at',{ascending:false}).limit(200))||[];
  const pending:any[]=await allPages((a,b)=>db.from('sot_suggestions').select('id,kind,title,description,payload,status,archived_at,source_subject,evidence').eq('user_id',uid).order('id').range(a,b));
  const relationshipFor=(t:any)=>clientContext(addresses(t.payload.messages.map((m:any)=>m.from+' '+m.to+' '+m.cc).join(' ')),t.payload.messages.map((m:any)=>m.subject+' '+m.body).join(' '),clients);
  const loadContext=async(threads:any[])=>{
   const ids=[...new Set(threads.flatMap(t=>relationshipFor(t).candidates.map((x:any)=>x.id)))];
   if(!ids.length)return;
   tasks=await allPages((a,b)=>db.from('work_items').select('id,client_id,project_id,parent_id,title,status,due_date,updated_at,archived_at').in('client_id',ids).order('id').range(a,b));
   projects=await allPages((a,b)=>db.from('projects').select('id,client_id,name,description,stage').in('client_id',ids).order('id').range(a,b));
  };
  const contextFor=(t:any)=>{
   const rel=relationshipFor(t),ids=rel.candidates.map(x=>x.id),text=t.payload.messages.map((m:any)=>m.subject+' '+m.body).join(' ');
   const clientTasks=tasks.filter(x=>ids.includes(x.client_id)),clientProjects=projects.filter(x=>ids.includes(x.client_id));
   return {mailbox:c.email,allow_new_client:rel.allowNewClient,matched_client:rel.matched?.id||null,client_candidates:ids,
    clients:(ids.length?clients.filter(x=>ids.includes(x.id)):clients).slice(0,80).map(x=>({...x,description:bounded(x.description||'',400),services:bounded(x.services||'',400),context_notes:bounded(x.context_notes||'',1200)})),
    projects:relevantWork(clientProjects,text,30).map(x=>({...x,description:bounded(x.description||'',400)})),
    tasks:relevantWork(clientTasks,text,60),
    omitted_context:{tasks:Math.max(0,clientTasks.length-60),projects:Math.max(0,clientProjects.length-30)},
    unconfirmed_suggestions:pending.filter(x=>ids.includes(x.payload.client_id)).slice(0,20).map(x=>({id:x.id,kind:x.kind,status:x.status,title:x.title,client_id:x.payload.client_id,project_id:x.payload.project_id})),
    review_history:reviews.filter(x=>x.client_name===rel.matched?.name).slice(0,12)};
  };
  let collecting=!!c.collection_cursor;
  if(!job){
   const access=await token(uid),headers={Authorization:'Bearer '+access};
   const stale=c.collection_started&&Date.now()-Date.parse(c.collection_started)>3*3600000;
   const started=!stale&&c.collection_started?c.collection_started:new Date().toISOString();
   const floor=new Date(Math.max(Date.parse(c.scan_floor),Date.parse(c.collected_through||started)-7*86400000)).toISOString();
   const query=new URLSearchParams({q:incrementalQuery(c.email,started,c.collected_through,floor),maxResults:'3'});
   if(c.collection_cursor&&!stale)query.set('pageToken',c.collection_cursor);
   const list=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/threads?'+query,{headers});
   // Bound collection work per invocation. Its cursor never depends on completing AI work.
   const retries:any[]=checked(await db.from('sot_fetch_retries').select('thread_id,scan_after').eq('user_id',uid).order('last_failed_at').limit(2))||[];
   const refs=[...new Map([...retries.map(r=>({id:r.thread_id})),...(list.threads||[])].map(r=>[r.id,r])).values()];
   for(const ref of refs){
    let thread:any;
    try {thread=await fetchJSON('https://gmail.googleapis.com/gmail/v1/users/me/threads/'+encodeURIComponent(ref.id)+'?format=full',{headers});}
    catch {checked(await db.rpc('sot_record_fetch_failure',{uid,thread:ref.id,since_time:floor}));continue;}
    const clearRetry=async()=>checked(await db.from('sot_fetch_retries').delete().eq('user_id',uid).eq('thread_id',ref.id));
    const raw=(thread.messages||[]).filter((m:any)=>Number(m.internalDate)>=Date.parse(started)-90*86400000&&Number(m.internalDate)<Date.parse(started)&&!m.labelIds?.some((l:string)=>['TRASH','SPAM','DRAFT'].includes(l))).map((m:any)=>{
     const h=(n:string)=>m.payload?.headers?.find((x:any)=>x.name.toLowerCase()===n)?.value||'';
     return {id:m.id,messageId:h('message-id')||m.id,date:new Date(Number(m.internalDate)).toISOString(),from:h('from'),to:h('to'),cc:h('cc'),subject:h('subject'),body:body(m.payload||{})};
    }).filter((m:any)=>agencyRelated(m,c.email));
    if(!raw.length){await clearRetry();continue;}
    const fingerprint=await hash(JSON.stringify({messages:raw,engine:'sections-v5'}));
    const old:any=checked(await db.from('sot_mail_queue').select('fingerprint,status,payload,oldest_at,resolved_through').eq('user_id',uid).eq('thread_id',ref.id).maybeSingle());
    if(old?.fingerprint===fingerprint&&(old.status==='done'||old.payload.messages?.length)){await clearRetry();continue;}
    const cache:any=checked(await db.from('sot_scan_cache').select('fingerprint').eq('user_id',uid).eq('thread_id',ref.id).maybeSingle());
    const legacy=await hash(JSON.stringify({messages:raw.map((m:any)=>({...m,body:bounded(m.body,9000)})).slice(-12),engine:'truth-v4'}));
    if(!old&&(cache?.fingerprint===fingerprint||cache?.fingerprint===legacy)){
     const known=cache?.fingerprint===fingerprint?raw:raw.slice(-12);
     checked(await db.from('sot_message_receipts').upsert(known.map((m:any)=>({user_id:uid,message_id:m.id})),{onConflict:'user_id,message_id',ignoreDuplicates:true}));await clearRetry();continue;
    }
    const receipts:any[]=checked(await db.from('sot_message_receipts').select('message_id').eq('user_id',uid).in('message_id',raw.map((m:any)=>m.id)))||[];
    const seen=new Set(receipts.map(r=>r.message_id));
    // Collection watermark is deliberately separate from analysis receipts. Queued mail never expires out of review.
    let after=c.collected_through?Math.max(Date.parse(floor),Date.parse(c.collected_through)-86400000):Math.max(Date.parse(floor),Date.parse(started)-7*86400000);
    if(old?.status==='review')after=Math.min(after,Date.parse(old.oldest_at));
    const retry=retries.find(r=>r.thread_id===ref.id);if(retry)after=Math.min(after,Date.parse(retry.scan_after));
    if(old?.resolved_through)after=Math.max(after,Date.parse(old.resolved_through));
    const cleaned=cleanMessages(raw);
    let messages=cleaned.filter((m:any)=>!seen.has(m.id)&&Date.parse(m.date)>=after&&Date.parse(m.date)<Date.parse(started));
    messages=[...new Map([...(old?.payload.messages||[]),...messages].filter((m:any)=>!seen.has(m.id)).map((m:any)=>[m.id,m])).values()].sort((a:any,b:any)=>a.date.localeCompare(b.date));
    if(!messages.length){await clearRetry();continue;}
    const older=cleaned.filter((m:any)=>Date.parse(m.date)<Date.parse(messages[0].date)).at(-1);
    const payload={messages,older_context:older?{subject:older.subject,body:bounded(older.body,1500),context_only:true}:null};
    const large=byteSize(payload)>10000;
    checked(await db.from('sot_mail_queue').upsert({user_id:uid,thread_id:ref.id,fingerprint,payload,status:large||old?.status==='review'?'review':'ready',reason:large?'Select a smaller group of messages to retry, or review in Gmail and resolve manually.':old?.status==='review'?'Conversation updated; review before retrying analysis.':null,focus_message_ids:null,oldest_at:messages[0].date,updated_at:new Date().toISOString()}));
    await clearRetry();
   }
   collecting=!!list.nextPageToken;
   checked(await db.from('sot_connections').update({collection_started:collecting?started:null,collection_cursor:list.nextPageToken||null,collected_through:collecting?c.collected_through:started}).eq('user_id',uid));
   const queued:any[]=checked(await db.from('sot_mail_queue').select('*').eq('user_id',uid).eq('status','ready').order('oldest_at').limit(40))||[];
   // Never batch different clients or ambiguous identities together. FIFO prevents old ready work from starving.
   const ready=queued.map(t=>({...t,payload:{...t.payload,messages:t.focus_message_ids?t.payload.messages.filter((m:any)=>t.focus_message_ids.includes(m.id)):t.payload.messages}})).map(t=>({...t,group:relationshipFor(t).matched?.id||'thread:'+t.thread_id}));
   await loadContext(ready);
   const packed=packRelated(ready,contextFor);
   if(packed?.oversized)checked(await db.from('sot_mail_queue').update({status:'review',reason:'Context and message exceed the safe batch size; focused review needed.'}).eq('user_id',uid).eq('thread_id',packed.oversized.thread_id));
   if(packed?.input&&allowance.available>0){
    job={id:crypto.randomUUID(),user_id:uid,status:'prepared',snapshot:{input:packed.input,threads:packed.threads.map(t=>({...t,message_ids:t.payload.messages.map((m:any)=>m.id)}))}};
    checked(await db.from('sot_batch_jobs').insert(job));
   }
  }
  let paused=allowance.available<1;
  if(job?.status==='prepared'){
   if(!checked(await db.rpc('sot_reserve_batch',{job:job.id,manual}))){paused=true;checked(await db.from('sot_batch_jobs').delete().eq('id',job.id).eq('status','prepared'));}
   else {
    job.status='reserved';
    try {
     const response=await fetchJSON('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+env('OPENAI_API_KEY'),'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,instructions:instructions.replace('Maximum 8 suggestions.','Maximum 20 suggestions.')+'\n'+BATCH_RULES,input:job.snapshot.input,max_output_tokens:6000,text:{format:{type:'json_schema',name:'sot_suggestions',strict:true,schema:proposalSchema}}})});
     const usage=tokenCost(response.usage);
     checked(await db.from('sot_batch_jobs').update(usage).eq('id',job.id));
     if(response.status!=='completed')throw new Error('Incomplete AI answer');
     const output=response.output?.flatMap((o:any)=>o.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('');
     const proposals=JSON.parse(output||'{}').suggestions;
     if(!Array.isArray(proposals)||proposals.length>=20||proposals.some((p:any)=>!job.snapshot.threads.some((t:any)=>t.message_ids.includes(p.source_message_id))))throw new Error('Answer needs focused review');
     checked(await db.from('sot_batch_jobs').update({status:'answered',response:proposals}).eq('id',job.id));job.status='answered';job.response=proposals;
    }catch(error){
     // Do not auto-repeat an uncertain paid request. Keep receipts unset for human follow-up.
     for(const t of job.snapshot.threads)checked(await db.from('sot_mail_queue').update({status:'review',reason:'AI answer was incomplete or interrupted; review required before another paid attempt.'}).eq('user_id',uid).eq('thread_id',t.thread_id));
     checked(await db.from('sot_batch_jobs').update({status:'review',reason:'Analysis needs review',finished_at:new Date().toISOString()}).eq('id',job.id));job.status='review';
    }
   }
  }
  if(job?.status==='answered'){
   await loadContext(job.snapshot.threads);
   const results=[];const batchRows:any[]=[];
   for(const t of job.snapshot.threads){
    const ids=new Set(t.message_ids),proposals=job.response.filter((p:any)=>ids.has(p.source_message_id));
    const rows=await validateBatchThread(proposals,t.payload.messages,contextFor(t),relationshipFor(t),clients,tasks,[...pending,...batchRows]);
    batchRows.push(...rows);
    results.push({thread_id:t.thread_id,fingerprint:t.fingerprint,proposals:rows});
   }
   made=checked(await db.rpc('sot_finish_batch',{job:job.id,results}));
  }
  const report:any=checked(await db.rpc('sot_queue_report',{uid}));allowance=await budget();
  const more=!paused&&allowance.available>0&&(collecting||report.waiting>0);
  const status=paused?'budget_paused':more?'running':(report.needs_review||report.fetch_retries)?'follow_up':report.waiting?'budget_paused':collecting?'collecting':'complete';
  checked(await db.from('sot_connections').update({scan_report:report,scan_status:status,last_error:report.needs_review?`${report.needs_review} conversations need focused review.`:null,deferred_threads:report.needs_review,scanned_threads:report.reviewed_messages,section_progress:null,next_scan_at:more||collecting?new Date(Date.now()+60000).toISOString():allowance.next_check,...(!collecting&&!report.waiting&&!report.needs_review&&!report.fetch_retries?{last_completed_at:new Date().toISOString(),last_scan_at:new Date().toISOString()}: {})}).eq('user_id',uid));
  return {more,created:made,deferred:report.needs_review,waiting:report.waiting,budget:allowance};
 }catch(error){
  const b:any=checked(await db.rpc('sot_budget',{manual}));
  await db.from('sot_connections').update({scan_status:'error',last_error:error instanceof Error?error.message:'Scan interrupted',next_scan_at:b.next_check}).eq('user_id',uid);throw error;
 }finally{
  const snapshot=await db.from('sot_connections').select('scan_status,last_error,scanned_threads').eq('user_id',uid).maybeSingle();
  await db.from('sot_scan_runs').update({finished_at:new Date().toISOString(),status:snapshot.data?.scan_status||'error',detail:snapshot.data?.last_error||null,scanned_threads:snapshot.data?.scanned_threads||0}).eq('id',runId);
  await db.from('sot_scan_locks').delete().eq('user_id',uid).eq('lease_id',lease);
 }
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
  const input=await req.json();
  const {action,suggestionId,query}=input;
  if(action==='create_teammate')return json(await createTeammate(db,user.id,input,app));
  if(action==='status') return json({configured:configured(),startingMailbox:STARTING_MAILBOX,budget:checked(await db.rpc('sot_budget',{manual:true})),report:checked(await db.rpc('sot_queue_report',{uid:user.id}))});
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
  if(action==='scan') {if(!configured()) throw new Error('Email setup is incomplete.');return json(await scan(user.id,true));}
  return json({error:'Unknown action'},400);
 } catch(error) {
  // Never log provider payloads, tokens, email bodies, or Authorization headers.
  return json({error:error instanceof Error?error.message:'SOT could not complete this request.'},400);
 }
});
