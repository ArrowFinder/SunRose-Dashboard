import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001",
  employee = "00000000-0000-4000-8000-000000000002",
  clientUser = "00000000-0000-4000-8000-000000000003",
  outsider = "00000000-0000-4000-8000-000000000004";
const clientA = "10000000-0000-4000-8000-000000000001",
  clientB = "10000000-0000-4000-8000-000000000002";
const taskA = "20000000-0000-4000-8000-000000000001",
  privateTask = "20000000-0000-4000-8000-000000000002",
  taskB = "20000000-0000-4000-8000-000000000003";
async function as(user, sql, args = []) {
  await db.exec("begin");
  try {
    await db.exec(
      user ? "set local role authenticated" : "set local role anon",
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user ?? "",
    ]);
    const result = await db.query(sql, args);
    await db.exec("commit");
    return result.rows;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
await db.exec(
  `create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
const first = (
  await readFile(
    new URL(
      "../supabase/migrations/20250201000000_profiles.sql",
      import.meta.url,
    ),
    "utf8",
  )
).replace('create extension if not exists "pgcrypto";', "");
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260923000000_shared_workspace.sql",
    import.meta.url,
  ),
  "utf8",
);
await db.exec(first);
await db.exec(migration);
await db.exec(await readFile(new URL("../supabase/migrations/20260930000000_actual_hours_override.sql",import.meta.url),"utf8"));
await db.exec(await readFile(new URL("../supabase/migrations/20260930010000_subtasks.sql",import.meta.url),"utf8"));
await db.exec(
  `insert into auth.users(id,email) values('${owner}','owner@example.test'),('${employee}','employee@example.test'),('${clientUser}','client@example.test'),('${outsider}','outsider@example.test');update public.profiles set role='owner' where id='${owner}';update public.profiles set role='employee' where id='${employee}';insert into public.clients(id,name,share_token) values('${clientA}','Client A','token-a'),('${clientB}','Client B','token-b');insert into public.client_members(user_id,client_id) values('${clientUser}','${clientA}');insert into public.work_items(id,client_id,year_month,title,client_visible) values('${taskA}','${clientA}','2026-09','Shared A',true),('${privateTask}','${clientA}','2026-09','Internal notes',false),('${taskB}','${clientB}','2026-09','Shared B',true);`,
);

test("signed-in client receives only narrow fields, never raw tables", async () => {
  assert.equal((await as(clientUser,"select * from public.clients")).length,0);
  assert.equal((await as(clientUser,"select * from public.work_items")).length,0);
  const [row]=await as(clientUser,"select public.member_client_view() as view");
  assert.equal(row.view.client.name,"Client A");
  assert.equal(row.view.client.share_token,undefined);
  assert.equal(row.view.items.length,1);
  assert.equal(row.view.items[0].title,"Shared A");
  assert.equal(row.view.items[0].description,undefined);
  assert.equal((await as(outsider,"select * from public.work_items")).length,0);
});

test("anonymous share link returns narrow fields without exposing another client", async () => {
  const [r] = await as(
    null,
    "select public.shared_client_view($1,$2) as view",
    ["token-a", "2026-09"],
  );
  assert.deepEqual(r.view.client, { name: "Client A" });
  assert.equal(r.view.items.length, 1);
  assert.deepEqual(Object.keys(r.view.items[0]).sort(), [
    "completedSubtasks",
    "dueDate",
    "id",
    "parentId",
    "status",
    "title",
    "totalSubtasks",
  ]);
  await assert.rejects(
    as(null, "select public.shared_client_view($1,$2)", ["wrong", "2026-09"]),
  );
  await assert.rejects(as(null, "select * from public.work_items"));
});
test("new accounts cannot self-promote or gain team access", async () => {
  await assert.rejects(
    as(outsider, "update public.profiles set role='owner' where id=$1", [
      outsider,
    ]),
  );
  await assert.rejects(
    as(employee, "select public.manage_member($1,'owner','me',true,null)", [
      employee,
    ]),
  );
  assert.equal(
    (
      await as(outsider, "select role from public.profiles where id=$1", [
        outsider,
      ])
    )[0].role,
    "client",
  );
});
test("owner assigns an existing account to the team", async () => {
  await as(
    owner,
    "select public.manage_member($1,'employee','New employee',true,null)",
    [outsider],
  );
  assert.equal(
    (await as(outsider, "select * from public.work_items")).length,
    3,
  );
});
test("timer survives reload, switching saves previous task, stale stop is rejected", async () => {
  const [started] = await as(
    employee,
    "select (public.start_work_timer($1,$2)).*",
    [taskA, "30000000-0000-4000-8000-000000000001"],
  );
  const [persisted] = await as(employee, "select * from public.active_timers");
  assert.equal(persisted.work_item_id, taskA);
  await as(employee, "select public.start_work_timer($1,$2)", [
    taskB,
    "30000000-0000-4000-8000-000000000002",
  ]);
  assert.equal(
    (await as(owner, "select * from public.time_entries")).length,
    1,
  );
  await assert.rejects(
    as(employee, "select public.stop_work_timer($1,$2)", [
      taskA,
      started.started_at,
    ]),
  );
  assert.equal(
    (await as(employee, "select * from public.active_timers"))[0].work_item_id,
    taskB,
  );
});
test("duplicate start request cannot switch back; duplicate stop saves once", async () => {
  await as(employee, "select public.start_work_timer($1,$2)", [
    taskA,
    "30000000-0000-4000-8000-000000000001",
  ]);
  const [timer] = await as(employee, "select * from public.active_timers");
  assert.equal(timer.work_item_id, taskB);
  await as(employee, "select public.stop_work_timer($1,$2)", [
    taskB,
    timer.started_at,
  ]);
  await as(employee, "select public.stop_work_timer($1,$2)", [
    taskB,
    timer.started_at,
  ]);
  assert.equal(
    (await as(owner, "select * from public.time_entries")).length,
    2,
  );
  assert.equal(
    (await as(employee, "select * from public.active_timers")).length,
    0,
  );
});
test("cannot forge another employee’s time or access timer as a client", async () => {
  await assert.rejects(
    as(
      employee,
      "insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,now()-interval '1 minute',now(),1)",
      [taskA, owner],
    ),
  );
  await assert.rejects(
    as(clientUser, "select public.start_work_timer($1,$2)", [
      taskA,
      "30000000-0000-4000-8000-000000000005",
    ]),
  );
});
test("time history is retained when voided and protects parent deletion", async () => {
  const [entry] = await as(
    owner,
    "select * from public.time_entries order by id",
  );
  await assert.rejects(
    as(owner, "delete from public.work_items where id=$1", [
      entry.work_item_id,
    ]),
  );
  await assert.rejects(
    as(owner, "delete from public.clients where id=$1", [clientA]),
  );
  await assert.rejects(
    as(employee, "select public.void_time_entry($1,$2)", [entry.id, "wrong"]),
  );
  await as(owner, "select public.void_time_entry($1,$2)", [
    entry.id,
    "Duplicate manual record",
  ]);
  const [saved] = await as(
    owner,
    "select * from public.time_entries where id=$1",
    [entry.id],
  );
  assert.ok(saved.voided_at);
  assert.equal(saved.void_reason, "Duplicate manual record");
  assert.ok(
    (
      await as(
        owner,
        "select * from public.workspace_audit where table_name='time_entries' and row_id=$1",
        [entry.id],
      )
    ).length >= 2,
  );
});
test("deactivated employee loses access without losing historical hours", async () => {
  await as(
    owner,
    "select public.manage_member($1,'employee','Former employee',false,null)",
    [employee],
  );
  assert.equal(
    (await as(employee, "select * from public.work_items")).length,
    0,
  );
  assert.equal(
    (await as(owner, "select * from public.time_entries")).length,
    2,
  );
});
test("client request retries are idempotent and require approval", async () => {
  const id = "40000000-0000-4000-8000-000000000001";
  for (let i = 0; i < 2; i++)
    await as(null, "select public.submit_client_request($1,$2,$3,$4)", [
      "token-a",
      id,
      "New video",
      "Please review",
    ]);
  const rows = await as(owner, "select * from public.work_items where id=$1", [
    id,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].client_id, clientA);
  assert.equal(rows[0].scope_category, "needs_approval");
  assert.equal(rows[0].assigned_user_id, null);
});
test("link rotation revokes the old link", async () => {
  await as(owner, "update public.clients set share_token=$1 where id=$2", [
    "new-token-a",
    clientA,
  ]);
  await assert.rejects(
    as(null, "select public.shared_client_view($1,$2)", ["token-a", "2026-09"]),
  );
  assert.equal(
    (
      await as(null, "select public.shared_client_view($1,$2) as view", [
        "new-token-a",
        "2026-09",
      ])
    )[0].view.client.name,
    "Client A",
  );
});
test("migration can run again without losing records", async () => {
  await db.exec(migration);
  await db.exec(await readFile(new URL("../supabase/migrations/20260930010000_subtasks.sql",import.meta.url),"utf8"));
  assert.equal(
    (await as(owner, "select * from public.time_entries")).length,
    2,
  );
});

test("only owners/admins can correct a session; future time continues normally", async () => {
  await as(owner,"select public.manage_member($1,'employee','Employee',true,null)",[employee]);
  const [task] = await as(owner,"insert into public.work_items(client_id,year_month,title) values($1,'2026-09','Correction test') returning id",[clientA]);
  const [entry] = await as(employee,"insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2026-09-01T09:00Z','2026-09-01T17:00Z',480) returning id",[task.id,employee]);
  await assert.rejects(as(employee,"select public.correct_time_entry($1,120,480,480)",[entry.id]),/Only an owner or admin/);
  await assert.rejects(as(employee,"update public.work_items set actual_hours=2 where id=$1",[task.id]),/Only an owner or admin/);
  await as(owner,"select public.correct_time_entry($1,120,480,480)",[entry.id]);
  const [corrected] = await as(owner,"select * from public.time_entries where id=$1",[entry.id]);
  assert.equal(corrected.duration_minutes,120);
  assert.equal(new Date(corrected.ended_at).toISOString(),'2026-09-01T11:00:00.000Z');
  assert.equal(corrected.user_id,employee);
  const audit=await as(owner,"select before_row,after_row from public.workspace_audit where row_id=$1 and operation='UPDATE'",[entry.id]);
  assert.equal(audit[0].before_row.duration_minutes,480);
  assert.equal(audit[0].after_row.duration_minutes,120);
  await assert.rejects(as(owner,"select public.correct_time_entry($1,60,480,480)",[entry.id]),/Clock time changed/);
  await as(employee,"insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2026-09-02T09:00Z','2026-09-02T10:00Z',60)",[task.id,employee]);
  const [total]=await as(owner,"select sum(duration_minutes) as total from public.time_entries where work_item_id=$1 and voided_at is null",[task.id]);
  assert.equal(Number(total.total),180);
  await as(owner,"select public.correct_time_entry($1,0,120,180)",[entry.id]);
  assert.equal((await as(owner,"select * from public.time_entries where id=$1 and voided_at is not null",[entry.id])).length,1);
  assert.equal(Number((await as(owner,"select sum(duration_minutes) as total from public.time_entries where work_item_id=$1 and voided_at is null",[task.id]))[0].total),60);
});

test("corrections reject active clocks and invalid durations",async()=>{
  const [task]=await as(owner,"insert into public.work_items(client_id,year_month,title) values($1,'2026-09','Running correction test') returning id",[clientA]);
  const [entry]=await as(owner,"insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2026-09-03T09:00Z','2026-09-03T10:00Z',60) returning id",[task.id,owner]);
  await assert.rejects(as(owner,"select public.correct_time_entry($1,-1,60,60)",[entry.id]),/between 0 and 24/);
  await assert.rejects(as(owner,"select public.correct_time_entry($1,1441,60,60)",[entry.id]),/between 0 and 24/);
  await as(owner,"select public.start_work_timer($1,gen_random_uuid())",[task.id]);
  await assert.rejects(as(owner,"select public.correct_time_entry($1,30,60,60)",[entry.id]),/running clock/);
});

test("admin can correct another employee’s session and the migration is repeatable",async()=>{
  await as(owner,"select public.manage_member($1,'admin','Admin',true,null)",[outsider]);
  const [task]=await as(owner,"insert into public.work_items(client_id,year_month,title) values($1,'2026-09','Admin correction test') returning id",[clientA]);
  const [entry]=await as(employee,"insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2026-09-04T09:00Z','2026-09-04T11:00Z',120) returning id",[task.id,employee]);
  await as(outsider,"select public.correct_time_entry($1,60,120,120)",[entry.id]);
  await db.exec(await readFile(new URL("../supabase/migrations/20260930000000_actual_hours_override.sql",import.meta.url),"utf8"));
  assert.equal((await as(owner,"select duration_minutes from public.time_entries where id=$1",[entry.id]))[0].duration_minutes,60);
});

const hierarchyMigration = await readFile(new URL('../supabase/migrations/20260930010000_subtasks.sql', import.meta.url),'utf8');
test('subtasks stay one level deep and within a client; parents cannot be deleted or reparented', async () => {
  const [parent] = await as(owner,"insert into public.work_items(client_id,year_month,title) values($1,'2026-11','November email') returning id",[clientA]);
  const [child] = await as(employee,"insert into public.work_items(client_id,parent_id,year_month,title,assigned_user_id,due_date) values($1,$2,'2026-10','Write copy',$3,'2026-10-29') returning *",[clientA,parent.id,employee]);
  assert.equal(child.assigned_user_id,employee);
  assert.equal(child.client_visible,false);
  await assert.rejects(as(owner,"insert into public.work_items(client_id,parent_id,year_month,title) values($1,$2,'2026-11','Wrong client')",[clientB,parent.id]),/same client/);
  await assert.rejects(as(owner,"insert into public.work_items(client_id,parent_id,year_month,title) values($1,$2,'2026-11','Grandchild')",[clientA,child.id]),/one level/);
  await assert.rejects(as(owner,"update public.work_items set parent_id=$1 where id=$1",[parent.id]),/another parent|own subtask/);
  await assert.rejects(as(owner,"update public.work_items set parent_id=null where id=$1",[child.id]),/another parent/);
  await assert.rejects(as(owner,"delete from public.work_items where id=$1",[parent.id]),/foreign key/);
  await assert.rejects(as(clientUser,"insert into public.work_items(client_id,parent_id,year_month,title) values($1,$2,'2026-11','Unauthorized')",[clientA,parent.id]));
});
test('parents preserve previous hours but reject new time, and active parent clocks block subtasks',async()=>{
  const [parent]=await as(owner,"insert into public.work_items(client_id,year_month,title) values($1,'2026-11','Timer parent') returning id",[clientA]);
  const [timer]=await as(employee,"select (public.start_work_timer($1,gen_random_uuid())).*",[parent.id]);
  await assert.rejects(as(owner,"insert into public.work_items(client_id,parent_id,year_month,title) values($1,$2,'2026-11','Too soon')",[clientA,parent.id]),/Stop the parent clock/);
  await as(employee,"select public.stop_work_timer($1,$2)",[parent.id,timer.started_at]);
  const [child]=await as(owner,"insert into public.work_items(client_id,parent_id,year_month,title) values($1,$2,'2026-11','List update') returning id",[clientA,parent.id]);
  assert.equal((await as(owner,"select * from public.time_entries where work_item_id=$1",[parent.id])).length,1);
  await assert.rejects(as(employee,"select public.start_work_timer($1,gen_random_uuid())",[parent.id]),/subtask instead/);
  await assert.rejects(as(owner,"insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values($1,$2,'2026-09-01T09:00Z','2026-09-01T10:00Z',60)",[parent.id,owner]),/subtask instead/);
  const [ct]=await as(employee,"select (public.start_work_timer($1,gen_random_uuid())).*",[child.id]);
  await as(employee,"select public.stop_work_timer($1,$2)",[child.id,ct.started_at]);
  assert.equal((await as(owner,"select * from public.time_entries where work_item_id in ($1,$2)",[parent.id,child.id])).length,2);
});
test('client parent progress includes private work without exposing private details',async()=>{
  const [parent]=await as(owner,"insert into public.work_items(client_id,year_month,title,client_visible) values($1,'2026-11','Public campaign',true) returning id",[clientA]);
  const [hidden]=await as(owner,"insert into public.work_items(client_id,parent_id,year_month,title,status) values($1,$2,'2026-10','SECRET COPY','done') returning id",[clientA,parent.id]);
  const [shown]=await as(owner,"insert into public.work_items(client_id,parent_id,year_month,title,client_visible) values($1,$2,'2026-11','Visible approval',true) returning id",[clientA,parent.id]);
  const [view]=await as(null,"select public.shared_client_view('new-token-a','2026-10') as v");
  const root=view.v.items.find(w=>w.id===parent.id);
  assert.equal(root.totalSubtasks,2); assert.equal(root.completedSubtasks,1); assert.equal(root.status,'in_progress');
  assert(!JSON.stringify(view.v).includes('SECRET COPY'));
  assert(!view.v.items.some(w=>w.id===hidden.id));
  assert.equal(view.v.items.find(w=>w.id===shown.id).parentId,parent.id);
  await as(employee,"update public.work_items set status='done' where id=$1",[shown.id]);
  const [member]=await as(clientUser,"select public.member_client_view() as v");
  assert.equal(member.v.items.find(w=>w.id===parent.id).status,'done');
  assert(!member.v.items.some(w=>w.id===hidden.id));
  await as(owner,"update public.work_items set client_visible=false where id=$1",[parent.id]);
  const [revoked]=await as(null,"select public.shared_client_view('new-token-a','2026-11') as v");
  assert(!revoked.v.items.some(w=>w.id===parent.id||w.id===shown.id));
  await assert.rejects(as(null,"select public.client_task_items($1,null)",[clientB]),/permission denied/);
  await assert.rejects(as(employee,"select public.client_task_items($1,null)",[clientB]),/permission denied/);
  await db.exec(hierarchyMigration);
  assert.equal((await as(owner,"select parent_id from public.work_items where id=$1",[hidden.id]))[0].parent_id,parent.id);
});
