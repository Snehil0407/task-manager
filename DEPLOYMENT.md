# Deploying SA Kumar Task Manager to Vercel

This guide walks you through deploying the app to [Vercel](https://vercel.com) from start to finish.

> **Read this first — about your data**
> - The app stores everything in **one database** (a JSON document).
> - **On Vercel you MUST connect a Redis store (Upstash)** for data to be saved. Without it, the app still runs but **every change is lost** (serverless functions have no persistent disk).
> - Your **local `data/db.json` is NOT uploaded** (it's ignored by git). The deployed app starts with **fresh seeded demo data** and the default logins below. You'll set up real data on the live site.

---

## What you need (5 minutes)

1. A **GitHub account** — https://github.com (free)
2. A **Vercel account** — https://vercel.com/signup (sign up with your GitHub account; free "Hobby" plan is enough)
3. [Git](https://git-scm.com/downloads) installed on your computer (to push the code)

---

## Step 1 — Put the code on GitHub

Open a terminal **in the project folder** (`task-manager`) and run:

```bash
git init
git add .
git commit -m "Task manager - initial deploy"
```

Create an **empty** repository on GitHub (https://github.com/new) — do **not** add a README or .gitignore there. Then connect and push (replace the URL with your repo's URL):

```bash
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

> ✅ `node_modules`, `data/db.json`, and `.env` are already excluded by `.gitignore`, so nothing sensitive or unnecessary is uploaded.

---

## Step 2 — Import the project into Vercel

1. Go to https://vercel.com/new
2. Under **Import Git Repository**, find your repo and click **Import**.
3. Vercel auto-detects the settings from `vercel.json`. **Leave Build & Output settings as default** — you do **not** need a build command or output directory.
4. **Don't click Deploy yet.** First add storage and the secret (Steps 3 & 4). If you already deployed, that's fine — just add them and redeploy.

---

## Step 3 — Add the database (Upstash Redis) — REQUIRED

This is what makes your data persist.

1. In your Vercel project, open the **Storage** tab.
2. Click **Create Database** → choose **Upstash** → **Redis** (a free tier is available).
3. Give it a name (e.g. `taskmgr-db`), pick a region close to you, and create it.
4. When prompted, **Connect** the store to this project (keep all environments selected: Production, Preview, Development).

Vercel automatically injects the connection environment variables for you (you do **not** type them by hand):
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
  *(or the Upstash-native `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — the app accepts either.)*

> The app uses these automatically. If they're present, data is saved to Redis; if they're missing, data is **not** saved.

---

## Step 4 — Set the login-token secret — REQUIRED

This signs the login sessions. Set it once.

1. Generate a long random value. On your computer run:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copy the long string it prints.
2. In Vercel: **Project → Settings → Environment Variables → Add New**
   - **Name:** `AUTH_SECRET`
   - **Value:** *(paste the random string)*
   - **Environments:** select **Production** (and Preview/Development if you'll use them)
   - Save.

> ⚠️ If you ever change `AUTH_SECRET` later, everyone is simply logged out and must sign in again — no data is lost.

---

## Step 5 — Deploy

- If you haven't deployed yet: click **Deploy**.
- If you deployed before adding Storage/secret: go to the **Deployments** tab → open the latest → **⋯ menu → Redeploy** (so it picks up the new environment variables).

Wait for the build to finish (usually under a minute). Vercel gives you a live URL like:

```
https://your-project.vercel.app
```

---

## Step 6 — First login & secure the app

1. Open your Vercel URL.
2. Log in with the **default admin**:
   - **Username:** `admin`
   - **Password:** `admin123`
3. **Immediately change passwords** for the admin and any users:
   - Go to **Users** (sidebar) → **Edit** each user → set a new password → Save.
   - You can use the 👁 button to view passwords any time.
4. Set up your real companies, master lists, and allotments. The seeded demo data is just a starting point — you can edit or delete it.

The default seeded staff logins (change or delete these): `ravi/ravi123`, `priya/priya123`, `amit/amit123`, `neha/neha123`.

---

## Updating the app later

Any time you change the code, just push to GitHub — Vercel redeploys automatically:

```bash
git add .
git commit -m "describe your change"
git push
```

Your data in Redis is **not** affected by redeploys.

---

## Optional: deploy from your computer with the Vercel CLI

Instead of GitHub you can deploy directly:

```bash
npm i -g vercel        # install once
vercel login           # sign in
vercel                 # first run: link/create the project (follow prompts)
vercel --prod          # deploy to production
```

You still need to add the Upstash store and `AUTH_SECRET` in the Vercel dashboard (Steps 3 & 4), then run `vercel --prod` again.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| **Changes disappear / data resets** | The Redis store isn't connected. Do **Step 3**, then **redeploy** (Step 5). Confirm `KV_REST_API_URL` and `KV_REST_API_TOKEN` appear under **Settings → Environment Variables**. |
| **Page is blank or CSS/JS 404** | Make sure you deployed with the included `vercel.json` (it bundles the `public/` folder). Redeploy after pulling the latest code. |
| **Logged out unexpectedly / "Invalid token"** | `AUTH_SECRET` was changed or not set. Set it (Step 4) and sign in again. Sessions last 7 days. |
| **Can't log in at all** | Use the default `admin` / `admin123` on a fresh deploy. If you changed it and forgot, you can reset by clearing the Redis database (Upstash console → flush) — this wipes all data and reseeds the defaults on next visit. |
| **Build fails** | Ensure `package.json`, `vercel.json`, `api/`, `lib/`, and `public/` were all pushed to GitHub. No build command is required. |

---

## Reference: environment variables

| Variable | Required | Purpose |
|---|---|---|
| `KV_REST_API_URL` | ✅ (prod) | Redis REST endpoint — injected by the Upstash/Vercel Storage integration. |
| `KV_REST_API_TOKEN` | ✅ (prod) | Redis REST auth token — injected by the integration. |
| `AUTH_SECRET` | ✅ (prod) | Secret used to sign login tokens. Set a long random value. |

*(The app also accepts `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` as alternatives to the `KV_*` names.)*

---

That's it — your task manager is live. 🎉
