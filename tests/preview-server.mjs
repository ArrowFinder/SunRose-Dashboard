// Local integration harness only. Never deploy: authentication is deliberately simulated.
// Starts an in-memory PostgreSQL database with the real migrations and row policies.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec(
  `create role authenticated; create role anon; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`,
);
for (const file of [
  "20250201000000_profiles.sql",
  "20260923000000_shared_workspace.sql",
  "20260930000000_actual_hours_override.sql",
])
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
  await db.query("insert into auth.users(id,email) values($1,$2)", [
    u.id,
    u.email,
  ]);
await db.exec(
  `update public.profiles set role='owner',display_name='Preview Owner' where id='${users[0].id}';update public.profiles set role='employee',display_name='Preview Employee' where id='${users[1].id}';insert into public.clients(id,name,share_token,retainer_hours_per_month,color) values('10000000-0000-4000-8000-000000000001','Preview client','preview-client-link',10,'#c2410c');insert into public.client_members(user_id,client_id) values('${users[2].id}','10000000-0000-4000-8000-000000000001');`,
);
// A deliberately overlong saved session for exercising owner/admin correction.
await db.exec(`insert into public.work_items(id,client_id,year_month,title) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',to_char(now(),'YYYY-MM'),'Sample time correction');
insert into public.time_entries(work_item_id,user_id,started_at,ended_at,duration_minutes) values('20000000-0000-4000-8000-000000000001','${users[1].id}',now()-interval '1 day',now()-interval '16 hours',480);`);
const allowed = new Set([
  "clients",
  "profiles",
  "client_members",
  "work_items",
  "time_entries",
  "task_templates",
  "active_timers",
]);
const rpc = new Set([
  "member_client_view",
  "workspace_revision",
  "start_work_timer",
  "stop_work_timer",
  "correct_work_timer",
  "correct_time_entry",
  "manage_member",
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
server.listen(54329, "127.0.0.1", () =>
  console.log(
    "Local test API: http://127.0.0.1:54329. Accounts: owner@example.test, employee@example.test, client@example.test. Password: sunrose-preview-only. In-memory sample data only.",
  ),
);
