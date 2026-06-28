# Accounting Task Manager

A financial-year task-management app for accounting teams. One **Administrator** assigns
tasks & sub-tasks (with due dates) to **Users**; users mark progress and add remarks.
Everything is organised **Financial Year → Company → Month (Apr–Mar)** with live
status dashboards.

Built to deploy on **Vercel** with zero build tooling.

---

## Features (mapped to the requirements)

| # | Requirement | Where |
|---|-------------|-------|
| 1–3 | Multiple companies, FY-wise, month-wise (Apr–Mar) | Throughout; FY dropdown everywhere |
| 4,7 | Tasks split into sub-tasks; a sub-task can have **multiple** allottees | Allotment page |
| 5 | 1 Admin + 2–5 Users | **Users** page |
| 6 | Admin assigns tasks/sub-tasks to self & users **with due date** | **Allotment** page |
| 8 | User marks complete + remarks/balance | **My Tasks** page |
| 9 | Home page: company-wise stacked chart (FY in dropdown) | **Dashboard** |
| 10 | Click company → month-wise chart | Dashboard → company |
| 11 | Click month → staff-wise chart | company → month |
| 12 | Click a Completed/Pending segment → tasks, allottee, remarks & date | Drill-down popup on the month chart |
| 13 | Data-sheet report: FY → Company → Month (tasks, sub-tasks, allottee, status) | **Data Sheet** (+ CSV / Print) |
| 14 | Allotment page: FY → Company → Month | **Allotment** |
| 15 | Copy all tasks/sub-tasks (with allottee) from previous month | Allotment → *Copy previous month* |
| 16 | Master list of Task/Sub-task (company-wise) with Active/Inactive + Add New | **Master List** |
| 17 | Import one / few / all tasks & sub-tasks from master into a month | Allotment → *Import from Master* |

## Tech stack

- **Backend:** Node.js + Express, exported as a single Vercel Serverless Function.
- **Storage:** one JSON document.
  - **Production (Vercel):** Upstash Redis / Vercel KV (via REST — no extra dependency).
  - **Local dev:** a JSON file at `data/db.json`.
- **Frontend:** vanilla HTML/CSS/JS + Chart.js (CDN). No build step.

The only npm dependency is **Express**.

---

## Run locally

```bash
cd task-manager
npm install
npm start
```

Open <http://localhost:3000>.

**Default logins**

| Role  | Username | Password |
|-------|----------|----------|
| Admin | `admin`  | `admin123` |
| User  | `ravi`   | `ravi123`  |
| User  | `priya`  | `priya123` |

Locally, data is saved to `data/db.json`. Delete that file to reset to seed data.

---

## Deploy to Vercel

1. Push this folder to a GitHub repo and **Import** it in Vercel (or run `vercel`).
2. In the Vercel project, open **Storage → Create / Connect Store → Upstash (KV / Redis)**.
   Vercel injects the connection env vars automatically.
3. Add an environment variable **`AUTH_SECRET`** = a long random string.
4. Deploy.

That's it — `vercel.json` already routes every request to the Express app, which serves
both the UI and the API.

> **Why a Redis/KV store?** Vercel's filesystem is read-only/ephemeral, so the local
> JSON-file storage won't persist there. The KV store keeps the single JSON document
> between requests. The code auto-detects the env vars
> (`KV_REST_API_URL` / `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` /
> `UPSTASH_REDIS_REST_TOKEN`) and falls back to the local file when they're absent.

### Prefer not to use a store?
Any other JSON/Redis endpoint works as long as it exposes the Upstash-style REST API.
For a different database (Postgres, Mongo, etc.) replace `readStore`/`writeStore`
in [`lib/db.js`](lib/db.js) — that's the only place storage is touched.

---

## Project structure

```
task-manager/
├── api/index.js        # Vercel serverless entry (exports the Express app)
├── server.js           # local runner (node server.js)
├── lib/
│   ├── app.js          # Express app: static + /api
│   ├── api.js          # all REST routes
│   ├── db.js           # storage adapter + seed data
│   └── auth.js         # password hashing + token signing
├── public/             # frontend (served statically)
│   ├── index.html
│   ├── css/styles.css
│   └── js/{api,charts,app}.js
├── vercel.json
└── package.json
```
