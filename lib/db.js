'use strict';

/*
 * Storage adapter.
 * The entire database is a single JSON document.
 *   - In production (Vercel) it is stored in Upstash Redis / Vercel KV via REST.
 *   - Locally it is stored in ./data/db.json
 *   - If neither is available it falls back to an in-memory copy (not persisted).
 *
 * Only built-in `fetch` + `fs` are used, so there are no extra dependencies.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const KEY = 'taskmgr:db:v1';
const FILE = path.join(__dirname, '..', 'data', 'db.json');

const REDIS_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

let memoryCache = null; // last-known doc (also used as in-memory fallback)

/* ------------------------------- helpers ------------------------------- */

function uid(prefix) {
  return `${prefix || 'id'}_${crypto.randomBytes(8).toString('hex')}`;
}

async function redisCommand(args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`Redis error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.result;
}

async function readStore() {
  if (useRedis) {
    const raw = await redisCommand(['GET', KEY]);
    return raw ? JSON.parse(raw) : null;
  }
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return memoryCache; // null on first run
  }
}

async function writeStore(doc) {
  memoryCache = doc;
  if (useRedis) {
    await redisCommand(['SET', KEY, JSON.stringify(doc)]);
    return;
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 2));
  } catch (e) {
    // Read-only FS (e.g. unexpected serverless path) -> keep in memory only.
    console.warn('Persisting to disk failed, using in-memory store:', e.message);
  }
}

/* --------------------------- public interface -------------------------- */

let initPromise = null;

async function load() {
  let doc = await readStore();
  if (!doc) {
    doc = seed();
    await writeStore(doc);
  }
  memoryCache = doc;
  return doc;
}

// Ensure DB exists (seed once). Safe to call on every request.
function ensure() {
  if (!initPromise) initPromise = load();
  return initPromise;
}

async function getDb() {
  await ensure();
  return readStore();
}

// Read-modify-write transaction.
async function update(mutator) {
  await ensure();
  const doc = (await readStore()) || seed();
  const result = await mutator(doc);
  await writeStore(doc);
  return result;
}

/* ------------------------------- seeding ------------------------------- */

const MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
];

// Financial year runs April–March.
function currentFYStart(d = new Date()) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }
function fyLabel(y) { return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; }
function currentFY() { return fyLabel(currentFYStart()); }
// 2 years back … current … 5 years ahead (recomputed from "now").
function financialYearList() {
  const start = currentFYStart();
  const out = [];
  for (let y = start - 2; y <= start + 5; y++) out.push(fyLabel(y));
  return out;
}

// A fresh database starts clean: one administrator, no companies, master tasks
// or monthly tasks. The admin builds everything from the UI. (No demo/dummy data.)
function seed() {
  const now = new Date().toISOString();

  const users = [
    { id: uid('usr'), name: 'Administrator', username: 'admin', role: 'admin', email: 'admin@firm.com', phone: '+91 90000 00000', password: hashPassword('admin123'), passwordPlain: 'admin123', createdAt: now },
  ];

  return {
    meta: {
      months: MONTHS,
      financialYears: financialYearList(),
      defaultFY: currentFY(),
    },
    users,
    companies: [],
    master: [],
    tasks: [],
  };
}

// Map FY + month name -> a real calendar date string (YYYY-MM-DD).
function dueDateFor(fy, monthName, day) {
  const startYear = parseInt(fy.split('-')[0], 10); // e.g. 2026
  const idx = MONTHS.indexOf(monthName); // 0 = April
  // April..December -> startYear ; January..March -> startYear + 1
  const calMonth = (idx + 3) % 12; // 0=Jan ... April(idx0)->3
  const year = idx <= 8 ? startYear : startYear + 1;
  const mm = String(calMonth + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

module.exports = { getDb, update, ensure, uid, MONTHS, dueDateFor, useRedis, financialYearList, currentFY };
