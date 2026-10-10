import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {periodEnd,rangeMinutes,timeCsv} from '../src/lib/timeReporting';
const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
const dir=new URL('../supabase/migrations/',import.meta.url);
for(const name of (await readdir(dir)).sort())await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists "pgcrypto";',''));
const ids=['owner','employee','supervisor','client'].map((_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
for(const [i,role] of ['owner','employee','supervisor','client'].entries()){
 await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{\"display_name\":\"Test user\"}')",[ids[i],role+'@example.test']);await db.query('update public.profiles set role=$2 where id=$1',[ids[i],role]);
}
async function as(id:string,sql:string,args:unknown[]=[]){await db.exec('begin');try{await db.exec('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);const r=await db.query<any>(sql,args);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
const cid=(await db.query<any>("insert into public.clients(name) values('Time client') returning id")).rows[0].id;
const pid=(await db.query<any>('select id from public.projects where client_id=$1',[cid])).rows[0].id;
const task=(await db.query<any>("insert into public.work_items(client_id,title,year_month) values($1,'Time task','2026-01') returning id",[cid])).rows[0].id;
const sql='select public.save_time_log($1,$2,$3,$4,$5,$6,$7,$8) as id';
let eid:string;
test('employees log project-only time and edit their own timestamps with stale-write protection',async()=>{
 eid=(await as(ids[1],sql,[null,null,pid,null,'2026-01-02T10:00Z','2026-01-02T11:00Z','Planning',false]))[0].id;
 let e=(await db.query<any>('select * from public.time_entries where id=$1',[eid])).rows[0];
 assert.equal(e.project_id,pid);assert.equal(e.work_item_id,null);assert.equal(e.duration_minutes,60);
 await as(ids[1],sql,[eid,e.updated_at,pid,task,'2026-01-02T10:00Z','2026-01-02T11:30Z','Corrected',true]);
 await assert.rejects(as(ids[1],sql,[eid,e.updated_at,pid,task,'2026-01-02T10:00Z','2026-01-02T11:00Z','Stale',true]),/changed/);
 assert.equal((await db.query<any>('select duration_minutes from public.time_entries where id=$1',[eid])).rows[0].duration_minutes,90);
 assert.ok((await db.query<any>("select count(*)::int n from public.workspace_audit where table_name='time_entries' and row_id=$1",[eid])).rows[0].n>=2);
});
test('employee cannot edit someone else; supervisor can; clients cannot log time',async()=>{
 const other=(await as(ids[0],sql,[null,null,pid,null,'2026-01-02T10:00Z','2026-01-02T11:00Z','Owner',true]))[0].id;
 const e=(await db.query<any>('select * from public.time_entries where id=$1',[other])).rows[0];
 const args=[other,e.updated_at,pid,null,'2026-01-02T10:00Z','2026-01-02T11:15Z','Adjusted',true];
 await assert.rejects(as(ids[1],sql,args),/only your own/);
 await as(ids[2],sql,args);
 await assert.rejects(as(ids[3],sql,[null,null,pid,null,'2026-01-02T10:00Z','2026-01-02T11:00Z','',true]),/Staff/);
 await assert.rejects(as(ids[1],'select public.void_time_entry($1,$2)',[other,'Not mine']),/only your own/);
 await as(ids[1],'select public.void_time_entry($1,$2)',[eid,'Entered by mistake']);
 assert.ok((await db.query<any>('select voided_at from public.time_entries where id=$1',[eid])).rows[0].voided_at);
});
test('project timer is unique, stale stops rejected, and correction retains project association',async()=>{
 const t=(await as(ids[1],'select (public.start_project_timer($1)).*',[pid]))[0];
 const again=(await as(ids[1],'select (public.start_project_timer($1)).*',[pid]))[0];assert.equal(String(t.started_at),String(again.started_at));
 await assert.rejects(as(ids[1],'select public.stop_work_timer($1,$2)',[task,t.started_at]),/changed/);
 await as(ids[1],'select public.correct_work_timer($1,$2,$3,$4)',[null,t.started_at,t.started_at,'Immediate stop']);
 const e=(await db.query<any>('select * from public.time_entries where user_id=$1 and voided_at is null order by created_at desc limit 1',[ids[1]])).rows[0];
 assert.equal(e.project_id,pid);assert.equal(e.work_item_id,null);
 assert.equal((await db.query('select * from public.active_timers')).rows.length,0);
});
test('manual log refuses cross-project tasks and future time',async()=>{
 const other=(await db.query<any>("insert into public.projects(client_id,name) values($1,'Other') returning id",[cid])).rows[0].id;
 await assert.rejects(as(ids[1],sql,[null,null,other,task,'2026-01-02T10:00Z','2026-01-02T11:00Z','',true]),/task in this project/);
 await assert.rejects(as(ids[1],sql,[null,null,pid,null,'2100-01-02T10:00Z','2100-01-02T11:00Z','',true]),/valid time range/);
});
test('periods cover biweekly and calendar month ends and exports neutralize formulas',()=>{
 assert.equal(periodEnd('2026-01-26','biweekly'),'2026-02-08');
 assert.equal(periodEnd('2024-02-01','monthly'),'2024-02-29');
 assert.equal(periodEnd('2026-01-16','semimonthly'),'2026-01-31');
 assert.equal(timeCsv([['=SUM(A1)', 'a"b']]),'"\'=SUM(A1)","a""b"');
 const e={startedAt:new Date('2026-01-31T23:00:00').toISOString(),endedAt:new Date('2026-02-01T01:00:00').toISOString(),durationMinutes:120} as any;
 assert.equal(rangeMinutes(e,'2026-02-01','2026-02-28'),60);
});

test('manual create retries use the same entry instead of double-counting hours',async()=>{
 const request=crypto.randomUUID();
 const args=[null,null,pid,null,'2026-01-03T10:00Z','2026-01-03T11:00Z','Retry-safe',true,request];
 const q='select public.save_time_log($1,$2,$3,$4,$5,$6,$7,$8,$9) as id';
 assert.equal((await as(ids[1],q,args))[0].id,(await as(ids[1],q,args))[0].id);
});

test('project-only billable time contributes to its client totals without a synthetic task',async()=>{
 const {usedHoursForMonth}=await import('../src/lib/scopeMath');
 const entry={id:'project-log',workItemId:null,projectId:pid,clientId:cid,userId:ids[1],startedAt:'2026-01-02T10:00:00Z',endedAt:'2026-01-02T11:00:00Z',durationMinutes:60,billable:true,note:'',createdAt:''};
 assert.equal(usedHoursForMonth([],cid,'2026-01',[entry]),1);
 assert.equal(usedHoursForMonth([],'another-client','2026-01',[entry]),0);
 assert.equal(usedHoursForMonth([],cid,'2026-01',[{...entry,billable:false}]),0);
});

test('switching from a project clock to a task clock preserves both entries',async()=>{
 await as(ids[1],'select public.start_project_timer($1)',[pid]);
 const t=(await as(ids[1],'select (public.start_work_timer($1,$2)).*',[task,crypto.randomUUID()]))[0];
 assert.equal(t.project_id,pid);assert.equal(t.work_item_id,task);
 await as(ids[1],'select public.stop_work_timer($1,$2)',[task,t.started_at]);
 const rows=(await db.query<any>('select work_item_id,project_id from public.time_entries where user_id=$1 and voided_at is null',[ids[1]])).rows;
 assert.ok(rows.some(r=>r.work_item_id===task&&r.project_id===pid));
 assert.ok(rows.some(r=>r.work_item_id===null&&r.project_id===pid));
});
test('project-only running clocks block client archiving',async()=>{
 const t=(await as(ids[1],'select (public.start_project_timer($1)).*',[pid]))[0];
 await assert.rejects(as(ids[0],'update public.clients set archived_at=now() where id=$1',[cid]),/Stop project timers/);
 await as(ids[1],'select public.stop_work_timer($1,$2)',[null,t.started_at]);
});
