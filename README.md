# SunRose — Client scope dashboard

Lightweight internal + client-facing views to track retainers, tasks, **timer-based time entries**, calendar due dates, templates, and team roles (owner / admin / employee / optional client profile). **Offline mode:** data lives in **IndexedDB** in this browser; export/import JSON (v2) for backups. **Optional cloud login:** connect a free [Supabase](https://supabase.com) account so you can sign in with email and password—see **Simple Supabase setup** below.

## Simple Supabase setup (optional — email login)

Skip this whole section if you’re happy with **offline PIN login** only.

### Part A — Two copy-paste values from Supabase

1. Go to [supabase.com](https://supabase.com), sign in, and open your project (create one if needed — free tier is fine).
2. Click the **gear icon** at the bottom left — **Project Settings**.
3. Click **API** in the left menu.
4. Find **Project URL** — it looks like `https://something.supabase.co`. **Copy it.**
5. Scroll to **Project API keys**. Find the key named **anon** and **public** (not `service_role`). **Copy that long key.**

Those two copies are all you need. The app asks for them using technical names — you can ignore the names and just put them in the right place:

| What Supabase calls it | What you put in the file |
|------------------------|---------------------------|
| **Project URL** | After `VITE_SUPABASE_URL=` |
| **anon public** key | After `VITE_SUPABASE_ANON_KEY=` |

(`VITE_` is only there because the build tool requires it — you don’t need to understand it, just use the file below.)

6. In this project folder (same place as `package.json`), create a new file named **`.env`**.
7. Put exactly two lines in it (paste your real values, no quotes):

```env
VITE_SUPABASE_URL=paste-your-Project-URL-here
VITE_SUPABASE_ANON_KEY=paste-your-anon-key-here
```

8. Save the file. Run `npm run dev` again (stop it with Ctrl+C first if it’s already running).

You can also open **`.env.example`** in this project — it has the same instructions in the comments.

### Part B — One-time database setup (so login works)

1. In Supabase, click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. On your computer, open the file **`supabase/migrations/20250201000000_profiles.sql`** in this project. Select all the text, copy it, paste it into the Supabase SQL box, and click **Run**.

### Part C — Tell Supabase your app’s address (avoids “redirect” errors)

1. In Supabase: **Authentication** → **URL Configuration**.
2. Under **Redirect URLs**, add: `http://localhost:5173` (and later your GitHub Pages URL if you deploy there).

### Part D — Make yourself the owner (first account only)

1. Use the app’s login page to **sign up** once with email + password.
2. In Supabase: **Authentication** → **Users** — click your user and copy the **User UID**.
3. **SQL Editor** → new query → run (replace the id with your UID):

```sql
update public.profiles set role = 'owner' where id = 'PASTE-YOUR-USER-UID-HERE';
```

## Run locally (one step at a time)

**Step 1.** Install [Node.js](https://nodejs.org/) (LTS) if you don’t have it yet.

**Step 2.** In Terminal, go to this project folder:

```bash
cd "/path/to/SunRose Client Dashbaord"
```

**Step 3.** Install and start:

```bash
npm install
npm run dev
```

Open the URL shown (usually `http://localhost:5173`).

## Daily use (no code)

1. **Sign in** (`#/login`) as owner or employee (optional **PIN** per user). First launch creates an **Owner** profile automatically.
2. **Team** (`#/team`) — users, PINs, demo data (owner). **Clients** (`#/clients`) — retainers, colors, shared links, **backup** import/export.
3. **Overview** — scope risk by client; **used** hours prefer **timer entries**, else manual actuals on tasks.
4. Open a **client** — month view, tasks with **due date** & **assignee**, **Start timer** / **Log time**, time entry list. When adding/editing a task, optionally **save as reusable template for that client only**; use **From template** to duplicate.
5. **Calendar** — month grid of tasks with due dates, colored by client.
6. **Download JSON backup** (v2: includes users, time entries, per-client templates); **Import** on another machine.

Client links (`#/c/...`) resolve **only where your data exists** (same browser, or after import). For calls, screen-share from your machine or import backup on the device you use.

## GitHub Pages

**Step 1.** Create a GitHub repo (e.g. `sunrose-client-dashboard`).

**Step 2.** In the project root, add a file `.env.production`:

```bash
VITE_BASE=/your-repo-name/
```

Use your **exact** repo name, with slashes as shown.

**Step 3.** Build and deploy:

```bash
npm run build
npx gh-pages -d dist
```

**Step 4.** In the repo on GitHub: **Settings → Pages** — set source to **gh-pages** branch (or the folder your tool uses).

**Step 5.** Open `https://<user>.github.io/<your-repo-name>/` — routes use hash URLs (`#/`, `#/settings`, `#/c/...`).

## Tech

- Vite + React + TypeScript
- React Router (hash routing for static hosting)
- **Dexie** (IndexedDB) + JSON v2 export/import (migrates legacy `localStorage` v1 on first run)

## License

Private / your use.
