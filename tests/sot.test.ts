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
const payload={analysis_version:3,checklist,client_name:'Acme Studio',contact_email:'alex@acme.test',client_id:null,parent_id:null,task_id:null,due_date:'2026-11-10',estimated_hours:2};
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
 await assert.rejects(as(ids[3],'select public.sot_recheck_pending()'),/retired/);
 assert.equal((await db.query('select * from public.sot_recheck_queue where user_id=$1',[ids[3]])).rows.length,0);
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
 assert.match(incrementalQuery('sierra@sunrosecreative.com',start,null),new RegExp('after:'+Math.floor((Date.parse(start)-7*86400000)/1000)));
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
test('prototype databases without a share-token default can create SOT clients',async()=>{
 await db.exec('alter table public.clients alter column share_token drop default');
 await db.exec(await readFile(new URL('../supabase/migrations/20261004010000_client_share_token_default.sql',import.meta.url),'utf8'));
 const row=(await db.query("insert into public.clients(name) values('Default regression') returning share_token")).rows[0];
 assert.equal((row.share_token as string).length,72);
});


test('known participants and contextual names suppress new-client discovery',async()=>{
 const {clientContext}=await import('../supabase/functions/sot/identity.ts');
 const clients=[{id:'lat',name:'LA Times Studios',domains:['latimes.com'],aliases:['LA Times']},{id:'rose',name:'Rose Bowl Stadium',emails:['mlee@rosebowlstadium.com']}];
 const sponsor=clientContext(['sierra@sunrosecreative.com','kay@latimes.com'],'City of El Segundo promotional assets',clients);
 assert.equal(sponsor.matched?.id,'lat');assert.equal(sponsor.allowNewClient,false);
 assert.equal(clientContext(['vendor@example.test'],'Quote for Rose Bowl Stadium',clients).allowNewClient,false);
 assert.equal(clientContext(['new@example.test'],'A separate new business',clients).allowNewClient,true);
 const mixed=clientContext(['kay@latimes.com','mlee@rosebowlstadium.com'],'Shared project',clients);
 assert.equal(mixed.matched,null);assert.equal(mixed.candidates.length,2);assert.equal(mixed.allowNewClient,false);
});
test('current-work reservations enforce burst, daily, monthly and staff restrictions',async()=>{
 await db.exec('delete from public.sot_call_reservations');
 await db.query("update public.sot_usage set reserved_calls=0,analysis_limit=600 where month=to_char(now() at time zone 'UTC','YYYY-MM')");
 await assert.rejects(as(ids[0],'select public.sot_reserve_current_calls(1)'),/permission denied/);
 await assert.rejects(db.query('select public.sot_reserve_current_calls(3)'),/Invalid/);
 for(let i=0;i<10;i++)assert.equal((await db.query('select public.sot_reserve_current_calls(1) as ok')).rows[0].ok,true);
 assert.equal((await db.query('select public.sot_reserve_current_calls(1) as ok')).rows[0].ok,false);
 await db.exec("update public.sot_call_reservations set reserved_at=now()-interval '4 hours'");
 for(let i=0;i<5;i++)assert.equal((await db.query('select public.sot_reserve_current_calls(2) as ok')).rows[0].ok,true);
 await db.exec("update public.sot_call_reservations set reserved_at=now()-interval '4 hours'");
 // Set all twenty reservations to the UTC day's start and evaluate the daily cap when that is >3h ago.
 await db.exec("update public.sot_call_reservations set reserved_at=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'");
 assert.equal((await db.query('select public.sot_reserve_current_calls(1) as ok')).rows[0].ok,false);
 await db.exec('delete from public.sot_call_reservations');
 await db.query("update public.sot_usage set reserved_calls=599 where month=to_char(now() at time zone 'UTC','YYYY-MM')");
 assert.equal((await db.query('select public.sot_reserve_current_calls(2) as ok')).rows[0].ok,false);
 assert.equal((await db.query('select public.sot_reserve_current_calls(1) as ok')).rows[0].ok,true);
});

