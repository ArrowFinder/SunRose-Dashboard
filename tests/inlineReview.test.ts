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

test('inline creation is owner-only, persisted, scoped and repeat-safe',async()=>{
 await assert.rejects(as(employee,"select review_create_client('New inline client','Context')"),/Owner or admin/);
 const id=(await as(owner,"select review_create_client('New inline client','Agency services') id"))[0].id;
 assert.equal((await as(owner,"select review_create_client(' NEW INLINE CLIENT ','Overwrite?') id"))[0].id,id);
 assert.equal((await db.query<any>('select context_notes from sot_client_profiles where client_id=$1',[id])).rows[0].context_notes,'Agency services');
 const project=(await as(owner,"select review_create_project($1,'October event','Event preparation') id",[id]))[0].id;
 assert.equal((await as(owner,"select review_create_project($1,'October event','Other') id",[id]))[0].id,project);
 await assert.rejects(as(owner,"select review_create_project($1,'General','Scope')",[id]),/General/);
 await db.query("update projects set stage='completed' where id=$1",[project]);
 await assert.rejects(as(owner,"select review_create_project($1,'October event','Scope')",[id]),/active/);
});
test('review assigns new tasks and preserves edits; replay cannot reassign',async()=>{
 const s=await proposal(owner,'task','inline-task',{analysis_version:4,client_id:c.id,client_name:'Audit client',contact_email:'client@example.test',project_id:p.id,parent_id:null,due_date:null,estimated_hours:null,checklist:{identity_resolved:true}},'Inline task');
 const args=[s.id,s.updated_at,'Revised task','Revised description',c.id,p.id,null,'2026-11-01',2,employee];
 const sql='select sot_review_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) id';
 const id=(await as(owner,sql,args))[0].id;
 const row=(await db.query<any>('select * from work_items where id=$1',[id])).rows[0];
 assert.equal(row.assigned_user_id,employee);assert.equal(row.title,'Revised task');assert.equal(row.description,'Revised description');assert.equal(row.project_id,p.id);
 assert.equal((await as(owner,sql,[...args.slice(0,-1),other]))[0].id,id);
 assert.equal((await db.query<any>('select assigned_user_id from work_items where id=$1',[id])).rows[0].assigned_user_id,employee);
});
test('review rejects cross-client projects, stale suggestions and inactive assignees atomically',async()=>{
 const s=await proposal(owner,'task','inline-invalid',{client_id:c.id,client_name:'Audit client',checklist:{identity_resolved:true}},'Invalid review');
 const sql='select sot_review_submit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
 const args=[s.id,s.updated_at,s.title,s.description,c.id,p.id,null,null,null,employee];
 await assert.rejects(as(owner,sql,[...args.slice(0,1),'2000-01-01',...args.slice(2)]),/changed/);
 const c2=(await as(owner,"select review_create_client('Other inline client') id"))[0].id;
 await assert.rejects(as(owner,sql,[...args.slice(0,4),c2,...args.slice(5)]),/project/);
 await db.query('update profiles set active=false where id=$1',[employee]);
 await assert.rejects(as(owner,sql,args),/active teammate/);
 await db.query('update profiles set active=true where id=$1',[employee]);
 assert.equal((await db.query<any>('select status from sot_suggestions where id=$1',[s.id])).rows[0].status,'pending');
});
test('project review can explicitly select a client without accepting related tasks',async()=>{
 const s=await proposal(owner,'project','inline-project',{client_id:null,client_name:'Unknown',checklist:{identity_resolved:false}},'New engagement');
 const id=(await as(owner,'select sot_review_submit($1,$2,$3,$4,$5,null,null,null,null,null) id',[s.id,s.updated_at,s.title,'Confirmed scope',c.id]))[0].id;
 assert.equal((await db.query<any>('select client_id from projects where id=$1',[id])).rows[0].client_id,c.id);
});
test('team setup rejects non-managers and existing accounts; matching retries preserve the account',async()=>{
 const request='00000000-0000-4000-8000-000000000091',uid='00000000-0000-4000-8000-000000000092';
 const sql='select prepare_team_setup($1,$2,$3,$4,$5) r';
 await assert.rejects(as(owner,sql,[owner,request,'new@example.test','New employee','employee']),/permission denied/);
 await assert.rejects(as(employee,sql,[employee,request,'new@example.test','New employee','employee'],'service_role'),/Owner/);
 await assert.rejects(as(owner,sql,[owner,request,owner+'@example.test','Existing','employee'],'service_role'),/already has/);
 const r=(await as(owner,sql,[owner,request,'new@example.test','New employee','employee'],'service_role'))[0].r;
 const retry=(await as(owner,sql,[owner,'00000000-0000-4000-8000-000000000093','NEW@example.test','New employee','employee'],'service_role'))[0].r;
 assert.equal(r.id,retry.id);
 await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[uid,'new@example.test',JSON.stringify({display_name:'New employee',team_setup_id:request})]);
 await assert.rejects(as(owner,'select finish_team_setup($1,$2,$3)',[owner,request,other],'service_role'),/does not match/);
 await as(owner,'select finish_team_setup($1,$2,$3)',[owner,request,uid],'service_role');
 assert.equal((await db.query<any>('select role from profiles where id=$1',[uid])).rows[0].role,'employee');
 await db.query("update profiles set role='supervisor' where id=$1",[uid]);
 await as(owner,'select finish_team_setup($1,$2,$3)',[owner,request,uid],'service_role');
 assert.equal((await db.query<any>('select role from profiles where id=$1',[uid])).rows[0].role,'supervisor');
});
test('shared editor reclassifies suggestions to subtasks and preserves all entered task fields',async()=>{
 const s=await proposal(owner,'project','editor-subtask',{analysis_version:4,client_id:c.id,client_name:'Audit client',checklist:{identity_resolved:true}},'Editable work');
 const fields={title:'Review assets',description:'Edited scope',client_id:c.id,project_id:p.id,parent_id:task,assigned_user_id:employee,due_date:'2026-11-04',estimated_hours:2.5,year_month:'2026-11',status:'planned',client_visible:true};
 const sql='select sot_editor_submit($1,$2,$3,$4) id';
 const id=(await as(owner,sql,[s.id,s.updated_at,'subtask',fields]))[0].id;
 const row=(await db.query<any>('select * from work_items where id=$1',[id])).rows[0];
 assert.equal(row.parent_id,task);assert.equal(row.project_id,p.id);assert.equal(row.assigned_user_id,employee);assert.equal(row.year_month,'2026-11');assert.equal(row.status,'planned');assert.equal(row.client_visible,true);
 assert.equal((await as(owner,sql,[s.id,s.updated_at,'task',{...fields,title:'Retry must not rewrite'}]))[0].id,id);
 assert.equal((await db.query<any>('select title from work_items where id=$1',[id])).rows[0].title,'Review assets');
});
test('shared editor can turn a task suggestion into a project with billing and dates, atomically',async()=>{
 const s=await proposal(owner,'task','editor-project',{client_id:c.id,client_name:'Audit client',checklist:{identity_resolved:true}},'Conference');
 const fields={title:'November conference',description:'All conference deliverables',client_id:c.id,stage:'active',billing_type:'fixed_fee',fee:400,hour_budget:8,start_date:'2026-11-01',due_date:'2026-11-04'};
 const id=(await as(owner,'select sot_editor_submit($1,$2,$3,$4) id',[s.id,s.updated_at,'project',fields]))[0].id;
 const row=(await db.query<any>('select * from projects where id=$1',[id])).rows[0];assert.equal(row.stage,'active');assert.equal(Number(row.fee),400);assert.equal(row.description,fields.description);
 assert.equal((await db.query<any>('select count(*)::int n from work_items where title=$1',[fields.title])).rows[0].n,0);
 const invalid=await proposal(employee,'task','editor-not-owner',{client_id:c.id},'No access');
 await assert.rejects(as(employee,'select sot_editor_submit($1,$2,$3,$4)',[invalid.id,invalid.updated_at,'project',fields]),/Owner or admin/);
 await assert.rejects(as(other,'select sot_editor_submit($1,$2,$3,$4)',[invalid.id,invalid.updated_at,'task',fields]),/not found/);
 assert.equal((await db.query<any>('select kind from sot_suggestions where id=$1',[invalid.id])).rows[0].kind,'task');
});
test('existing leaf work can change parent while keeping identity; nested trees and running clocks stay protected',async()=>{
 const leaf=(await db.query<any>("insert into work_items(client_id,project_id,title,year_month) values($1,$2,'Move me','2026-11') returning id",[c.id,p.id])).rows[0].id;
 await db.query(`insert into time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,now()-interval '2 hours',now()-interval '1 hour',60)`,[leaf,owner]);
 const originalTime=(await db.query<any>('select * from time_entries where work_item_id=$1',[leaf])).rows[0];
 await as(owner,'update work_items set parent_id=$2 where id=$1',[leaf,task]);
 assert.equal((await db.query<any>('select parent_id from work_items where id=$1',[leaf])).rows[0].parent_id,task);
 await assert.rejects(as(owner,'update work_items set parent_id=$2 where id=$1',[task,leaf]),/subtasks|level/);
 await as(owner,'update work_items set parent_id=null where id=$1',[leaf]);
 await db.query('insert into active_timers(user_id,work_item_id,started_at) values($1,$2,now())',[owner,leaf]);
 await assert.rejects(as(owner,'update work_items set parent_id=$2 where id=$1',[leaf,task]),/clocks/);
 await db.query('delete from active_timers where user_id=$1',[owner]);
 assert.deepEqual((await db.query<any>('select * from time_entries where work_item_id=$1',[leaf])).rows[0],originalTime);
});
