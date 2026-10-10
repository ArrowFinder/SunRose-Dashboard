import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
const dir=new URL('../supabase/migrations/',import.meta.url);const migration='20261010010000_projects.sql';
for(const name of (await readdir(dir)).sort().filter(n=>n<migration))await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists "pgcrypto";',''));
const owner='00000000-0000-4000-8000-000000000001',employee='00000000-0000-4000-8000-000000000002';
await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'owner@test.test','{"display_name":"Owner"}'),($2,'employee@test.test','{"display_name":"Employee"}')`,[owner,employee]);
await db.query("update public.profiles set role=case when id=$1 then 'owner'::public.app_role else 'employee'::public.app_role end",[owner]);
async function as(id:string,sql:string,args:unknown[]=[]){await db.exec('begin');try{await db.exec('set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);const r=await db.query<any>(sql,args);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}}
const cid=(await db.query<any>("insert into public.clients(name) values('Existing client') returning id")).rows[0].id;
const root=(await db.query<any>("insert into public.work_items(client_id,title,year_month,assigned_user_id) values($1,'Existing root','2026-10',$2) returning id",[cid,employee])).rows[0].id;
const child=(await db.query<any>("insert into public.work_items(client_id,parent_id,title,year_month) values($1,$2,'Existing child','2026-10') returning id",[cid,root])).rows[0].id;
await as(employee,"insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,now()-interval '1 hour',now(),60)",[child,employee]);
const beforeWork=(await db.query<any>('select id,client_id,parent_id,assigned_user_id,title,actual_hours from public.work_items order by id')).rows;
const beforeTime=(await db.query<any>('select * from public.time_entries order by id')).rows;
await db.exec(await readFile(new URL(migration,dir),'utf8'));
test('migration preserves task identity, assignments and exact time entries',async()=>{
 assert.deepEqual((await db.query('select id,client_id,parent_id,assigned_user_id,title,actual_hours from public.work_items order by id')).rows,beforeWork);
 assert.deepEqual((await db.query('select * from public.time_entries order by id')).rows,beforeTime);
 const rows=(await db.query<any>('select project_id from public.work_items')).rows;
 assert.ok(rows[0].project_id);assert.equal(rows[0].project_id,rows[1].project_id);
 assert.equal((await db.query<any>('select name from public.projects where id=$1',[rows[0].project_id])).rows[0].name,'General');
});
test('new clients and legacy task creation get a General project automatically',async()=>{
 const c=(await as(owner,"insert into public.clients(name) values('New client') returning id"))[0].id;
 const w=(await as(employee,"insert into public.work_items(client_id,title,year_month) values($1,'New task','2026-10') returning project_id",[c]))[0];
 assert.ok(w.project_id);
 await assert.rejects(as(employee,"insert into public.projects(client_id,name) values($1,'No permission')",[c]),/row-level security/);
});
test('cross-client project assignments are rejected and parent moves carry children',async()=>{
 const p=(await as(owner,"insert into public.projects(client_id,name,billing_type,fee) values($1,'Event','fixed_fee',500) returning id",[cid]))[0].id;
 await as(employee,'update public.work_items set project_id=$1 where id=$2',[p,root]);
 assert.equal((await db.query<any>('select project_id from public.work_items where id=$1',[child])).rows[0].project_id,p);
 const foreign=(await db.query<any>('select id from public.projects where client_id<>$1 limit 1',[cid])).rows[0].id;
 await assert.rejects(as(employee,'update public.work_items set project_id=$1 where id=$2',[foreign,root]),/foreign key/);
 await assert.rejects(as(employee,'update public.work_items set project_id=$1 where id=$2',[foreign,child]),/parent project/);
 assert.deepEqual((await db.query('select * from public.time_entries order by id')).rows,beforeTime);
});
test('running clocks prevent project reassignment and projects retain audit history',async()=>{
 const p=(await as(owner,"insert into public.projects(client_id,name) values($1,'Another project') returning id",[cid]))[0].id;
 await as(employee,'select public.start_work_timer($1,$2)',[child,crypto.randomUUID()]);
 await assert.rejects(as(employee,'update public.work_items set project_id=$1 where id=$2',[p,root]),/Stop running timers/);
 assert.ok((await db.query<any>("select count(*)::int n from public.workspace_audit where table_name='projects'")).rows[0].n>0);
});
test('project billing and dates validate and an empty client remains removable',async()=>{
 await assert.rejects(as(owner,"insert into public.projects(client_id,name,hourly_rate) values($1,'Bad rate',-1)",[cid]),/check constraint/);
 await assert.rejects(as(owner,"insert into public.projects(client_id,name,start_date,due_date) values($1,'Bad dates','2026-11-01','2026-10-01')",[cid]),/check constraint/);
 const c=(await as(owner,"insert into public.clients(name) values('Disposable client') returning id"))[0].id;
 await as(owner,'delete from public.clients where id=$1',[c]);
 assert.equal((await db.query('select * from public.projects where client_id=$1',[c])).rows.length,0);
});

test('project fields survive workspace backup export and import',async()=>{
 const {bundleToExport,parseImportFile}=await import('../src/lib/exchange.ts');
 const {projectFromRow}=await import('../src/lib/cloud.ts');
 const projects=JSON.parse(JSON.stringify((await db.query<any>('select * from public.projects')).rows)).map(projectFromRow);
 const bundle={clients:[],workItems:[],users:[],timeEntries:[],taskTemplates:[],projects};
 assert.deepEqual(parseImportFile(JSON.stringify(bundleToExport(bundle))).projects,projects);
});


test('client task projection shows project names without internal billing fields',async()=>{
 await db.exec(await readFile(new URL('20261010030000_client_project_labels.sql',dir),'utf8'));
 await db.query('update public.work_items set client_visible=true where id=$1',[root]);
 const result=(await db.query<any>('select public.client_task_items($1) as items',[cid])).rows[0].items;
 const item=result.find((w:any)=>w.id===root);
 assert.ok(item.projectId);assert.equal(item.projectName,'Event');
 assert.equal(item.fee,undefined);assert.equal(item.hourly_rate,undefined);assert.equal(item.description,undefined);
});

test('required project migration preserves legacy work and forbids new General assignments',async()=>{
 await db.exec('delete from public.active_timers');
 const legacy=(await db.query<any>("select w.* from public.work_items w join public.projects p on p.id=w.project_id where p.is_default limit 1")).rows[0];
 const timeBefore=(await db.query('select * from public.time_entries order by id')).rows;
 await db.exec(await readFile(new URL('20261010080000_require_task_projects.sql',dir),'utf8'));
 await as(employee,'update public.work_items set description=$1 where id=$2',['Still usable while awaiting assignment',legacy.id]);
 await assert.rejects(as(employee,"insert into public.work_items(client_id,title,year_month) values($1,'Missing project','2026-10')",[legacy.client_id]),/Choose a specific project/);
 await assert.rejects(as(employee,"insert into public.work_items(client_id,project_id,title,year_month) values($1,$2,'General task','2026-10')",[legacy.client_id,legacy.project_id]),/Choose a specific project/);
 await assert.rejects(as(owner,"insert into public.projects(client_id,name) values($1,' General ')",[legacy.client_id]),/specific project name/);
 const p=(await as(owner,"insert into public.projects(client_id,name) values($1,'Actual engagement') returning id",[legacy.client_id]))[0].id;
 await as(employee,'update public.work_items set project_id=$1 where id=$2',[p,legacy.id]);
 await assert.rejects(as(employee,'update public.work_items set project_id=$1 where id=$2',[legacy.project_id,legacy.id]),/Choose a specific project/);
 const c=(await as(owner,"insert into public.clients(name) values('No automatic project') returning id"))[0].id;
 assert.equal((await db.query('select id from public.projects where client_id=$1',[c])).rows.length,0);
 assert.deepEqual((await db.query('select * from public.time_entries order by id')).rows,timeBefore);
});
