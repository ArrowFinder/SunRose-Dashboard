import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const dir=new URL('../supabase/migrations/',import.meta.url);
const names=(await readdir(dir)).sort();
const first='20261010010000_projects.sql';
async function apply(db:PGlite,files:string[]){for(const name of files)await db.exec((await readFile(new URL(name,dir),'utf8')).replace('create extension if not exists "pgcrypto";',''));}
async function snapshot(db:PGlite){
 const tables=(await db.query<{schemaname:string;tablename:string}>("select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename")).rows;
 const result:Record<string,unknown>={};
 for(const t of tables)result[t.schemaname+'.'+t.tablename]=(await db.query(`select to_jsonb(t) as row from "${t.schemaname}"."${t.tablename}" t order by to_jsonb(t)::text`)).rows;
 return result;
}
test('full database backup restores before migration and after project/time/pay-period upgrade',async()=>{
 const original=new PGlite();
 await original.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 await apply(original,names.filter(n=>n<first));
 const owner='00000000-0000-4000-8000-000000000001',employee='00000000-0000-4000-8000-000000000002';
 await original.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'owner@release.test','{"display_name":"Release owner"}'),($2,'employee@release.test','{"display_name":"Release employee"}')`,[owner,employee]);
 await original.query("update public.profiles set role=case when id=$1 then 'owner'::public.app_role else 'employee'::public.app_role end",[owner]);
 const cid=(await original.query<any>("insert into public.clients(name) values('Restore rehearsal') returning id")).rows[0].id;
 const wid=(await original.query<any>("insert into public.work_items(client_id,title,year_month,assigned_user_id) values($1,'Preserve real identifiers','2025-01',$2) returning id",[cid,employee])).rows[0].id;
 await original.query("insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes,note) values($1,$2,'2025-01-02T10:00Z','2025-01-02T11:30Z',90,'Preserve this history')",[wid,employee]);
 await original.query("insert into public.active_timers(user_id,work_item_id,started_at) values($1,$2,now())",[employee,wid]);
 const before=await snapshot(original), backup=await original.dumpDataDir();
 assert.ok(backup.size>0);
 const upgraded=new PGlite({loadDataDir:backup});
 assert.deepEqual(await snapshot(upgraded),before);
 await apply(upgraded,names.filter(n=>n>=first));
 const work=(await upgraded.query<any>('select * from public.work_items where id=$1',[wid])).rows[0];
 assert.equal(work.title,'Preserve real identifiers');assert.equal(work.assigned_user_id,employee);assert.ok(work.project_id);
 const time=(await upgraded.query<any>('select * from public.time_entries where work_item_id=$1',[wid])).rows[0];
 assert.equal(time.duration_minutes,90);assert.equal(time.note,'Preserve this history');assert.equal(time.project_id,work.project_id);
 const timer=(await upgraded.query<any>('select * from public.active_timers where user_id=$1',[employee])).rows[0];assert.equal(timer.work_item_id,wid);assert.equal(timer.project_id,work.project_id);
 await upgraded.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await upgraded.query("select public.set_staff_pay_rate($1,25,'USD')",[employee]);
 const pay=(await upgraded.query<any>("select public.create_pay_period($1,'2025-01-01','2025-01-14','UTC','biweekly') as id",[employee])).rows[0].id;
 for(const action of ['submit','approve','lock']){const stamp=(await upgraded.query<any>('select updated_at from public.pay_periods where id=$1',[pay])).rows[0].updated_at;await upgraded.query('select public.change_pay_period($1,$2,$3,$4)',[pay,stamp,action,'']);}
 const after=await snapshot(upgraded);
 const restored=new PGlite({loadDataDir:await upgraded.dumpDataDir()});
 assert.deepEqual(await snapshot(restored),after);
 // Restored permissions and triggers still protect submitted payroll history.
 await restored.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await assert.rejects(restored.query("select public.void_time_entry($1,'Restore verification')",[time.id]),/submitted/);
 await restored.exec('set role authenticated');
 await assert.rejects(restored.query('select * from public.staff_pay_rates'),/permission denied/);
 // The pre-upgrade backup still restores the original schema and exact rows.
 const rollback=new PGlite({loadDataDir:backup});assert.deepEqual(await snapshot(rollback),before);
 assert.equal((await rollback.query<any>("select to_regclass('public.projects') as name")).rows[0].name,null);
 await Promise.all([original.close(),upgraded.close(),restored.close(),rollback.close()]);
});