test('tasks for an unrecognized business require client clarification',()=>{
 const p={...payload,kind:'task',client_name:'P1M',contact_email:'person@partner.test',relationship_type:'client',relationship_evidence:'Please arrange arrival'} as unknown as Proposal;
 const result=clientChecklist(p,[{id:'rose',name:'Rose Bowl Stadium'}],'Please arrange arrival');
 assert.equal(result.identity_resolved,false);assert.equal(result.ready,false);
 assert.match(result.explanation,/not confirmed/);
});

test('only owners/admins can save private client context and billing',async()=>{
 const args=[clientId,'Marketing client','Email campaigns','Sponsor belongs to this client',['Acme'],['acme.test'],['person@acme.test']];
 const call='select public.save_client_context($1,$2,$3,$4,$5,$6,$7)';
 await as(ids[0],call,args);
 assert.equal((await as(ids[3],'select context_notes from public.sot_client_profiles where client_id=$1',[clientId]))[0].context_notes,'Sponsor belongs to this client');
 await assert.rejects(as(ids[3],call,args),/Owner or admin/);
 await assert.rejects(as(ids[2],call,args),/Owner or admin/);
 await assert.rejects(as(ids[4],call,args),/Owner or admin/);
 await assert.rejects(as(null,call,args),/permission denied/);
 assert.equal((await as(ids[4],'select * from public.sot_client_profiles')).length,0);
 await assert.rejects(as(ids[0],call,[...args.slice(0,5),['gmail.com'],args[6]]),/business domains/);
 await as(ids[1],"update public.clients set billing_type='hourly',hourly_rate=125,hour_limit_enabled=false where id=$1",[clientId]);
 await as(ids[3],"update public.clients set hourly_rate=999 where id=$1",[clientId]);
 assert.equal((await db.query('select hourly_rate from public.clients where id=$1',[clientId])).rows[0].hourly_rate,'125');
 await assert.rejects(as(ids[0],"update public.clients set monthly_fee=-1 where id=$1",[clientId]),/check constraint/);
 const view=await as(null,"select public.shared_client_view($1,'2026-11') as view",[(await db.query('select share_token from public.clients where id=$1',[clientId])).rows[0].share_token]);
 assert.equal(view.length,1);assert.ok(!JSON.stringify(view).includes('Sponsor belongs'));assert.ok(!JSON.stringify(view).includes('hourly_rate'));
});

