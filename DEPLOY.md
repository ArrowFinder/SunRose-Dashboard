# Simple guide: get the app on GitHub + live on the web (checklist A)

Follow **Part 1** first. Parts **2–4** depend on having a GitHub repo.

Your live site will look like:

`https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME/`

(Hash links like `#/login` work on that URL.)

---

## Part 1 — Put the code on GitHub

### Step 1. Create a new empty repository on GitHub

1. Log in at [github.com](https://github.com).
2. Click the **+** (top right) → **New repository**.
3. Pick a **Repository name** (example: `sunrose-client-dashboard`). Remember this name—you need it for the live URL.
4. Leave **Public** or **Private** as you prefer.
5. **Do not** add a README, .gitignore, or license (you already have files on your computer).
6. Click **Create repository**.

GitHub will show you commands—use **Part 2** below instead if you already have the project on your machine.

### Step 2. Connect your computer folder to that repo and push

1. Open **Terminal** (or Cursor’s terminal).
2. Go to your project (use your real path):

   ```bash
   cd "/Users/rick/Desktop/SunRose Client Dashbaord"
   ```

3. If you have **not** run `git init` before, run:

   ```bash
   git init
   git add -A
   git commit -m "Initial commit"
   ```

4. Link to GitHub (replace `YOUR-USER` and `YOUR-REPO` with yours):

   ```bash
   git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
   git branch -M main
   git push -u origin main
   ```

5. Refresh the repo page on GitHub—you should see all your files. **`.env` will not appear** (that’s correct; secrets stay on your computer).

---

## Part 2 — Turn on GitHub Pages (where the website is served)

1. On GitHub, open your repository.
2. Click **Settings** (top menu of the repo).
3. In the left sidebar, click **Pages** (under “Code and automation”).
4. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
5. **Branch**: select **`gh-pages`** and folder **`/ (root)`**, then **Save**.

The first time, **`gh-pages` might not exist yet** until you deploy once (Part 3). After the first deploy, come back and set the branch to **`gh-pages`**.

---

## Part 3 — Deploy the built site (choose one path)

### Path A — Automatic (recommended): push to `main` and let GitHub build

1. On GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add **two** secrets (same values as in your local `.env` file):

   | Name | Value |
   |------|--------|
   | `VITE_SUPABASE_URL` | Your Supabase Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Your Supabase **anon / public** key (not `service_role`) |

3. Push any change to the **`main`** branch (or merge to `main`). The workflow **Deploy to GitHub Pages** runs and updates the site.

4. After a few minutes, open:

   `https://YOUR-USER.github.io/YOUR-REPO/`

If the workflow fails, open the **Actions** tab on the repo and read the red error message.

### Path B — Manual from your Mac (no GitHub Actions)

1. In the project folder, create **`.env.production`** (copy from `.env.production.example`) with:

   ```env
   VITE_BASE=/YOUR-REPO-NAME/
   VITE_SUPABASE_URL=paste-your-url
   VITE_SUPABASE_ANON_KEY=paste-your-anon-key
   ```

   Use the **same repo name** as on GitHub, with slashes: `/sunrose-client-dashboard/` if the repo is `sunrose-client-dashboard`.

2. Run:

   ```bash
   npm run deploy
   ```

3. This uses the `gh-pages` tool to push the **`dist`** folder to the **`gh-pages`** branch.

4. Set **Pages** to the **`gh-pages`** branch (Part 2).

---

## Part 4 — Supabase: database + auth URLs (one-time)

### Step 1. Run the SQL migration (if you haven’t already)

1. Open [Supabase](https://supabase.com) → your project.
2. Click **SQL Editor** in the left sidebar → **New query**.
3. On your computer, open `supabase/migrations/20250201000000_profiles.sql`, copy **all** of it, paste into Supabase, click **Run**.

### Step 2. Allow your app URLs (fixes login redirects)

1. In Supabase: **Authentication** → **URL Configuration**.
2. **Site URL**: you can set it to your GitHub Pages URL, e.g.  
   `https://YOUR-USER.github.io/YOUR-REPO/`
3. **Redirect URLs**: add **both**:

   - `http://localhost:5173`
   - `https://YOUR-USER.github.io/YOUR-REPO/`

   (Include the trailing slash only if Supabase shows examples that way; both with and without slash often work—if login fails, try adding the exact URL from the browser address bar.)

### Step 3. Make yourself owner (first account)

After you **sign up** once on the live site:

1. Supabase → **Authentication** → **Users** → copy your user’s **UUID**.
2. **SQL Editor** → run:

   ```sql
   update public.profiles set role = 'owner' where id = 'PASTE-UUID-HERE';
   ```

---

## Quick checklist

- [ ] Repo created on GitHub; code pushed from your computer  
- [ ] **Secrets** added (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) **or** `.env.production` used for manual deploy  
- [ ] **Deploy** ran (Actions workflow or `npm run deploy`)  
- [ ] **Pages** points at **`gh-pages`** branch  
- [ ] Supabase **SQL** migration run  
- [ ] Supabase **redirect URLs** include localhost + GitHub Pages URL  
- [ ] **Owner** role set in SQL after first signup  

---

## If something breaks

- **Blank page on GitHub Pages** — Usually wrong **`VITE_BASE`**. It must be `/repo-name/` matching the repo name exactly (case-sensitive).  
- **Login works locally but not on GitHub** — Redirect URLs in Supabase, or missing build-time env (secrets / `.env.production`).  
- **Workflow fails** — **Actions** tab → open the failed run → read the log.
