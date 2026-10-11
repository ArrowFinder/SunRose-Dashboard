// Local integration harness only. Never deploy: authentication is deliberately simulated.
// Starts an in-memory PostgreSQL database with the real migrations and row policies.
import http from "node:http";
import { readFile,readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec(
  `create role authenticated; create role anon; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
for (const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).sort())
  await db.exec(
    (
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      )
    ).replace('create extension if not exists "pgcrypto";', ""),
  );
const users = ["owner", "employee", "client"].map((name, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i + 1}`,
  email: `${name}@example.test`,
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: new Date().toISOString(),
}));
for (const u of users)
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,jsonb_build_object('display_name','Preview user'))", [
    u.id,
    u.email,
  ]);
await db.exec(
  `update public.profiles set role='owner',display_name='Preview Owner' where id='${users[0].id}';update public.profiles set role='employee',display_name='Preview Employee' where id='${users[1].id}';insert into public.clients(id,name,share_token,retainer_hours_per_month,color) values('10000000-0000-4000-8000-000000000001','Preview client','preview-client-link',10,'#c2410c');insert into public.client_members(user_id,client_id) values('${users[2].id}','10000000-0000-4000-8000-000000000001');`,
);
await db.exec(`insert into projects(id,client_id,name) values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Preview campaign');`);
// A deliberately overlong saved session for exercising owner/admin correction.
await db.exec(`insert into public.work_items(id,client_id,project_id,year_month,title) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',to_char(now(),'YYYY-MM'),'Sample time correction');
insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values('20000000-0000-4000-8000-000000000001','${users[1].id}',now()-interval '1 day',now()-interval '16 hours',480);`);
// Sample suggestions contain no real email or credentials.
await db.exec(`insert into public.sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,source_subject,evidence) values
('${users[0].id}','client','preview-client','Acme Studio','A client requesting help with their November email campaign.','{"client_name":"Acme Studio","contact_email":"alex@acme.test","client_id":null,"parent_id":null,"task_id":null,"due_date":null,"estimated_hours":null}','preview-thread','November campaign','Please help us put together our November email campaign.'),
('${users[0].id}','task','preview-task','Write the November email campaign','Draft the copy and send it to Alex for approval before launch.','{"client_name":"Acme Studio","contact_email":"alex@acme.test","client_id":null,"parent_id":null,"task_id":null,"due_date":"2026-11-10","estimated_hours":null}','preview-thread','November campaign','Could you have a draft ready by November 10?');`);
await db.exec(`update public.sot_suggestions set payload=payload||'{"analysis_version":3,"checklist":{"business_name":true,"contact_email":true,"relationship_evidence":true,"existing_clients_checked":true,"identity_resolved":true,"ready":true},"relationship_evidence":"Please help us put together our November email campaign.","location":"Portland","business_type":"Design studio","aliases":["Acme"]}'::jsonb;
insert into public.sot_client_contacts(email,client_id) values('sam@two.test','10000000-0000-4000-8000-000000000001');
insert into public.sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,evidence) values('${users[0].id}','client','preview-shared-contact','Second Business','A contact who also works with Preview client is requesting work for Second Business.','{"client_name":"Second Business","contact_email":"sam@two.test","client_id":null,"parent_id":null,"task_id":null,"due_date":null,"estimated_hours":null,"checklist":{"business_name":true,"contact_email":true,"relationship_evidence":true,"existing_clients_checked":true,"identity_resolved":false,"ready":false,"explanation":"This contact also represents Preview client. Confirm which business this email concerns."}}','second-thread','Please create a campaign for Second Business.');`);
await db.query("insert into public.sot_connections(user_id,email,last_error) values($1,'preview@example.test','Sample paused scan: monthly allowance reached.')",[users[0].id]);
await db.query("insert into client_requests(id,client_id,title,description) values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001','Review new website copy','Please review our new page.')");
await db.query(`insert into sot_suggestions(user_id,kind,dedupe_key,title,description,payload,source_thread,evidence) values($1,'project','preview-employee-project','Winter campaign','Email campaign for winter.','{"client_id":"10000000-0000-4000-8000-000000000001","client_name":"Preview client","checklist":{"identity_resolved":true},"analysis_version":4}','preview-project','Please prepare our winter campaign.')`,[users[1].id]);
await db.query(`insert into sot_mail_queue(user_id,thread_id,fingerprint,payload,status,reason,oldest_at) values($1,'preview-review','fp',$2,'review','Interrupted request; review before retrying.',now())`,[users[0].id,JSON.stringify({messages:[{id:'a',subject:'First campaign request',date:new Date().toISOString(),body:'Please prepare the campaign.'},{id:'b',subject:'Second campaign request',date:new Date().toISOString(),body:'Please review the draft.'}]})]);
await db.query("insert into sot_notifications(recipient_id,task_id,message) values($1,'20000000-0000-4000-8000-000000000001','Preview SOT history retained')",[users[0].id]);
const allowed = new Set([
  "client_requests",
  "projects",
  "sot_client_profiles",
  "sot_client_contacts",
  "sot_connections",
  "sot_suggestions",
  "sot_notifications",
  "clients",
  "profiles",
  "client_members",
  "work_items",
  "time_entries",
  "task_templates",
  "active_timers",
]);
const rpc = new Set([
  "sot_review_submit","review_create_client","review_create_project",
  "sot_review_messages","sot_recover_thread","review_client_request","sot_project_approvals","sot_accept_project",
  "save_time_log","start_project_timer","payroll_data","set_staff_pay_rate","create_pay_period","change_pay_period","support_user_snapshot","sot_edit_and_accept","sot_approve_project_and_task",
  "member_client_view",
  "workspace_revision",
  "start_work_timer",
  "stop_work_timer",
  "correct_work_timer",
  "correct_time_entry",
  "sot_confirm_identity",
  "sot_confirm_website",
  "sot_accept",
  "sot_dismiss", "sot_dismiss_with_reason", "sot_set_auto_scan", "sot_recheck_pending",
  "sot_mark_read",
  "manage_member",
  "update_my_name",
  "void_time_entry",
  "shared_client_view",
  "submit_client_request",
]);
const name = (s) => {
  if (!/^[a-z_]+$/.test(s)) throw Error("Invalid column");
  return '"' + s + '"';
};
let queue = Promise.resolve();
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,apikey,content-type,x-client-info,prefer,accept,range,range-unit,x-supabase-api-version,accept-profile,content-profile",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Access-Control-Expose-Headers", "content-range");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    queue = queue
      .then(async () => {
        const url = new URL(req.url, "http://127.0.0.1:54329");
        const send = (status, value) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(value));
        };
        let transaction = false;
        try {
          const input = body ? JSON.parse(body) : {};
          const token = (req.headers.authorization ?? "").replace(
            "Bearer ",
            "",
          );
          let user;
          try {
            const claims = JSON.parse(
              Buffer.from(token.split(".")[1], "base64url").toString(),
            );
            user = users.find((u) => u.id === claims.sub);
          } catch {}
          if (url.pathname === "/auth/v1/token") {
            user = users.find(
              (u) => u.email === input.email || u.id === input.refresh_token,
            );
            if (
              !user ||
              (input.email && input.password !== "sunrose-preview-only")
            )
              return send(400, {
                message: "Use the preview account and password.",
              });
            const enc = (v) =>
              Buffer.from(JSON.stringify(v)).toString("base64url");
            const jwt =
              enc({ alg: "HS256", typ: "JWT" }) +
              "." +
              enc({
                sub: user.id,
                aud: "authenticated",
                role: "authenticated",
                exp: Math.floor(Date.now() / 1000) + 3600,
              }) +
              ".preview";
            return send(200, {
              access_token: jwt,
              refresh_token: user.id,
              expires_in: 3600,
              token_type: "bearer",
              user,
            });
          }
          if (url.pathname === "/auth/v1/user")
            return send(user ? 200 : 401, user ?? { message: "Not signed in" });
          if (url.pathname === "/auth/v1/logout") {
            res.writeHead(204);
            res.end();
            return;
          }
          if(url.pathname === "/functions/v1/sot" && input.action==='create_teammate'){
            if(!user)return send(401,{error:'Sign in first'});
            const r=(await db.query('select prepare_team_setup($1,$2,$3,$4,$5) r',[user.id,input.requestId,input.email,input.name,input.role])).rows[0].r;
            let id=r.user_id;
            if(!id){id=crypto.randomUUID();await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,r.email,JSON.stringify({display_name:r.display_name,team_setup_id:r.id})]);await db.query('select finish_team_setup($1,$2,$3)',[user.id,r.id,id]);}
            return send(200,{id,name:r.display_name,role:r.role,email:r.email,setupLink:'https://example.test/preview-setup-only'});
          }
          if(url.pathname === "/functions/v1/sot") return send(200, {configured:false,budget:(await db.query('select sot_budget() b')).rows[0].b,report:user?(await db.query('select sot_queue_report($1) r',[user.id])).rows[0].r:null});
          if (!url.pathname.startsWith("/rest/v1/"))
            return send(404, { message: "Not found" });
          await db.exec("begin");
          transaction = true;
          await db.exec(
            user ? "set local role authenticated" : "set local role anon",
          );
          await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
            user?.id ?? "",
          ]);
          const segment = url.pathname.slice("/rest/v1/".length);
          let result;
          if (segment.startsWith("rpc/")) {
            const fn = segment.slice(4);
            if (!rpc.has(fn)) throw Error("Unknown function");
            const keys = Object.keys(input);
            result = (
              await db.query(
                `select to_jsonb(public.${name(fn)}(${keys.map((k, i) => name(k) + " => $" + (i + 1)).join(",")})) as value`,
                keys.map((k) => input[k]),
              )
            ).rows[0].value;
          } else {
            if (!allowed.has(segment)) throw Error("Unknown table");
            const params = [];
            const bind = (v) => {
              params.push(v);
              return "$" + params.length;
            };
            const filters = [];
            for (const [key, value] of url.searchParams) {
              if (["select", "order", "offset", "limit"].includes(key))
                continue;
              const col = name(key);
              if (value.startsWith("eq."))
                filters.push(col + "=" + bind(value.slice(3)));
              else if (value === "is.null") filters.push(col + " is null");
              else throw Error("Unsupported filter");
            }
            let sql;
            const table = "public." + name(segment);
            const where = filters.length
              ? " where " + filters.join(" and ")
              : "";
            if (req.method === "GET") {
              const cols = url.searchParams.get("select") ?? "*";
              const select =
                cols === "*" ? "*" : cols.split(",").map(name).join(",");
              sql = `select ${select} from ${table}${where}`;
              const order = url.searchParams.get("order");
              if (order) {
                const [col, direction] = order.split(".");
                sql +=
                  " order by " +
                  name(col) +
                  (direction === "desc" ? " desc" : " asc");
              }
              const range = (req.headers.range ?? "").split("-");
              const offset =
                Number(url.searchParams.get("offset") ?? range[0] ?? 0) || 0;
              const limit = Number(
                url.searchParams.get("limit") ??
                  (range[1] ? Number(range[1]) - offset + 1 : 1000),
              );
              sql += ` limit ${Math.min(limit, 1000)} offset ${offset}`;
            } else if (req.method === "POST") {
              const keys = Object.keys(input);
              sql = `insert into ${table} (${keys.map(name).join(",")}) values (${keys.map((k) => bind(input[k])).join(",")}) returning *`;
            } else if (req.method === "PATCH") {
              sql = `update ${table} set ${Object.keys(input)
                .map((k) => name(k) + "=" + bind(input[k]))
                .join(",")}${where} returning *`;
            } else if (req.method === "DELETE")
              sql = `delete from ${table}${where} returning *`;
            else throw Error("Unsupported method");
            const rows = (await db.query(sql, params)).rows;
            const single = (req.headers.accept ?? "").includes(
              "application/vnd.pgrst.object+json",
            );
            if (single && rows.length !== 1)
              throw Error(
                "Record changed or access denied. Refresh and try again.",
              );
            result = single ? rows[0] : rows;
          }
          await db.exec("commit");
          transaction = false;
          send(200, result);
        } catch (e) {
          if (transaction) await db.exec("rollback");
          send(400, {
            message: e.message,
            code: "PREVIEW_ERROR",
            details: null,
            hint: null,
          });
        }
      })
      .catch((e) => {
        res.writeHead(500);
        res.end(String(e));
      });
  });
});
const previewPort = Number(process.env.PREVIEW_PORT || 54329);
server.listen(previewPort, "127.0.0.1", () =>
  console.log(
    `Local test API: http://127.0.0.1:${previewPort}. Accounts: owner@example.test, employee@example.test, client@example.test. Password: sunrose-preview-only. In-memory sample data only.`,
  ),
);