test('archive and restore preserve task history, protect active clocks and restrict roles',async()=>{
 const cid=(await db.query("insert into public.clients(name) values('Archive fixture') returning id")).rows[0].id;
 const root=(await db.query("insert into public.work_items(client_id,title,year_month) values($1,'Parent','2026-10') returning id",[cid])).rows[0].id;
 const child=(await db.query("insert into public.work_items(client_id,parent_id,title,year_month,client_visible) values($1,$2,'Child','2026-10',true) returning id",[cid,root])).rows[0].id;
 await db.query("insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2026-10-01 10:00Z','2026-10-01 11:00Z',60)",[child,ids[3]]);
 await assert.rejects(as(ids[0],'delete from public.work_items where id=$1',[child]),/time records/);
 await assert.rejects(as(ids[3],'select public.set_task_archived($1,true)',[root]),/Owner or admin/);
 await as(ids[3],'select public.start_work_timer($1,$2)',[child,crypto.randomUUID()]);
 await assert.rejects(as(ids[0],'select public.set_task_archived($1,true)',[root]),/running timer/);
 await assert.rejects(as(ids[0],'select public.set_client_archived($1,true)',[cid]),/running timers/);
 await db.query('delete from public.active_timers where work_item_id=$1',[child]);
 await as(ids[0],'select public.set_task_archived($1,true)',[root]);
 assert.equal((await db.query('select * from public.work_items where client_id=$1 and archived_at is not null',[cid])).rows.length,2);
 assert.equal((await db.query('select * from public.time_entries where work_item_id=$1',[child])).rows.length,1);
 await assert.rejects(as(ids[3],'select public.start_work_timer($1,$2)',[child,crypto.randomUUID()]),/Restore archived/);
 await assert.rejects(as(ids[0],'select public.set_task_archived($1,false)',[child]),/parent task first/);
 await as(ids[1],'select public.set_task_archived($1,false)',[root]);
 assert.equal((await db.query('select * from public.work_items where client_id=$1 and archived_at is not null',[cid])).rows.length,0);
 await as(ids[0],'select public.set_client_archived($1,true)',[cid]);
 const token=(await db.query('select share_token from public.clients where id=$1',[cid])).rows[0].share_token;
 await assert.rejects(as(null,"select public.shared_client_view($1,'2026-10')",[token]),/not found/);
 await assert.rejects(as(ids[3],"insert into public.work_items(client_id,title,year_month) values($1,'New','2026-10')",[cid]),/Restore the client/);
 await as(ids[0],'select public.set_client_archived($1,false)',[cid]);
 assert.equal((await db.query('select client_visible from public.work_items where id=$1',[child])).rows[0].client_visible,false);
 const unused=(await db.query("insert into public.work_items(client_id,title,year_month) values($1,'Disposable','2026-10') returning id",[cid])).rows[0].id;
 await as(ids[0],'delete from public.work_items where id=$1',[unused]);
 assert.equal((await db.query('select * from public.work_items where id=$1',[unused])).rows.length,0);
});

test('legacy manual time cannot be hard deleted',async()=>{
 const cid=(await db.query("insert into public.clients(name) values('Legacy archive fixture') returning id")).rows[0].id;
 const id=(await as(ids[0],"insert into public.work_items(client_id,title,year_month,actual_hours) values($1,'Legacy history','2026-10',3) returning id",[cid]))[0].id;
 await assert.rejects(as(ids[0],'delete from public.work_items where id=$1',[id]),/time records/);
 await as(ids[0],'select public.set_task_archived($1,true)',[id]);
 assert.equal((await db.query('select actual_hours from public.work_items where id=$1',[id])).rows[0].actual_hours,'3');
});

test('support snapshots are restricted to active Owner/Admin and never expose credentials',async()=>{
 const sid=await suggestion(ids[3],'task');
 for(const uid of [null,ids[2],ids[3],ids[4]])await assert.rejects(as(uid,'select public.support_user_snapshot($1)',[ids[3]]),/permission denied|Owner or admin/);
 for(const uid of [ids[0],ids[1]]){
  const result=(await as(uid,'select public.support_user_snapshot($1) as snapshot',[ids[3]]))[0].snapshot;
  assert.equal(result.user.id,ids[3]);assert.ok(result.suggestions.some((s:any)=>s.id===sid));
  assert.equal('credentials' in result,false);assert.equal(JSON.stringify(result).includes('encrypted_refresh'),false);
 }
 assert.equal((await as(ids[0],'select * from public.sot_suggestions where id=$1',[sid])).length,0);
 await assert.rejects(as(ids[1],'select public.sot_accept($1)',[sid]),/not found/);
 const audit=(await db.query<any>('select * from public.support_view_audit where target_id=$1',[ids[3]])).rows;
 assert.deepEqual(audit.map(a=>a.actor_id).sort(),[ids[0],ids[1]].sort());
 await db.query('update public.profiles set active=false where id=$1',[ids[1]]);
 await assert.rejects(as(ids[1],'select public.support_user_snapshot($1)',[ids[3]]),/Owner or admin/);
 await db.query('update public.profiles set active=true where id=$1',[ids[1]]);
});
test('client support snapshot uses the shared projection and inactive users get no private data',async()=>{
 const cid=(await db.query<any>("insert into public.clients(name) values('Support privacy fixture') returning id")).rows[0].id;
 await db.query('insert into public.client_members(user_id,client_id) values($1,$2) on conflict(user_id) do update set client_id=excluded.client_id',[ids[4],cid]);
 await as(ids[0],"insert into public.work_items(client_id,title,year_month,client_visible) values($1,'Shared fixture','2026-10',true),($1,'Private fixture','2026-10',false)",[cid]);
 const view=(await as(ids[1],'select public.support_user_snapshot($1) as snapshot',[ids[4]]))[0].snapshot;
 assert.deepEqual(view.clientView.items.map((w:any)=>w.title),['Shared fixture']);
 assert.equal('suggestions' in view,false);assert.equal('share_token' in view.clientView.client,false);
 assert.equal('actualHours' in view.clientView.items[0],false);
 await db.query('update public.profiles set active=false where id=$1',[ids[4]]);
 const inactive=(await as(ids[0],'select public.support_user_snapshot($1) as snapshot',[ids[4]]))[0].snapshot;
 assert.equal(inactive.inactive,true);assert.equal('clientView' in inactive,false);
 await db.query('update public.profiles set active=true where id=$1',[ids[4]]);
});

