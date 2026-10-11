import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {proposalIdentity} from '../supabase/functions/sot/truth.ts';
import {validProposal,type Proposal} from '../supabase/functions/sot/core.ts';
import {validateBatchThread} from '../supabase/functions/sot/validation.ts';
import {allPages,relevantWork} from '../supabase/functions/sot/context.ts';
const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
const dir=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(dir)).sort())await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists "pgcrypto";',''));
const owner='00000000-0000-4000-8000-000000000001',employee='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003';
for(const [id,role] of [[owner,'owner'],[employee,'employee'],[other,'employee']]){await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{"display_name":"Audit test"}')`,[id,id+'@example.test']);await db.query('update profiles set role=$2 where id=$1',[id,role]);}
async function as(id:string|null,sql:string,args:unknown[]=[],role='authenticated'){await db.exec('begin');try{await db.exec('set local role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id||'']);const r=await db.query<any>(sql,args);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
const c=(await db.query<any>("insert into clients(name) values('Audit client') returning id,share_token")).rows[0];
const p=(await db.query<any>("insert into projects(client_id,name) values($1,'Audit campaign') returning id",[c.id])).rows[0];
const task=(await db.query<any>("insert into work_items(client_id,project_id,title,year_month) values($1,$2,'Prepare campaign','2026-01') returning id",[c.id,p.id])).rows[0].id;
await db.query("insert into sot_connections(user_id,email) values($1,'employee@sunrosecreative.com')",[employee]);
const base:Proposal={kind:'update',title:'Prepare campaign',description:'Please use blue assets.',client_id:c.id,client_name:'Audit client',project_id:p.id,parent_id:null,task_id:task,due_date:null,estimated_hours:null,contact_email:'client@example.test',evidence:'Please use blue assets.',source_message_id:'m1',work_state:'changed',responsibility:'sunrose',relationship_type:'client'};
async function proposal(uid:string,kind:string,key:string,payload:any,title='Project proposal'){return (await db.query<any>(`insert into sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,source_subject,evidence) values($1,$2,$3,$4,'Scope supported by email',$5,'thread','subject','Evidence of agency work') returning *`,[uid,kind,key,title,JSON.stringify(payload)])).rows[0];}

test('transient retrieval errors preserve queued evidence and its age',async()=>{
 await db.query(`insert into sot_mail_queue(user_id,thread_id,fingerprint,payload,status,oldest_at) values($1,'failed','fingerprint','{"messages":[{"id":"old","body":"Please keep this"}]}','ready','2026-01-01')`,[employee]);
 const before=(await db.query('select * from sot_mail_queue')).rows;
 await db.query("select sot_record_fetch_failure($1,'failed')",[employee]);await db.query("select sot_record_fetch_failure($1,'failed')",[employee]);
 assert.deepEqual((await db.query('select * from sot_mail_queue')).rows,before);
 assert.equal((await db.query('select * from sot_fetch_retries')).rows.length,1);
 await assert.rejects(as(employee,"select sot_record_fetch_failure($1,'failed')",[employee]),/permission denied/);
});
test('focused retry retains unselected messages, is private, and consumes no reservation',async()=>{
 await db.query(`insert into sot_mail_queue(user_id,thread_id,fingerprint,payload,status,oldest_at) values($1,'focus','fp',$2,'review','2026-01-01')`,[employee,JSON.stringify({messages:[{id:'a',body:'First request'},{id:'b',body:'Second request'}]})]);
 assert.deepEqual((await as(other,"select sot_review_messages('focus') m"))[0].m,[]);
 await assert.rejects(as(other,"select sot_recover_thread('focus','resolve',null,'Handled manually')"),/changed/);
 await assert.rejects(as(employee,"select sot_recover_thread('focus','retry',array['invented'],'')"),/selection/);
 await as(employee,"select sot_recover_thread('focus','retry',array['a'],'')");
 assert.equal((await db.query('select * from sot_call_reservations')).rows.length,0);
 const job='00000000-0000-4000-8000-000000000010';
 await db.query("insert into sot_batch_jobs(id,user_id,status,snapshot) values($1,$2,'answered',$3)",[job,employee,JSON.stringify({threads:[{thread_id:'focus',fingerprint:'fp',message_ids:['a']}]})]);
 await assert.rejects(db.query('select sot_finish_batch($1,$2)',[job,'[]']),/Incomplete/);
 await db.query('select sot_finish_batch($1,$2)',[job,JSON.stringify([{thread_id:'focus',fingerprint:'fp',proposals:[]}])]);
 assert.equal((await db.query("select * from sot_scan_cache where thread_id='focus'")).rows.length,0);
 const q=(await db.query<any>("select * from sot_mail_queue where thread_id='focus'")).rows[0];assert.equal(q.status,'review');assert.deepEqual(q.payload.messages.map((m:any)=>m.id),['b']);
 await as(employee,"select sot_recover_thread('focus','resolve',null,'Added remaining task manually')");
 const receipts=(await db.query<any>("select message_id,review_method from sot_message_receipts order by message_id")).rows;
 assert.deepEqual(receipts,[{message_id:'a',review_method:'analysis'},{message_id:'b',review_method:'manual'}]);
 const report=(await db.query<any>('select sot_queue_report($1) r',[employee])).rows[0].r;assert.equal(report.reviewed_messages,1);assert.equal(report.manually_resolved_messages,1);
});
test('recovery refuses oversized selection and active scan; missing payload queues retrieval',async()=>{
 await db.query(`insert into sot_mail_queue(user_id,thread_id,fingerprint,payload,status,oldest_at) values($1,'big','fp',$2,'review',now())`,[employee,JSON.stringify({messages:[{id:'huge',body:'x'.repeat(10000)}]})]);
 await assert.rejects(as(employee,"select sot_recover_thread('big','retry',array['huge'],'')"),/fewer/);
 await db.query('select sot_claim_scan($1,gen_random_uuid())',[employee]);
 await assert.rejects(as(employee,"select sot_recover_thread('big','resolve',null,'Handled in Gmail')"),/current scan/);
 await db.query('delete from sot_scan_locks where user_id=$1',[employee]);
 await db.query(`insert into sot_mail_queue(user_id,thread_id,fingerprint,status,oldest_at) values($1,'legacy','unread','review',now())`,[employee]);
 await as(employee,"select sot_recover_thread('legacy','retry',null,'')");
 assert.equal((await db.query("select * from sot_fetch_retries where thread_id='legacy'")).rows.length,1);
 await db.query("select sot_record_fetch_failure($1,'never-fetched')",[employee]);
 const report=(await db.query<any>('select sot_queue_report($1) r',[employee])).rows[0].r;assert.ok(report.review_items.some((x:any)=>x.thread_id==='never-fetched'));
 await as(employee,"select sot_recover_thread('never-fetched','resolve',null,'Reviewed directly in Gmail; no work needed')");
 assert.equal((await db.query("select * from sot_fetch_retries where thread_id='never-fetched'")).rows.length,0);
});
test('material updates have distinct identities while replay remains idempotent',async()=>{
 const next={...base,source_message_id:'m2',description:'Please use red assets.',evidence:'Please use red assets.'};assert.notEqual(proposalIdentity(base),proposalIdentity(next));
 for(const item of [base,next,next])await db.query('select sot_store_thread($1,$2,$3,$4)',[employee,'update-thread','fp',JSON.stringify([{...item,dedupe_key:proposalIdentity(item),payload:{...item,analysis_version:4},source_subject:'Updates'}])]);
 const rows=(await db.query<any>("select description from sot_suggestions where kind='update'")).rows;assert.equal(rows.length,2);assert.ok(rows.some(r=>r.description===next.description));
});
test('anonymous intake is idempotent and only an owner can turn it into a project task',async()=>{
 const id='00000000-0000-4000-8000-000000000011';
 for(let i=0;i<2;i++)await as(null,'select submit_client_request($1,$2,$3,$4)',[c.share_token,id,'Client request','Requested details'],'anon');
 assert.equal((await db.query('select * from client_requests')).rows.length,1);
 assert.equal((await db.query('select * from work_items')).rows.length,1);
 await assert.rejects(as(null,'select * from client_requests',[],'anon'),/permission denied/);
 assert.equal((await as(employee,'select * from client_requests')).length,0);
 await assert.rejects(as(employee,'select review_client_request($1,$2,false)',[id,p.id]),/Owner/);
 await assert.rejects(as(owner,'select review_client_request($1,$2,false)',[id,'00000000-0000-4000-8000-000000000099']),/active project/);
 const result=(await as(owner,'select review_client_request($1,$2,false) id',[id,p.id]))[0].id;
 assert.equal((await as(owner,'select review_client_request($1,$2,false) id',[id,p.id]))[0].id,result);
 assert.equal((await db.query<any>('select project_id from work_items where id=$1',[result])).rows[0].project_id,p.id);
});
test('owners approve employee project proposals without accepting or reassigning their tasks',async()=>{
 const s=await proposal(employee,'project','project:employee',{client_id:c.id,client_name:'Audit client',checklist:{identity_resolved:true},analysis_version:4});
 const child=await proposal(employee,'task','child-pending',{client_id:c.id,project_proposal_key:s.dedupe_key},'Draft copy');
 await assert.rejects(as(employee,'select sot_accept_project($1,$2,$3,$4)',[s.id,s.updated_at,'Employee campaign','Confirmed scope']),/Owner/);
 const approvals=(await as(owner,'select sot_project_approvals() a'))[0].a;assert.ok(approvals.some((a:any)=>a.id===s.id));
 const project=(await as(owner,'select sot_accept_project($1,$2,$3,$4) id',[s.id,s.updated_at,'Employee campaign','Confirmed scope']))[0].id;
 const linked=(await db.query<any>('select * from sot_suggestions where id=$1',[child.id])).rows[0];assert.equal(linked.status,'pending');assert.equal(linked.user_id,employee);assert.equal(linked.payload.project_id,project);
});
test('internal work needs a confirmed client and does not create a client contact',async()=>{
 const internal={...base,kind:'task' as const,work_state:'outstanding' as const,task_id:null,contact_email:'sierra@sunrosecreative.com',project_evidence:'Audit campaign',evidence:'Please prepare Audit campaign for Audit client.'};
 assert.equal(validProposal(internal,['m1'],[internal.contact_email]),false);
 assert.ok(validProposal(internal,['m1'],[internal.contact_email],[c.id]));
 assert.equal(validProposal({...internal,kind:'client'},['m1'],[internal.contact_email],[c.id]),false);
 const client={id:c.id,name:'Audit client'};
 const rows=await validateBatchThread([internal],[{id:'m1',from:internal.contact_email,to:'employee@sunrosecreative.com',cc:'',subject:'Campaign',body:internal.evidence}],{projects:[{id:p.id,client_id:c.id,name:'Audit campaign',stage:'active'}]},{matched:client,candidates:[client],allowNewClient:false},[client],[],[]);
 assert.equal(rows.length,1);
 await db.query('select sot_store_thread($1,$2,$3,$4)',[employee,'internal','fp',JSON.stringify(rows)]);
 const s=(await db.query<any>('select id from sot_suggestions where dedupe_key=$1',[rows[0].dedupe_key])).rows[0];await as(employee,'select sot_accept($1)',[s.id]);
 assert.equal((await db.query("select * from sot_client_contacts where email like '%@sunrosecreative.com'")).rows.length,0);
});
test('historical time can be corrected after a move without moving its project',async()=>{
 const entryId=(await as(employee,"select save_time_log(null,null,$1,$2,'2026-01-02T10:00Z','2026-01-02T11:00Z','Original',true) id",[p.id,task]))[0].id;
 const dest=(await db.query<any>("insert into projects(client_id,name) values($1,'Destination') returning id",[c.id])).rows[0].id;
 await as(owner,'update work_items set project_id=$1 where id=$2',[dest,task]);
 const entry=(await db.query<any>('select * from time_entries where id=$1',[entryId])).rows[0];
 await as(employee,"select save_time_log($1,$2,$3,$4,'2026-01-02T10:00Z','2026-01-02T11:00Z','Corrected note',true)",[entry.id,entry.updated_at,p.id,task]);
 const corrected=(await db.query<any>('select * from time_entries where id=$1',[entryId])).rows[0];assert.equal(corrected.project_id,p.id);assert.equal(corrected.note,'Corrected note');
 await assert.rejects(as(other,"select save_time_log($1,$2,$3,$4,'2026-01-02T10:00Z','2026-01-02T11:00Z','Bad edit',true)",[entry.id,corrected.updated_at,p.id,task]),/own time/);
});
test('context pagination retains old active work beyond global and page limits',async()=>{
 const rows=Array.from({length:1201},(_,i)=>({id:String(i),title:i===1200?'Special Mars arrival task':'Other work',status:i===1200?'planned':'done'}));
 const loaded=await allPages(async(a,b)=>({data:rows.slice(a,b+1),error:null}));assert.equal(loaded.length,1201);
 assert.equal(relevantWork(loaded,'Special Mars arrival',60)[0].id,'1200');
 await assert.rejects(allPages(async()=>({data:null,error:new Error('Database unavailable')})),/complete workspace context/);
});
test.after(()=>db.close());
