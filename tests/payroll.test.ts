import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
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
const pid=(await db.query<any>("insert into public.projects(client_id,name) values($1,'Time engagement') returning id",[cid])).rows[0].id;
const task=(await db.query<any>("insert into public.work_items(client_id,project_id,title,year_month) values($1,$2,'Time task','2026-01') returning id",[cid,pid])).rows[0].id;
const sql='select public.save_time_log($1,$2,$3,$4,$5,$6,$7,$8) as id';


const command='select public.change_pay_period($1,$2,$3,$4)';
async function period(id:string){return (await db.query<any>('select * from public.pay_periods where id=$1',[id])).rows[0];}
async function change(id:string,action:string,actor=ids[0],reason=''){const p=await period(id);return as(actor,command,[id,p.updated_at,action,reason]);}
let payId:string,entry:string;
test('pay rates are private and periods preserve their original rate',async()=>{
 await as(ids[0],"select public.set_staff_pay_rate($1,25,'USD')",[ids[1]]);
 await assert.rejects(as(ids[2],"select public.set_staff_pay_rate($1,100,'USD')",[ids[1]]),/Owner or admin/);
 await assert.rejects(as(ids[1],'select * from public.staff_pay_rates'),/permission denied/);
 payId=(await as(ids[0],"select public.create_pay_period($1,'2025-01-01','2025-01-14','America/Los_Angeles','biweekly') as id",[ids[1]]))[0].id;
 await as(ids[0],"select public.set_staff_pay_rate($1,30,'USD')",[ids[1]]);
 assert.equal((await period(payId)).hourly_rate,'25.00');
 const manager=(await as(ids[2],'select public.payroll_data() as data'))[0].data;
 assert.deepEqual(manager.rates,[]);assert.equal(manager.periods[0].hourly_rate,null);
 await assert.rejects(as(ids[0],"select public.create_pay_period($1,'2025-01-10','2025-01-20','UTC','custom')",[ids[1]]),/overlapping/);
 await assert.rejects(as(ids[3],'select public.payroll_data()'),/Staff/);
});
test('submission snapshots all worked time and freezes every correction path',async()=>{
 entry=(await as(ids[1],sql,[null,null,pid,null,'2025-01-02T18:00Z','2025-01-02T20:00Z','Nonbillable work',false]))[0].id;
 await change(payId,'submit',ids[1]);
 assert.equal(Number((await period(payId)).minutes),120);
 const e=(await db.query<any>('select * from public.time_entries where id=$1',[entry])).rows[0];
 await assert.rejects(as(ids[1],sql,[entry,e.updated_at,pid,null,'2025-01-15T18:00Z','2025-01-15T20:00Z','Move outside',true]),/original entry/);
 await assert.rejects(as(ids[0],'select public.void_time_entry($1,$2)',[entry,'Remove']),/protected|submitted/);
 await assert.rejects(as(ids[1],sql,[null,null,pid,null,'2025-01-03T18:00Z','2025-01-03T20:00Z','Late',true]),/submitted/);
 await assert.rejects(as(ids[1],"update public.pay_periods set status='draft' where id=$1",[payId]),/permission denied/);
});
test('approval and lock permissions, stale actions and audited reopening',async()=>{
 await assert.rejects(change(payId,'approve',ids[1]),/manager/);
 const stamp=(await period(payId)).updated_at;
 await change(payId,'approve',ids[2]);
 await assert.rejects(as(ids[0],command,[payId,stamp,'lock','']),/changed/);
 await assert.rejects(change(payId,'lock',ids[2]),/Owner\/admin/);
 await change(payId,'lock');
 await assert.rejects(change(payId,'return',ids[2],'Fix times'),/only Owner\/Admin/);
 await change(payId,'return',ids[0],'Forgotten clock correction');
 assert.equal((await period(payId)).status,'draft');assert.equal(Number((await period(payId)).minutes),0);
 await change(payId,'refresh_rate');assert.equal((await period(payId)).hourly_rate,'30.00');
 assert.ok((await db.query<any>("select count(*)::int n from public.workspace_audit where table_name='pay_periods' and row_id=$1",[payId])).rows[0].n>=5);
});
test('employees see only their own periods and overlapping entries block submission',async()=>{
 const other=(await as(ids[0],"select public.create_pay_period($1,'2025-01-01','2025-01-31','UTC','monthly') as id",[ids[0]]))[0].id;
 const visible=(await as(ids[1],'select public.payroll_data() as data'))[0].data.periods;
 assert.equal(visible.length,1);assert.equal(visible[0].id,payId);
 await assert.rejects(change(other,'submit',ids[1]),/not found/);
 await as(ids[1],sql,[null,null,pid,null,'2025-01-02T19:00Z','2025-01-02T21:00Z','Overlap',true]);
 await assert.rejects(change(payId,'submit',ids[1]),/overlapping time/);
});

test('period timezone clips overnight time and includes minimum-minute clock entries',async()=>{
 const id=(await as(ids[0],"select public.create_pay_period($1,'2025-03-09','2025-03-09','America/Los_Angeles','custom') as id",[ids[1]]))[0].id;
 await as(ids[1],sql,[null,null,pid,null,'2025-03-09T07:00Z','2025-03-09T09:00Z','Cross midnight',true]);
 await as(ids[1],"insert into public.time_entries(project_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2025-03-09T10:00Z','2025-03-09T10:00Z',1)",[pid,ids[1]]);
 await change(id,'submit',ids[1]);
 assert.equal(Number((await period(id)).minutes),61);
 await assert.rejects(as(ids[1],"insert into public.time_entries(project_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2025-03-09T08:00Z','2025-03-09T08:00Z',1)",[pid,ids[1]]),/submitted/);
});
test('cancelled drafts preserve history and release the date range',async()=>{
 const id=(await as(ids[0],"select public.create_pay_period($1,'2025-02-01','2025-02-14','UTC','biweekly') as id",[ids[1]]))[0].id;
 await change(id,'cancel');assert.equal((await period(id)).status,'cancelled');
 await assert.rejects(change(id,'submit',ids[1]),/draft/);
 const replacement=(await as(ids[0],"select public.create_pay_period($1,'2025-02-01','2025-02-14','UTC','biweekly') as id",[ids[1]]))[0].id;
 assert.notEqual(replacement,id);
});
test('unfinished periods and running clocks cannot be submitted',async()=>{
 const id=(await as(ids[0],"select public.create_pay_period($1,'2100-01-01','2100-01-14','UTC','biweekly') as id",[ids[1]]))[0].id;
 await assert.rejects(change(id,'submit',ids[1]),/must end/);
 const p=(await as(ids[0],"select public.create_pay_period($1,'2025-04-01','2025-04-14','UTC','biweekly') as id",[ids[1]]))[0].id;
 await db.query("insert into public.active_timers(user_id,project_id,started_at) values($1,$2,'2025-04-02T10:00Z')",[ids[1],pid]);
 await assert.rejects(change(p,'submit',ids[1]),/running timer/);
});
