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

// Default accounting master tasks applied to every company on first run.
const DEFAULT_MASTER = [
  {
    name: 'GST Compliance',
    description: 'Complete all monthly GST work for the client. Verify figures with the books before filing. Due by the 20th.',
    links: ['https://www.gst.gov.in'],
    subs: [
      { name: 'Download GSTR-2B', description: 'Login to the GST portal and download the auto-drafted GSTR-2B for the month.', links: ['https://www.gst.gov.in/returns'] },
      { name: 'Reconcile purchases (ITC)', description: 'Match purchase register with 2B and flag any mismatches to the client.' },
      'File GSTR-1',
      'File GSTR-3B',
    ],
  },
  { name: 'Bank Reconciliation', subs: ['Import bank statements', 'Match transactions', 'Resolve mismatches'] },
  { name: 'Accounting Entries', subs: ['Sales entries', 'Purchase entries', 'Expense entries', 'Journal entries'] },
  { name: 'TDS Compliance', subs: ['Compute TDS', 'Deposit TDS', 'File TDS return'] },
  { name: 'Payroll', subs: ['Process salaries', 'PF / ESI filing'] },
  { name: 'MIS & Reporting', subs: ['Prepare P&L', 'Prepare Balance Sheet', 'Share MIS with client'] },
];

function seed() {
  const now = new Date().toISOString();

  const users = [
    { id: uid('usr'), name: 'Administrator', username: 'admin', role: 'admin', email: 'admin@firm.com', phone: '+91 90000 00000', password: hashPassword('admin123'), passwordPlain: 'admin123', createdAt: now },
    { id: uid('usr'), name: 'Ravi Sharma', username: 'ravi', role: 'user', email: 'ravi@firm.com', phone: '+91 90000 00001', password: hashPassword('ravi123'), passwordPlain: 'ravi123', createdAt: now },
    { id: uid('usr'), name: 'Priya Mehta', username: 'priya', role: 'user', email: 'priya@firm.com', phone: '+91 90000 00002', password: hashPassword('priya123'), passwordPlain: 'priya123', createdAt: now },
    { id: uid('usr'), name: 'Amit Verma', username: 'amit', role: 'user', email: 'amit@firm.com', phone: '+91 90000 00003', password: hashPassword('amit123'), passwordPlain: 'amit123', createdAt: now },
    { id: uid('usr'), name: 'Neha Gupta', username: 'neha', role: 'user', email: 'neha@firm.com', phone: '+91 90000 00004', password: hashPassword('neha123'), passwordPlain: 'neha123', createdAt: now },
  ];
  const staff = users.filter((u) => u.role === 'user');

  const companyNames = [
    'Alpha Traders Pvt Ltd',
    'Bharat Industries',
    'Crystal Exports',
    'Delta Foods Ltd',
    'Everest Logistics',
    'Falcon Tech LLP',
  ];
  const companies = companyNames.map((name, i) => ({
    id: uid('cmp'), name, active: true, order: i, createdAt: now,
  }));

  // Master list per company.
  const master = [];
  companies.forEach((c) => {
    DEFAULT_MASTER.forEach((t, ti) => {
      master.push({
        id: uid('mt'),
        companyId: c.id,
        name: t.name,
        description: t.description || '',
        links: t.links ? t.links.slice() : [],
        active: true,
        order: ti,
        subtasks: t.subs.map((s, si) => {
          const o = typeof s === 'string' ? { name: s } : s;
          return { id: uid('ms'), name: o.name, description: o.description || '', links: o.links ? o.links.slice() : [], active: true, order: si };
        }),
      });
    });
  });

  // Generate monthly task instances for the current FY so charts look meaningful.
  const fy = currentFY();
  const tasks = [];
  // populate ~ first 4 companies and first 5 months with varied statuses
  const STATUSES = ['completed', 'in_progress', 'pending'];
  companies.slice(0, 4).forEach((c, ci) => {
    const monthsToFill = MONTHS.slice(0, 5 - ci >= 2 ? 5 - ci : 2); // varies per company
    const compMaster = master.filter((m) => m.companyId === c.id);
    monthsToFill.forEach((month, mi) => {
      compMaster.forEach((mt, ti) => {
        const subtasks = mt.subtasks.map((ms, si) => {
          // Deterministic but varied status / assignment
          const seedNum = (ci + 1) * 7 + mi * 5 + ti * 3 + si * 2;
          const status = STATUSES[seedNum % 3];
          const assignee = staff[(seedNum) % staff.length];
          const completed = status === 'completed';
          return {
            id: uid('st'),
            name: ms.name,
            masterSubtaskId: ms.id,
            description: ms.description || '',
            links: (ms.links || []).slice(),
            assignees: [assignee.id],
            dueDate: dueDateFor(fy, month, 10 + si),
            status,
            remarks: completed ? 'Done and verified.' : (status === 'in_progress' ? 'Work started.' : ''),
            completedDate: completed ? now : null,
            completedBy: completed ? assignee.id : null,
          };
        });
        tasks.push({
          id: uid('tsk'),
          fy,
          companyId: c.id,
          month,
          name: mt.name,
          masterTaskId: mt.id,
          description: mt.description || '',
          links: (mt.links || []).slice(),
          order: ti,
          subtasks,
          createdAt: now,
        });
      });
    });
  });

  return {
    meta: {
      months: MONTHS,
      financialYears: financialYearList(),
      defaultFY: currentFY(),
    },
    users,
    companies,
    master,
    tasks,
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
