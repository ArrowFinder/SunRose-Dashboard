import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sectionMessages,sectionInput,byteSize,cleanMessages,advanceSection,INPUT_BYTES} from '../supabase/functions/sot/sections.ts';
const message=(body:string,id='a',date='2026-10-10')=>({id,date,from:'client@example.test',to:'staff@sunrosecreative.com',subject:'Campaign',body});
test('long unicode threads retain every new message body and fit bounded sections',()=>{
 const text='Please update the project. 🌹 漢字 "quoted"\n'.repeat(800);
 const sections=sectionMessages([message(text)]);
 assert.ok(sections.length>1);
 assert.equal(sections.flat().map(m=>m.body.slice(m.overlap||0)).join(''),text);
 for(const section of sections)assert.ok(byteSize(section)<=8500);
});
test('only verified repeated quote blocks are removed; inline replies and unknown quotes survive',()=>{
 const original='Please make the newsletter available by Friday. This is the approved scope.';
 const cleaned=cleanMessages([message(original),message('My reply\n> '+original+'\nNew instruction: cancel the newsletter.','b','2026-10-11')]);
 assert.ok(cleaned[1].body.includes('Repeated quotation omitted'));
 assert.ok(cleaned[1].body.includes('cancel the newsletter'));
 assert.ok(cleanMessages([message('> Never seen this quotation before. Keep it.')])[0].body.includes('Never seen'));
});
test('large workspace context is explicitly bounded without deleting source evidence or earlier candidates',()=>{
 const context={clients:[{id:'matched',name:'Example'}],tasks:Array.from({length:60},(_,i)=>({id:i,title:'Long task'.repeat(60)})),projects:[],review_history:[],unconfirmed_suggestions:[]};
 const previous=[{title:'Earlier commitment',evidence:'Original quote'}];
 const input=sectionInput(context,[message('Later cancellation')],previous,3,4,'2026-10-10');
 assert.ok(new TextEncoder().encode(input).length<=INPUT_BYTES);
 const parsed=JSON.parse(input);assert.deepEqual(parsed.previous_candidates,previous);assert.equal(parsed.messages[0].body,'Later cancellation');assert.ok(parsed.context.omitted_context.tasks>0);assert.equal(context.tasks.length,60);assert.equal(parsed.section.final,true);
});
test('each pass checkpoints separately and later cancellation replaces provisional candidates',()=>{
 const initial={section_index:0,pass_index:0,candidates:{}};
 const clients=advanceSection(initial,'clients',[{kind:'client'}],2);
 assert.equal(clients.section_index,0);assert.equal(clients.pass_index,1);
 const task=advanceSection(clients,'tasks',[{title:'Send newsletter'}],2);
 assert.equal(task.section_index,1);assert.equal(task.pass_index,0);
 const next=advanceSection(task,'clients',[],2);
 const cancelled=advanceSection(next,'tasks',[],2);
 assert.deepEqual(cancelled.candidates.tasks,[]);assert.equal(cancelled.section_index,2);
 assert.deepEqual(initial.candidates,{});
});
test('oversized irreducible context is explicitly deferred rather than silently truncated',()=>{
 assert.throws(()=>sectionInput({clients:[]},[message('important')],[{evidence:'x'.repeat(20000)}],0,1,'2026-10-10'),/deferred/);
});
test('budget retry respects daily UTC reset and monthly cap without increasing limits',async()=>{
 const {budgetRetryAt}=await import('../supabase/functions/sot/sections.ts');
 const now=Date.parse('2026-10-10T18:00:00Z');
 const records=[{reserved_at:'2026-10-10T05:00:00Z',calls:20}];
 assert.equal(budgetRetryAt(now,{reserved_calls:388,analysis_limit:600},records),'2026-10-11T00:00:05.000Z');
 assert.equal(budgetRetryAt(now,{reserved_calls:600,analysis_limit:600},records),'2026-11-01T00:00:05.000Z');
 assert.equal(budgetRetryAt(now,{reserved_calls:388,analysis_limit:600},[{reserved_at:'2026-10-10T17:00:00Z',calls:10}]),'2026-10-10T20:00:05.000Z');
});
test('scan migration retains business data and keeps provisional evidence and attempt logs server-only',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFile,readdir}=await import('node:fs/promises');
 const db=new PGlite();
 await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 const dir=new URL('../supabase/migrations/',import.meta.url),latest='20261011000000_sot_scan_sections.sql';
 for(const name of (await readdir(dir)).sort().filter(n=>n<latest))await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists "pgcrypto";',''));
 const uid='00000000-0000-4000-8000-000000000001';
 await db.query(`insert into auth.users values($1,'test@example.test','{"display_name":"Test"}')`,[uid]);
 await db.query("insert into public.sot_connections(user_id,email,last_error) values($1,'test@example.test','Oversized conversation')",[uid]);
 const before=(await db.query('select * from public.clients')).rows;
 await db.exec(await readFile(new URL(latest,dir),'utf8'));
 assert.deepEqual((await db.query('select * from public.clients')).rows,before);
 await db.query("insert into public.sot_thread_progress(user_id,thread_id,fingerprint,section_index,candidates) values($1,'thread','hash',2,'{\"tasks\":[{\"title\":\"Provisional\"}]}')",[uid]);
 assert.equal((await db.query<any>('select section_index from public.sot_thread_progress')).rows[0].section_index,2);
 assert.equal((await db.query('select * from public.sot_suggestions')).rows.length,0);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from public.sot_thread_progress'),/permission denied/);
 await assert.rejects(db.query('select * from public.sot_scan_runs'),/permission denied/);
 await db.exec('reset role');await db.close();
});

test('new-message selection excludes reviewed and old mail but retains latest cancellation',async()=>{
 const {freshMessages}=await import('../supabase/functions/sot/sections.ts');
 const source=[message('Old project','old','2026-09-01'),message('Reviewed request','done','2026-10-09'),message('Cancel this task','new','2026-10-10')];
 assert.deepEqual(freshMessages(source,['done'],'2026-10-03','2026-10-11').map(m=>m.id),['new']);
});
test('Gmail history is compacted while deliberate repetitions and inline replies survive',()=>{
 const original='Please prepare the complete October campaign launch package for review.';
 const result=cleanMessages([message(original),message(original+'\nOn Friday, Client wrote:\n'+original+'\nActually cancel this work.','b','2026-10-11')]);
 assert.ok(result[1].body.startsWith(original));
 assert.ok(result[1].body.includes('Repeated quotation omitted'));
 assert.ok(result[1].body.includes('Actually cancel'));
});
