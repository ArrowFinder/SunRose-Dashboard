import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packRelated,pacificHour,tokenCost,BATCH_BYTES} from '../supabase/functions/sot/batches.ts';
const row=(id:string,group:string,body='Please update the campaign deadline to Friday.')=>({thread_id:id,fingerprint:id,group,payload:{messages:[{id,body,date:'2026-10-10',from:'a@example.test',to:'s@sunrosecreative.com'}],older_context:null}});
test('batch short conversations together but never different client groups',()=>{
 const result=packRelated([row('1','a'),row('2','b'),row('3','a')],()=>({clients:[],tasks:[]}))!;
 assert.equal(result.threads.length,2);assert.deepEqual(result.threads.map(t=>t.thread_id),['1','3']);
 const packet=JSON.parse(result.input!);assert.deepEqual(packet.conversations.map((t:any)=>t.messages[0].source_message_id),['1','3']);
});
test('oversized item defers without truncating evidence; empty queue uses no batch',()=>{
 assert.equal(packRelated([],()=>({})),null);
 assert.ok(packRelated([row('1','a','x'.repeat(20000))],()=>({}))?.oversized);
 const packed=packRelated([row('a','x'),row('b','x','x'.repeat(20000)),row('c','x')],()=>({}))!;
 assert.deepEqual(packed.threads.map(t=>t.thread_id),['a','c']);assert.ok(new TextEncoder().encode(packed.input!).length<=BATCH_BYTES);
});
test('Pacific quiet hours handle daylight saving; cost distinguishes cached tokens and unknown usage',()=>{
 assert.equal(pacificHour(new Date('2026-07-01T12:00:00Z')),5);assert.equal(pacificHour(new Date('2026-12-01T13:00:00Z')),5);
 assert.equal(tokenCost({input_tokens:1000,input_tokens_details:{cached_tokens:500},output_tokens:100}).estimated_usd,0.00041);
 assert.equal(tokenCost(null).estimated_usd,null);
});
test('Pacific allocation, atomic reservation, publication replay and privacy',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile,readdir}=await import('node:fs/promises');const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).sort())await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists "pgcrypto";',''));
 const uid='00000000-0000-4000-8000-000000000001',job='00000000-0000-4000-8000-000000000002';
 await db.query(`insert into auth.users values($1,'test@example.test','{"display_name":"Test"}')`,[uid]);await db.query("insert into sot_connections(user_id,email) values($1,'test@example.test')",[uid]);
 const b=async(time:string,manual=false)=>(await db.query<any>('select sot_budget($1,$2) b',[time,manual])).rows[0].b;
 assert.equal((await b('2026-07-01T12:00:00Z')).available,0);assert.equal((await b('2026-07-01T13:00:00Z')).available,3);assert.equal((await b('2026-07-01T19:00:00Z')).available,9);assert.equal((await b('2026-07-02T04:00:00Z',true)).available,10); // rolling guard
 const next=async(time:string)=>new Date((await db.query<any>('select sot_next_check($1) n',[time])).rows[0].n).toISOString();
 assert.equal(await next('2026-03-08T09:59:00Z'),'2026-03-08T13:00:00.000Z');assert.equal(await next('2026-11-01T08:59:00Z'),'2026-11-01T14:00:00.000Z');
 await db.query("insert into sot_call_reservations(reserved_at,calls) values('2026-07-01T06:59:00Z',2)");assert.equal((await b('2026-07-01T13:00:00Z')).daily_used,0);
 const snapshot={threads:[{thread_id:'thread',fingerprint:'hash',message_ids:['m1','m2']}]};
 await db.query("insert into sot_batch_jobs(id,user_id,status,snapshot) values($1,$2,'prepared',$3)",[job,uid,JSON.stringify(snapshot)]);
 // Manual reserve is permitted even during quiet hours, using the two-call reserve.
 assert.equal((await db.query<any>('select sot_reserve_batch($1,true) ok',[job])).rows[0].ok,true);
 assert.equal((await db.query<any>('select sot_reserve_batch($1,true) ok',[job])).rows[0].ok,false);
 await db.query("update sot_batch_jobs set status='answered',response='[]' where id=$1",[job]);
 await db.query("insert into sot_mail_queue(user_id,thread_id,fingerprint,status,oldest_at) values($1,'thread','hash','ready',now())",[uid]);
 const results=JSON.stringify([{thread_id:'thread',fingerprint:'hash',proposals:[]}]);await db.query('select sot_finish_batch($1,$2)',[job,results]);await db.query('select sot_finish_batch($1,$2)',[job,results]);
 assert.equal((await db.query('select * from sot_message_receipts')).rows.length,2);assert.equal((await db.query<any>('select status from sot_mail_queue')).rows[0].status,'done');
 await db.exec('set role authenticated');for(const table of ['sot_mail_queue','sot_message_receipts','sot_batch_jobs'])await assert.rejects(db.query('select * from '+table),/permission denied/);await assert.rejects(db.query('select sot_budget()'),/permission denied/);
 await db.close();
});
