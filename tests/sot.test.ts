import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
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
const payload={client_name:'Acme Studio',contact_email:'alex@acme.test',client_id:null,parent_id:null,task_id:null,due_date:'2026-11-10',estimated_hours:2};
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
