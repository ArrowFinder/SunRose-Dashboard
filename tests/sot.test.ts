import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import {clientChecklist,publicWebsite,websiteResult} from '../supabase/functions/sot/identity.ts';
import { agencyRelated, gmailQuery, validProposal, bounded, type Proposal } from '../supabase/functions/sot/core.ts';
const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
const migrationDir=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(migrationDir)).sort()) await db.exec((await readFile(new URL(name,migrationDir),'utf8')).replace('create extension if not exists "pgcrypto";',''));
const ids=['owner','admin','supervisor','employee','client'].map((_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
for(const [i,role] of ['owner','admin','supervisor','employee','client'].entries()) {
 await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)`,[ids[i],role+'@example.test',JSON.stringify({display_name:role})]);
 await db.query('update public.profiles set role=$2 where id=$1',[ids[i],role]);
}
async function as(uid:string|null,sql:string,args:unknown[]=[]) {await db.exec('begin');try{await db.exec(uid?'set local role authenticated':'set local role anon');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);const r=await db.query(sql,args);await db.exec('commit');return r.rows as any[];}catch(e){await db.exec('rollback');throw e;}}
const checklist={business_name:true,contact_email:true,relationship_evidence:true,existing_clients_checked:true,identity_resolved:true,ready:true};
const payload={analysis_version:2,checklist,client_name:'Acme Studio',contact_email:'alex@acme.test',client_id:null,parent_id:null,task_id:null,due_date:'2026-11-10',estimated_hours:2};
async function suggestion(uid=ids[3],kind='client',key=crypto.randomUUID(),patch={}){return (await db.query<{id:string}>(`insert into public.sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,evidence) values($1,$2,$3,'November campaign','Write November copy',$4,'thread-1','Please prepare the November campaign') returning id`,[uid,kind,key,JSON.stringify({...payload,...patch})])).rows[0].id;}
let clientId:string,taskId:string;
test('supervisor is staff but cannot manage accounts or visibility',async()=>{
 assert.equal((await as(ids[2],'select public.is_internal_user() as staff'))[0].staff,true);
 await assert.rejects(as(ids[2],"select public.manage_member($1,'owner','Employee',true,null)",[ids[3]]),/Owner or admin/);
});
test('suggestions and credentials are private, even from owner and admin',async()=>{
 const s=await suggestion();
 assert.equal((await as(ids[3],'select id from public.sot_suggestions where id=$1',[s])).length,1);
 for(const uid of [ids[0],ids[1],ids[2],ids[4]])assert.equal((await as(uid,'select id from public.sot_suggestions where id=$1',[s])).length,0);
 await assert.rejects(as(ids[3],'select * from public.sot_credentials'),/permission denied/);
 await assert.rejects(as(null,'select * from public.sot_suggestions'),/permission denied/);
 await assert.rejects(as(ids[0],'select public.sot_accept($1)',[s]),/not found/);
 await assert.rejects(as(ids[4],'select public.sot_accept($1)',[s]),/Staff access/);
 await assert.rejects(as(ids[3],"update public.sot_suggestions set payload='{}' where id=$1",[s]),/permission denied/);
 clientId=(await as(ids[3],'select public.sot_accept($1) as id',[s]))[0].id;
 assert.equal((await as(ids[3],'select public.sot_accept($1) as id',[s]))[0].id,clientId);
 assert.equal((await db.query('select retainer_hours_per_month from public.clients where id=$1',[clientId])).rows[0].retainer_hours_per_month,'0');
});
test('Add fills supported fields, assigns mailbox owner and notifies only Owner and Supervisor',async()=>{
 const key='same-email-same-task';
 const s=await suggestion(ids[3],'task',key);
 taskId=(await as(ids[3],'select public.sot_accept($1) as id',[s]))[0].id;
 const [task]=await as(ids[3],'select * from public.work_items where id=$1',[taskId]);
 assert.equal(task.client_id,clientId);assert.equal(task.assigned_user_id,ids[3]);assert.equal(task.title,'November campaign');assert.equal(task.description,'Write November copy');assert.equal(task.estimated_hours,'2');assert.equal(task.actual_hours,'0');assert.equal(task.status,'planned');assert.equal(task.client_visible,false);
 const recipients=(await db.query<{recipient_id:string}>('select recipient_id from public.sot_notifications where task_id=$1',[taskId])).rows.map(r=>r.recipient_id).sort();assert.deepEqual(recipients,[ids[0],ids[2]].sort());
 assert.equal((await as(ids[1],'select * from public.sot_notifications')).length,0);
 assert.equal((await as(ids[2],'select * from public.sot_notifications')).length,1);
 const other=await suggestion(ids[2],'task',key);
 assert.equal((await as(ids[2],'select public.sot_accept($1) as id',[other]))[0].id,taskId);
 assert.equal((await db.query('select * from public.work_items')).rows.length,1);
 assert.equal((await db.query('select * from public.sot_notifications')).rows.length,2);
 await assert.rejects(as(ids[2],'update public.work_items set client_visible=true where id=$1',[taskId]),/owner or admin/);
});
test('Delete dismisses only the user suggestion; cannot turn dismissed suggestion into a task',async()=>{
 const s=await suggestion(ids[3],'task');
 await assert.rejects(as(ids[2],'select public.sot_dismiss($1)',[s]),/no longer/);
 await as(ids[3],'select public.sot_dismiss($1)',[s]);
 await assert.rejects(as(ids[3],'select public.sot_accept($1)',[s]),/dismissed/);
 assert.equal((await db.query('select * from public.work_items')).rows.length,1);
});
test('subtasks stay linked to the right client and retain supervisor assignment',async()=>{
 const s=await suggestion(ids[2],'task',crypto.randomUUID(),{client_id:clientId,parent_id:taskId});
 const id=(await as(ids[2],'select public.sot_accept($1) as id',[s]))[0].id;
 const [child]=await as(ids[2],'select * from public.work_items where id=$1',[id]);
 assert.equal(child.parent_id,taskId);assert.equal(child.assigned_user_id,ids[2]);
 await assert.rejects(as(ids[2],"update public.work_items set client_visible=true where id=$1",[id]),/owner or admin/);
});
test('new client must be approved before their tasks are accepted',async()=>{
 const s=await suggestion(ids[3],'task',crypto.randomUUID(),{client_name:'Unknown LLC',contact_email:'other@unknown.test'});
 await assert.rejects(as(ids[3],'select public.sot_accept($1)',[s]),/client first/);
});
test('updates preserve clock data and stale suggestions are rejected',async()=>{
 const child=(await db.query<any>('select * from public.work_items where parent_id=$1',[taskId])).rows[0];
 const s=await suggestion(ids[2],'update',crypto.randomUUID(),{client_id:clientId,task_id:child.id,expected_updated_at:child.updated_at});
 await as(ids[2],'select public.sot_accept($1)',[s]);
 const updated=(await db.query<any>('select * from public.work_items where id=$1',[child.id])).rows[0];
 assert.equal(updated.actual_hours,'0');assert.match(updated.description,/SOT update:/);
 const stale=await suggestion(ids[2],'complete',crypto.randomUUID(),{client_id:clientId,task_id:child.id,expected_updated_at:child.updated_at});
 await assert.rejects(as(ids[2],'select public.sot_accept($1)',[stale]),/Task changed/);
 const complete=await suggestion(ids[2],'complete',crypto.randomUUID(),{client_id:clientId,task_id:child.id,expected_updated_at:updated.updated_at});
 await as(ids[2],'select public.sot_accept($1)',[complete]);
 assert.equal((await db.query<any>('select status from public.work_items where id=$1',[child.id])).rows[0].status,'done');
});
test('cost allowance and scan locks cannot be bypassed by app users',async()=>{
 await assert.rejects(as(ids[0],'select public.sot_reserve_call()'),/permission denied/);
 const lease=crypto.randomUUID();
 assert.equal((await db.query<any>('select public.sot_claim_scan($1,$2) as ok',[ids[3],lease])).rows[0].ok,true);
 assert.equal((await db.query<any>('select public.sot_claim_scan($1,$2) as ok',[ids[3],crypto.randomUUID()])).rows[0].ok,false);
 for(let i=0;i<300;i++)assert.equal((await db.query<any>('select public.sot_reserve_call() as ok')).rows[0].ok,true);
 assert.equal((await db.query<any>('select public.sot_reserve_call() as ok')).rows[0].ok,false);
});
test('Gmail query includes inbox and sent for 90 days and restricts non-agency mailboxes',()=>{
 const now=Date.parse('2026-10-01T00:00Z');
 assert.match(gmailQuery('sierra@sunrosecreative.com',now),/\{in:inbox in:sent\}/);
 assert.match(gmailQuery('person@gmail.com',now),/from:\(sunrosecreative.com\)/);
 assert(!gmailQuery('sierra@sunrosecreative.com',now).includes('from:'));
 assert.equal(agencyRelated({from:'x@evil-sunrosecreative.com',to:'person@gmail.com',cc:''},'person@gmail.com'),false);
 assert.equal(agencyRelated({from:'sierra@sunrosecreative.com',to:'person@gmail.com',cc:''},'person@gmail.com'),true);
 assert(new TextEncoder().encode(bounded('A'.repeat(20000),16000)).length<=16000);
});
test('model proposals must cite real messages and real external contacts',()=>{
 const good:Proposal={...payload,kind:'task',title:'Email blast',description:'Write copy',source_message_id:'m1',evidence:'Please write copy'};
 assert(validProposal(good,['m1'],['alex@acme.test']));
 assert(!validProposal({...good,contact_email:'invented@acme.test'},['m1'],['alex@acme.test']));
 assert(!validProposal({...good,source_message_id:'fake'},['m1'],['alex@acme.test']));
 assert(!validProposal({...good,due_date:'2026-02-31'},['m1'],['alex@acme.test']));
 assert(!validProposal({...good,estimated_hours:-1},['m1'],['alex@acme.test']));
});
test('later replies replace pending suggestions without recreating dismissed work',async()=>{
 await db.query('insert into public.sot_connections(user_id,email) values($1,$2)',[ids[3],'employee@sunrosecreative.com']);
 const p={kind:'task',dedupe_key:'scan-request',title:'Scan fixture',description:'First request',payload,source_subject:'Campaign',evidence:'Please draft it'};
 await db.query('select public.sot_store_thread($1,$2,$3,$4)',[ids[3],'scan-thread','v1',JSON.stringify([p])]);
 const [first]=await as(ids[3],"select id from public.sot_suggestions where dedupe_key='scan-request'");
 await as(ids[3],'select public.sot_dismiss($1)',[first.id]);
 await db.query('select public.sot_store_thread($1,$2,$3,$4)',[ids[3],'scan-thread','v2',JSON.stringify([p])]);
 assert.equal((await as(ids[3],"select * from public.sot_suggestions where dedupe_key='scan-request' and status='pending'")).length,0);
 await db.query('select public.sot_store_thread($1,$2,$3,$4)',[ids[3],'scan-thread','v3',JSON.stringify([{...p,dedupe_key:'another-request'}])]);
 await db.query('select public.sot_store_thread($1,$2,$3,$4)',[ids[3],'scan-thread','v4','[]']);
 assert.equal((await as(ids[3],"select * from public.sot_suggestions where source_thread='scan-thread' and status='pending'")).length,0);
 await assert.rejects(as(ids[3],"select public.sot_store_thread($1,'x','x','[]')",[ids[3]]),/permission denied/);
});

test('client checklist blocks missing evidence and supports explicit separate businesses for one contact',async()=>{
 const shared=await suggestion(ids[3],'client','second-business',{client_name:'Second Business',checklist:{...checklist,identity_resolved:false,ready:false}});
 await assert.rejects(as(ids[3],'select public.sot_accept($1)',[shared]),/Confirm which business/);
 await as(ids[3],'select public.sot_confirm_identity($1,null,true,false)',[shared]);
 const second=(await as(ids[3],'select public.sot_accept($1) as id',[shared]))[0].id;
 assert.notEqual(second,clientId);
 const links=await as(ids[3],"select client_id from public.sot_client_contacts where email='alex@acme.test'");
 assert.equal(links.length,2);
 const missing=await suggestion(ids[3],'client','missing-evidence',{client_name:'Third Business',checklist:{...checklist,relationship_evidence:false,ready:false}});
 await assert.rejects(as(ids[3],'select public.sot_accept($1)',[missing]),/checklist/);
 await assert.rejects(as(ids[0],'select public.sot_confirm_identity($1,null,true,true)',[missing]),/not found/);
 await as(ids[3],'select public.sot_confirm_identity($1,null,true,true)',[missing]);
 await as(ids[3],'select public.sot_accept($1)',[missing]);
});
test('approved website, aliases and contacts persist; clients cannot read internal identity profiles',async()=>{
 const s=await suggestion(ids[3],'client','website-profile',{client_name:'Profile Business',aliases:['Profile Co'],location:'Portland',business_type:'Design studio',website_candidate:{url:'https://profile-business.com',sources:[{url:'https://profile-business.com/about',title:'About'}]}});
 await as(ids[3],'select public.sot_confirm_identity($1,null,true,false)',[s]);
 await as(ids[3],'select public.sot_confirm_website($1,true)',[s]);
 const id=(await as(ids[3],'select public.sot_accept($1) as id',[s]))[0].id;
 const [profile]=await as(ids[3],'select * from public.sot_client_profiles where client_id=$1',[id]);
 assert.equal(profile.website_url,'https://profile-business.com');assert.deepEqual(profile.aliases,['Profile Co']);
 assert.equal((await as(ids[4],'select * from public.sot_client_profiles')).length,0);
 const noWebsite=await suggestion(ids[3],'client','no-website',{client_name:'No Website',contact_email:'new@other.test'});
 await assert.rejects(as(ids[3],'select public.sot_confirm_website($1,true)',[noWebsite]),/supported website/);
 await as(ids[3],'select public.sot_accept($1)',[noWebsite]);
});
test('checklist matches aliases and detects conflicting contact associations',()=>{
 const proposal:Proposal={...payload,kind:'client',title:'Acme',description:'Client',source_message_id:'m1',evidence:'Please create our campaign',relationship_evidence:'Please create our campaign'};
 const clients=[{id:'one',name:'Acme Studio',aliases:['Acme'],emails:['alex@acme.test']}];
 assert(clientChecklist(proposal,clients,'Please create our campaign').ready);
 assert.equal(clientChecklist({...proposal,client_name:'Other business'},clients,'Please create our campaign').identity_resolved,false);
 assert.equal(clientChecklist(proposal,clients,'No such quote').relationship_evidence,false);
 assert.equal(clientChecklist({...proposal,client_name:'Acme'},clients,'Please create our campaign').matched_client_id,'one');
});
test('website suggestions must use public, actually consulted sources',()=>{
 for(const url of ['javascript:alert(1)','http://localhost','http://127.0.0.1','https://user:pass@example.com','https://thing.internal']) assert.equal(publicWebsite(url),null);
 const response={status:'completed',output:[{type:'web_search_call',action:{sources:[{url:'https://example.com/about',title:'About'}]}},{content:[{type:'output_text',text:JSON.stringify({website_url:'https://example.com',explanation:'Name and location match'})}]}]};
 assert.equal(websiteResult(response).url,'https://example.com');
 assert.equal(publicWebsite('https://sites.google.com/view/real-business'),'https://sites.google.com/view/real-business');
 response.output[1].content![0].text=JSON.stringify({website_url:'https://invented.com',explanation:'Guess'});
 assert.equal(websiteResult(response).url,null);
});
test('website lookup has its own server-only monthly allowance',async()=>{
 await assert.rejects(as(ids[3],'select public.sot_reserve_website_search()'),/permission denied/);
 for(let i=0;i<40;i++)assert.equal((await db.query<any>('select public.sot_reserve_website_search() as ok')).rows[0].ok,true);
 assert.equal((await db.query<any>('select public.sot_reserve_website_search() as ok')).rows[0].ok,false);
});

test('review memory records decisions privately with scoped rejection reasons',async()=>{
 const s=await suggestion(ids[3],'client');
 await as(ids[3],"select public.sot_dismiss_with_reason($1,'vendor')",[s]);
 const history=await as(ids[3],'select decision,reason from public.sot_review_history where suggestion_id=$1',[s]);
 assert.deepEqual(history,[{decision:'dismissed',reason:'vendor'}]);
 assert.equal((await as(ids[0],'select * from public.sot_review_history where suggestion_id=$1',[s])).length,0);
 await assert.rejects(as(ids[3],"insert into public.sot_review_history(user_id,suggestion_id,decision,kind,client_name,contact_email,title) values($1,$2,'accepted','client','','','')",[ids[3],s]),/permission denied/);
 const other=await suggestion(ids[2]);
 await assert.rejects(as(ids[3],"select public.sot_dismiss_with_reason($1,'vendor')",[other]),/no longer/);
 await assert.rejects(as(ids[2],"select public.sot_dismiss_with_reason($1,'ignore_all_email')",[other]),/Invalid review reason/);
});
test('reassessment queues only own pending conversations, preserves decisions and needs staff',async()=>{
 await db.query("insert into public.sot_connections(user_id,email) values($1,'employee@example.test') on conflict do nothing",[ids[3]]);
 const s=await suggestion(ids[3],'task');
 await as(ids[3],'select public.sot_recheck_pending()');
 assert.ok((await db.query('select * from public.sot_recheck_queue where user_id=$1',[ids[3]])).rows.length);
 assert.equal((await db.query('select status from public.sot_suggestions where id=$1',[s])).rows[0].status,'pending');
 await assert.rejects(as(ids[4],'select public.sot_recheck_pending()'),/Staff access/);
 await assert.rejects(as(ids[3],'select * from public.sot_recheck_queue'),/permission denied/);
 await as(ids[3],'select public.sot_set_auto_scan(false)');
 assert.equal((await db.query('select auto_scan from public.sot_connections where user_id=$1',[ids[3]])).rows[0].auto_scan,false);
});
test('analysis pair cannot exceed the existing monthly budget',async()=>{
 await db.query("update public.sot_usage set reserved_calls=299 where month=to_char(now() at time zone 'UTC','YYYY-MM')");
 assert.equal((await db.query('select public.sot_reserve_analysis_pair() as ok')).rows[0].ok,false);
 await assert.rejects(as(ids[3],'select public.sot_reserve_analysis_pair()'),/permission denied/);
});
test('confirmed contacts outrank domains and ambiguous/shared domains do not force a match',async()=>{
 const {knownCorrespondent}=await import('../supabase/functions/sot/identity.ts');
 const clients=[{id:'lat',name:'LA Times Studios',domains:['latimes.com']},{id:'other',name:'Other',emails:['shared@latimes.com'],domains:['gmail.com']}];
 assert.equal(knownCorrespondent(['person@latimes.com'],clients)?.id,'lat');
 assert.equal(knownCorrespondent(['shared@latimes.com'],clients)?.id,'other');
 assert.equal(knownCorrespondent(['person@gmail.com'],clients),null);
 assert.equal(knownCorrespondent(['shared@latimes.com'],[...clients,{id:'third',name:'Third',emails:['shared@latimes.com']}]),null);
 const p={...payload,kind:'client',client_name:'City of El Segundo',contact_email:'person@latimes.com',relationship_evidence:'Please update our assets'} as unknown as Proposal;
 assert.equal(clientChecklist(p,clients,'Please update our assets').identity_resolved,false);
});
test('incremental scans use a stable window and overlap without repeating the whole discovery',async()=>{
 const {incrementalQuery}=await import('../supabase/functions/sot/core.ts');
 const start='2026-10-04T12:00:00Z',last='2026-10-04T09:00:00Z';
 assert.match(incrementalQuery('sierra@sunrosecreative.com',start,last),new RegExp('after:'+Math.floor((Date.parse(last)-86400000)/1000)));
 assert.match(incrementalQuery('sierra@sunrosecreative.com',start,last),new RegExp('before:'+Math.ceil(Date.parse(start)/1000)));
 assert.match(incrementalQuery('sierra@sunrosecreative.com',start,null),new RegExp('after:'+Math.floor((Date.parse(start)-90*86400000)/1000)));
});
test('confirmed client setup is repeatable and seeds only approved domains',async()=>{
 const setup=await readFile(new URL('../supabase/deployment/confirmed_clients.sql',import.meta.url),'utf8');
 await db.exec(setup);await db.exec(setup);
 const rows=(await db.query("select c.name,p.domains,p.aliases from public.clients c join public.sot_client_profiles p on c.id=p.client_id where c.name='LA Times Studios'")).rows;
 assert.equal(rows.length,1);assert.deepEqual(rows[0].domains,['latimes.com']);
 assert.ok((rows[0].aliases as string[]).includes('L.A. Times Studios'));
 assert.equal((await db.query("select * from public.clients where name='First Tee Pasadena'")).rows.length,1);
});

test('legacy suggestions cannot bypass new analysis checks',async()=>{
 const s=await suggestion(ids[3],'task',crypto.randomUUID(),{analysis_version:1});
 await assert.rejects(as(ids[3],'select public.sot_accept($1)',[s]),/Reassess/);
 await assert.rejects(as(ids[3],'select public.sot_accept_reviewed($1)',[s]),/permission denied/);
});
test('a service-set allowance increase is bounded and unavailable to app users',async()=>{
 await assert.rejects(as(ids[0],'update public.sot_usage set analysis_limit=600'),/permission denied/);
 await db.query("update public.sot_usage set reserved_calls=598,analysis_limit=600 where month=to_char(now() at time zone 'UTC','YYYY-MM')");
 assert.equal((await db.query('select public.sot_reserve_analysis_pair() as ok')).rows[0].ok,true);
 assert.equal((await db.query('select public.sot_reserve_analysis_pair() as ok')).rows[0].ok,false);
});