test('editing a suggestion accepts the edited task atomically in its selected project',async()=>{
 const cid=(await db.query<any>("insert into public.clients(name) values('Edited client') returning id")).rows[0].id;
 const project=(await as(ids[0],"insert into public.projects(client_id,name) values($1,'Selected project') returning id",[cid]))[0].id;
 const sid=await suggestion(ids[3],'task',crypto.randomUUID(),{client_id:cid});
 const s=(await db.query<any>('select * from public.sot_suggestions where id=$1',[sid])).rows[0];
 const args=[sid,s.updated_at,'Edited task','Edited description',cid,project,null,'2026-11-20',3];
 const sql='select public.sot_edit_and_accept($1,$2,$3,$4,$5,$6,$7,$8,$9) as id';
 await assert.rejects(as(ids[1],sql,args),/not found/);
 const rid=(await as(ids[3],sql,args))[0].id;
 const w=(await db.query<any>('select * from public.work_items where id=$1',[rid])).rows[0];
 assert.equal(w.project_id,project);assert.equal(w.title,'Edited task');assert.equal(w.description,'Edited description');assert.equal(w.assigned_user_id,ids[3]);assert.equal(Number(w.estimated_hours),3);
 assert.equal((await as(ids[3],sql,args))[0].id,rid);
 assert.equal((await db.query<any>("select count(*)::int n from public.workspace_audit where row_id=$1 and operation='EDIT_BEFORE_ADD'",[sid])).rows[0].n,1);
});
test('invalid or stale suggestion edits preserve the original pending suggestion',async()=>{
 const cid=(await db.query<any>("insert into public.clients(name) values('Edit rejection client') returning id")).rows[0].id;
 const project=(await db.query<any>('select id from public.projects where client_id=$1',[cid])).rows[0].id;
 const sid=await suggestion(ids[3],'task',crypto.randomUUID(),{client_id:cid});
 const s=(await db.query<any>('select * from public.sot_suggestions where id=$1',[sid])).rows[0];
 const sql='select public.sot_edit_and_accept($1,$2,$3,$4,$5,$6,$7,$8,$9)';
 await assert.rejects(as(ids[3],sql,[sid,s.updated_at,'Changed','Details',cid,crypto.randomUUID(),null,null,1]),/project belonging/);
 await assert.rejects(as(ids[3],sql,[sid,'2000-01-01','Changed','Details',cid,project,null,null,1]),/Suggestion changed/);
 const after=(await db.query<any>('select title,status,payload from public.sot_suggestions where id=$1',[sid])).rows[0];
 assert.equal(after.title,s.title);assert.equal(after.status,'pending');assert.deepEqual(after.payload,s.payload);
});
