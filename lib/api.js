'use strict';

const express = require('express');
const { getDb, update, uid, MONTHS } = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

const router = express.Router();

/* ----------------------------- middleware ------------------------------ */

async function attachUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (payload) {
    const db = await getDb();
    req.user = db.users.find((u) => u.id === payload.id) || null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

const publicUser = (u) => u && ({ id: u.id, name: u.name, username: u.username, role: u.role });
// Full record including contact details — admin only.
const adminUser = (u) => u && ({ ...publicUser(u), email: u.email || '', phone: u.phone || '', passwordPlain: u.passwordPlain || '' });

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (!e.status) console.error(e);
    if (res.headersSent) return;
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  });

router.use(express.json({ limit: '1mb' }));
router.use((req, res, next) => { attachUser(req, res, next).catch(next); });

/* -------------------------------- auth --------------------------------- */

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const db = await getDb();
  const user = db.users.find((u) => u.username === String(username || '').toLowerCase().trim());
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = signToken({ id: user.id });
  res.json({ token, user: publicUser(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// One call to bootstrap the SPA.
router.get('/bootstrap', requireAuth, wrap(async (req, res) => {
  const db = await getDb();
  res.json({
    user: publicUser(req.user),
    users: db.users.map(publicUser),
    companies: db.companies.slice().sort((a, b) => (a.order || 0) - (b.order || 0)),
    meta: db.meta,
  });
}));

/* -------------------------------- users -------------------------------- */

router.get('/users', requireAuth, wrap(async (req, res) => {
  const db = await getDb();
  // Only admins see contact details; everyone else gets the minimal record.
  const fmt = req.user.role === 'admin' ? adminUser : publicUser;
  res.json(db.users.map(fmt));
}));

router.post('/users', requireAdmin, wrap(async (req, res) => {
  const { name, username, password, role, email, phone } = req.body || {};
  if (!name || !username || !password) return res.status(400).json({ error: 'name, username, password required' });
  const out = await update((db) => {
    const uname = String(username).toLowerCase().trim();
    if (db.users.some((u) => u.username === uname)) throw httpError(409, 'Username already exists');
    const user = {
      id: uid('usr'), name: name.trim(), username: uname,
      role: role === 'admin' ? 'admin' : 'user',
      email: String(email || '').trim(), phone: String(phone || '').trim(),
      password: hashPassword(password), passwordPlain: String(password), createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    return adminUser(user);
  });
  res.status(201).json(out);
}));

router.put('/users/:id', requireAdmin, wrap(async (req, res) => {
  const { name, role, password, email, phone } = req.body || {};
  const out = await update((db) => {
    const u = db.users.find((x) => x.id === req.params.id);
    if (!u) throw httpError(404, 'User not found');
    if (name) u.name = name.trim();
    if (role) u.role = role === 'admin' ? 'admin' : 'user';
    if (password) { u.password = hashPassword(password); u.passwordPlain = String(password); }
    if (email !== undefined) u.email = String(email || '').trim();
    if (phone !== undefined) u.phone = String(phone || '').trim();
    return adminUser(u);
  });
  res.json(out);
}));

router.delete('/users/:id', requireAdmin, wrap(async (req, res) => {
  await update((db) => {
    if (req.params.id === req.user.id) throw httpError(400, 'You cannot delete yourself');
    db.users = db.users.filter((u) => u.id !== req.params.id);
    // Unassign deleted user from subtasks
    db.tasks.forEach((t) => t.subtasks.forEach((s) => {
      s.assignees = (s.assignees || []).filter((id) => id !== req.params.id);
    }));
  });
  res.json({ ok: true });
}));

// Aggregated overview: for each user, which company → task → sub-tasks they are
// assigned to (optionally scoped to one financial year). Admin only.
router.get('/assignments', requireAdmin, wrap(async (req, res) => {
  const db = await getDb();
  const fy = req.query.fy || null;
  const companyById = {};
  db.companies.forEach((c) => { companyById[c.id] = c; });
  const monthIdx = (m) => { const i = MONTHS.indexOf(m); return i === -1 ? 99 : i; };

  const users = db.users.map((u) => {
    const companies = {}; // companyId -> { id, name, active, tasks: { key -> { name, subtasks: [] } } }
    db.tasks.forEach((t) => {
      if (fy && t.fy !== fy) return;
      (t.subtasks || []).forEach((s) => {
        if (!(s.assignees || []).includes(u.id)) return;
        const c = companies[t.companyId] || (companies[t.companyId] = {
          id: t.companyId, name: (companyById[t.companyId] || {}).name || 'Unknown',
          active: (companyById[t.companyId] || {}).active !== false, tasks: {},
        });
        // Group by task identity, not by display name: two distinct tasks that happen
        // to share a name must not be merged (which previously pulled in unrelated
        // sub-tasks). Instances of the SAME master task still aggregate across months.
        const key = t.masterTaskId || `id:${t.id}`;
        const task = c.tasks[key] || (c.tasks[key] = { name: t.name, priority: '', subtasks: [] });
        if (!task.priority && t.priority) task.priority = t.priority; // carry priority from any instance
        task.subtasks.push({ name: s.name, month: t.month, fy: t.fy, dueDate: s.dueDate || null, status: s.status, closingValue: t.closingValue || '' });
      });
    });

    const companyList = Object.values(companies).map((c) => {
      const tasks = Object.values(c.tasks).sort((a, b) => a.name.localeCompare(b.name));
      const counts = { completed: 0, in_progress: 0, pending: 0 };
      let subtaskCount = 0;
      tasks.forEach((tk) => {
        tk.subtasks.sort((a, b) => (monthIdx(a.month) - monthIdx(b.month)) || a.name.localeCompare(b.name));
        tk.subtasks.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; subtaskCount++; });
      });
      return { ...c, tasks, taskCount: tasks.length, subtaskCount, counts };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const totals = { companies: companyList.length, tasks: 0, subtasks: 0, completed: 0, in_progress: 0, pending: 0 };
    companyList.forEach((c) => {
      totals.tasks += c.taskCount; totals.subtasks += c.subtaskCount;
      totals.completed += c.counts.completed; totals.in_progress += c.counts.in_progress; totals.pending += c.counts.pending;
    });

    return { id: u.id, name: u.name, username: u.username, role: u.role, email: u.email || '', phone: u.phone || '', companies: companyList, totals };
  });

  res.json({ fy, users });
}));

/* ------------------------------ companies ------------------------------ */

router.get('/companies', requireAuth, wrap(async (req, res) => {
  const db = await getDb();
  res.json(db.companies.slice().sort((a, b) => (a.order || 0) - (b.order || 0)));
}));

router.post('/companies', requireAdmin, wrap(async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const out = await update((db) => {
    const c = { id: uid('cmp'), name: name.trim(), active: true, order: db.companies.length, createdAt: new Date().toISOString() };
    db.companies.push(c);
    return c;
  });
  res.status(201).json(out);
}));

router.put('/companies/:id', requireAdmin, wrap(async (req, res) => {
  const { name, active } = req.body || {};
  const out = await update((db) => {
    const c = db.companies.find((x) => x.id === req.params.id);
    if (!c) throw httpError(404, 'Company not found');
    if (name !== undefined) c.name = name.trim();
    if (active !== undefined) c.active = !!active;
    return c;
  });
  res.json(out);
}));

router.delete('/companies/:id', requireAdmin, wrap(async (req, res) => {
  await update((db) => {
    db.companies = db.companies.filter((c) => c.id !== req.params.id);
    db.master = db.master.filter((m) => m.companyId !== req.params.id);
    db.tasks = db.tasks.filter((t) => t.companyId !== req.params.id);
  });
  res.json({ ok: true });
}));

/* ----------------------------- master list ----------------------------- */

router.get('/master', requireAuth, wrap(async (req, res) => {
  const db = await getDb();
  let list = db.master;
  if (req.query.companyId) list = list.filter((m) => m.companyId === req.query.companyId);
  list = list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  res.json(list);
}));

// Normalise an arbitrary value into a clean array of URL strings.
function cleanLinks(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 25);
}

router.post('/master/task', requireAdmin, wrap(async (req, res) => {
  const { companyId, name, description, links } = req.body || {};
  if (!companyId || !name) return res.status(400).json({ error: 'companyId, name required' });
  const out = await update((db) => {
    if (!db.companies.some((c) => c.id === companyId)) throw httpError(404, 'Company not found');
    const order = db.master.filter((m) => m.companyId === companyId).length;
    const mt = { id: uid('mt'), companyId, name: name.trim(), description: String(description || ''), links: cleanLinks(links), active: true, order, subtasks: [] };
    db.master.push(mt);
    // A master task is a template only. It appears in a month solely when an admin
    // imports/adds it there (see /import) — never auto-populated across months.
    return mt;
  });
  res.status(201).json(out);
}));

router.put('/master/task/:id', requireAdmin, wrap(async (req, res) => {
  const { name, active, description, links } = req.body || {};
  const out = await update((db) => {
    const mt = db.master.find((m) => m.id === req.params.id);
    if (!mt) throw httpError(404, 'Master task not found');
    if (name !== undefined) mt.name = name.trim();
    if (active !== undefined) mt.active = !!active;
    if (description !== undefined) mt.description = String(description || '');
    if (links !== undefined) mt.links = cleanLinks(links);
    return mt;
  });
  res.json(out);
}));

router.delete('/master/task/:id', requireAdmin, wrap(async (req, res) => {
  await update((db) => { db.master = db.master.filter((m) => m.id !== req.params.id); });
  res.json({ ok: true });
}));

router.post('/master/task/:id/subtask', requireAdmin, wrap(async (req, res) => {
  const { name, description, links } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const out = await update((db) => {
    const mt = db.master.find((m) => m.id === req.params.id);
    if (!mt) throw httpError(404, 'Master task not found');
    const sub = { id: uid('ms'), name: name.trim(), description: String(description || ''), links: cleanLinks(links), active: true, order: mt.subtasks.length };
    mt.subtasks.push(sub);
    // Template only — added to a month's task instance when that task is imported.
    return sub;
  });
  res.status(201).json(out);
}));

router.put('/master/subtask/:id', requireAdmin, wrap(async (req, res) => {
  const { name, active, description, links } = req.body || {};
  const out = await update((db) => {
    for (const mt of db.master) {
      const s = mt.subtasks.find((x) => x.id === req.params.id);
      if (s) {
        if (name !== undefined) s.name = name.trim();
        if (active !== undefined) s.active = !!active;
        if (description !== undefined) s.description = String(description || '');
        if (links !== undefined) s.links = cleanLinks(links);
        return s;
      }
    }
    throw httpError(404, 'Master subtask not found');
  });
  res.json(out);
}));

router.delete('/master/subtask/:id', requireAdmin, wrap(async (req, res) => {
  await update((db) => {
    for (const mt of db.master) {
      mt.subtasks = mt.subtasks.filter((s) => s.id !== req.params.id);
    }
  });
  res.json({ ok: true });
}));

// Copy master tasks + sub-tasks from one company's master list into another.
router.post('/master/import-company', requireAdmin, wrap(async (req, res) => {
  const { fromCompanyId, toCompanyId, taskIds } = req.body || {};
  if (!fromCompanyId || !toCompanyId) return res.status(400).json({ error: 'fromCompanyId, toCompanyId required' });
  if (fromCompanyId === toCompanyId) return res.status(400).json({ error: 'Source and target companies are the same' });

  const out = await update((db) => {
    if (!db.companies.some((c) => c.id === toCompanyId)) throw httpError(404, 'Target company not found');
    let src = db.master.filter((m) => m.companyId === fromCompanyId);
    if (Array.isArray(taskIds) && taskIds.length) src = src.filter((m) => taskIds.includes(m.id));

    const existingNames = new Set(db.master.filter((m) => m.companyId === toCompanyId).map((m) => m.name.toLowerCase()));
    let baseOrder = db.master.filter((m) => m.companyId === toCompanyId).length;
    let added = 0, skipped = 0;
    src.forEach((mt) => {
      if (existingNames.has(mt.name.toLowerCase())) { skipped++; return; } // skip same-named tasks
      db.master.push({
        id: uid('mt'), companyId: toCompanyId, name: mt.name, active: mt.active, order: baseOrder++,
        subtasks: mt.subtasks.map((s, i) => ({ id: uid('ms'), name: s.name, active: s.active, order: i })),
      });
      existingNames.add(mt.name.toLowerCase());
      added++;
    });
    return { added, skipped };
  });
  res.json(out);
}));

/* --------------------------- monthly tasks ----------------------------- */

router.get('/tasks', requireAuth, wrap(async (req, res) => {
  const db = await getDb();
  const { fy, companyId, month } = req.query;
  let list = db.tasks;
  if (fy) list = list.filter((t) => t.fy === fy);
  if (companyId) list = list.filter((t) => t.companyId === companyId);
  if (month) list = list.filter((t) => t.month === month);
  list = list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

  // Non-admins only receive sub-tasks allotted to them (privacy enforced server-side).
  if (req.user.role !== 'admin') {
    const uid = req.user.id;
    list = list
      .map((t) => ({ ...t, subtasks: (t.subtasks || []).filter((s) => (s.assignees || []).includes(uid)) }))
      .filter((t) => t.subtasks.length);
  }
  res.json(list);
}));

const PRIORITIES = ['high', 'medium', 'low'];
const cleanPriority = (p) => (PRIORITIES.includes(p) ? p : '');

router.post('/tasks', requireAdmin, wrap(async (req, res) => {
  const { fy, companyId, month, name, priority } = req.body || {};
  if (!fy || !companyId || !month || !name) return res.status(400).json({ error: 'fy, companyId, month, name required' });
  if (!MONTHS.includes(month)) return res.status(400).json({ error: 'Invalid month' });
  const out = await update((db) => {
    const order = db.tasks.filter((t) => t.fy === fy && t.companyId === companyId && t.month === month).length;
    const task = { id: uid('tsk'), fy, companyId, month, name: name.trim(), masterTaskId: null, priority: cleanPriority(priority), order, subtasks: [], createdAt: new Date().toISOString() };
    db.tasks.push(task);
    addFY(db, fy);
    return task;
  });
  res.status(201).json(out);
}));

router.put('/tasks/:id', requireAdmin, wrap(async (req, res) => {
  const { name, priority } = req.body || {};
  const out = await update((db) => {
    const t = db.tasks.find((x) => x.id === req.params.id);
    if (!t) throw httpError(404, 'Task not found');
    if (name !== undefined) t.name = name.trim();
    if (priority !== undefined) t.priority = cleanPriority(priority);
    return t;
  });
  res.json(out);
}));

router.delete('/tasks/:id', requireAdmin, wrap(async (req, res) => {
  await update((db) => { db.tasks = db.tasks.filter((t) => t.id !== req.params.id); });
  res.json({ ok: true });
}));

// Closing value / remark for a main task. Editable by an admin or any user who is
// an assignee of one of the task's sub-tasks.
router.put('/tasks/:id/closing', requireAuth, wrap(async (req, res) => {
  const { value } = req.body || {};
  const out = await update((db) => {
    const t = db.tasks.find((x) => x.id === req.params.id);
    if (!t) throw httpError(404, 'Task not found');
    const isAdmin = req.user.role === 'admin';
    const isAssignee = (t.subtasks || []).some((s) => (s.assignees || []).includes(req.user.id));
    if (!isAdmin && !isAssignee) throw httpError(403, 'Not allowed to update this task');
    t.closingValue = String(value || '');
    return { id: t.id, closingValue: t.closingValue };
  });
  res.json(out);
}));

router.post('/tasks/:id/subtasks', requireAdmin, wrap(async (req, res) => {
  const { name, assignees, dueDate } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const out = await update((db) => {
    const t = db.tasks.find((x) => x.id === req.params.id);
    if (!t) throw httpError(404, 'Task not found');
    const sub = {
      id: uid('st'), name: name.trim(), masterSubtaskId: null,
      assignees: Array.isArray(assignees) ? assignees : [],
      dueDate: dueDate || null, status: 'pending', remarks: '',
      completedDate: null, completedBy: null,
    };
    t.subtasks.push(sub);
    return sub;
  });
  res.status(201).json(out);
}));

// Update a subtask. Admin may change anything; an assignee may change status/remarks.
router.put('/subtasks/:id', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const out = await update((db) => {
    let target = null, parent = null;
    for (const t of db.tasks) {
      const s = t.subtasks.find((x) => x.id === req.params.id);
      if (s) { target = s; parent = t; break; }
    }
    if (!target) throw httpError(404, 'Subtask not found');

    const isAdmin = req.user.role === 'admin';
    const isAssignee = (target.assignees || []).includes(req.user.id);
    if (!isAdmin && !isAssignee) throw httpError(403, 'Not allowed to update this subtask');

    if (isAdmin) {
      if (body.name !== undefined) target.name = body.name.trim();
      if (body.assignees !== undefined) target.assignees = Array.isArray(body.assignees) ? body.assignees : [];
      if (body.dueDate !== undefined) target.dueDate = body.dueDate || null;
    }
    if (body.status !== undefined) {
      if (!['pending', 'in_progress', 'completed'].includes(body.status)) throw httpError(400, 'Invalid status');
      target.status = body.status;
      if (body.status === 'completed') {
        target.completedDate = new Date().toISOString();
        target.completedBy = req.user.id;
      } else {
        target.completedDate = null;
        target.completedBy = null;
      }
    }
    if (body.remarks !== undefined) target.remarks = String(body.remarks);
    return { subtask: target, taskId: parent.id };
  });
  res.json(out);
}));

router.delete('/subtasks/:id', requireAdmin, wrap(async (req, res) => {
  await update((db) => {
    for (const t of db.tasks) t.subtasks = t.subtasks.filter((s) => s.id !== req.params.id);
  });
  res.json({ ok: true });
}));

/* ----------------- import from master / copy from month ---------------- */

// Import selected (or all active) master tasks+subtasks into a month.
router.post('/import', requireAdmin, wrap(async (req, res) => {
  const { fy, companyId, month, taskIds } = req.body || {};
  if (!fy || !companyId || !month) return res.status(400).json({ error: 'fy, companyId, month required' });
  if (!MONTHS.includes(month)) return res.status(400).json({ error: 'Invalid month' });

  const out = await update((db) => {
    let masterTasks = db.master.filter((m) => m.companyId === companyId && m.active);
    if (Array.isArray(taskIds) && taskIds.length) masterTasks = masterTasks.filter((m) => taskIds.includes(m.id));

    const existing = db.tasks.filter((t) => t.fy === fy && t.companyId === companyId && t.month === month);
    let added = 0;
    let baseOrder = existing.length;
    masterTasks.forEach((mt) => {
      if (existing.some((t) => t.masterTaskId === mt.id)) return; // skip duplicates
      const task = {
        id: uid('tsk'), fy, companyId, month, name: mt.name, masterTaskId: mt.id,
        description: mt.description || '', links: (mt.links || []).slice(),
        order: baseOrder++, createdAt: new Date().toISOString(),
        subtasks: mt.subtasks.filter((s) => s.active).map((s) => ({
          id: uid('st'), name: s.name, masterSubtaskId: s.id,
          description: s.description || '', links: (s.links || []).slice(),
          assignees: [], dueDate: null,
          status: 'pending', remarks: '', completedDate: null, completedBy: null,
        })),
      };
      db.tasks.push(task);
      added++;
    });
    addFY(db, fy);
    return { added };
  });
  res.json(out);
}));

// Copy all tasks+subtasks of a month into another month (optionally keep allottees).
router.post('/copy', requireAdmin, wrap(async (req, res) => {
  const { fy, companyId, fromMonth, toMonth, includeAssignees, taskIds, subtaskIds } = req.body || {};
  if (!fy || !companyId || !fromMonth || !toMonth) return res.status(400).json({ error: 'fy, companyId, fromMonth, toMonth required' });
  if (!MONTHS.includes(fromMonth) || !MONTHS.includes(toMonth)) return res.status(400).json({ error: 'Invalid month' });
  if (fromMonth === toMonth) return res.status(400).json({ error: 'Source and target months are the same' });

  // Optional selection: limit to chosen tasks / sub-tasks. Omitted = copy everything.
  const taskSet = Array.isArray(taskIds) && taskIds.length ? new Set(taskIds) : null;
  const subSet = Array.isArray(subtaskIds) ? new Set(subtaskIds) : null;

  const out = await update((db) => {
    const source = db.tasks.filter((t) => t.fy === fy && t.companyId === companyId && t.month === fromMonth);
    const existing = db.tasks.filter((t) => t.fy === fy && t.companyId === companyId && t.month === toMonth);
    let baseOrder = existing.length;
    let copied = 0, copiedSubs = 0;
    source.forEach((src) => {
      if (taskSet && !taskSet.has(src.id)) return; // task not selected
      let srcSubs = src.subtasks || [];
      if (subSet) srcSubs = srcSubs.filter((s) => subSet.has(s.id));
      // skip a task whose sub-tasks were all deselected (but keep genuinely empty tasks)
      if (subSet && srcSubs.length === 0 && (src.subtasks || []).length > 0) return;
      const task = {
        id: uid('tsk'), fy, companyId, month: toMonth, name: src.name, masterTaskId: src.masterTaskId || null,
        description: src.description || '', links: (src.links || []).slice(),
        order: baseOrder++, createdAt: new Date().toISOString(),
        subtasks: srcSubs.map((s) => ({
          id: uid('st'), name: s.name, masterSubtaskId: s.masterSubtaskId || null,
          description: s.description || '', links: (s.links || []).slice(),
          assignees: includeAssignees ? (s.assignees || []).slice() : [],
          dueDate: null, status: 'pending', remarks: '', completedDate: null, completedBy: null,
        })),
      };
      db.tasks.push(task);
      copied++; copiedSubs += task.subtasks.length;
    });
    return { copied, copiedSubs };
  });
  res.json(out);
}));

/* ----------------------------- FY management --------------------------- */

router.post('/years', requireAdmin, wrap(async (req, res) => {
  const { fy } = req.body || {};
  if (!/^\d{4}-\d{2}$/.test(fy || '')) return res.status(400).json({ error: 'Use format YYYY-YY e.g. 2026-27' });
  const out = await update((db) => { addFY(db, fy); return db.meta.financialYears; });
  res.json({ financialYears: out });
}));

function addFY(db, fy) {
  if (fy && !db.meta.financialYears.includes(fy)) {
    db.meta.financialYears.push(fy);
    db.meta.financialYears.sort();
  }
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Convert thrown httpErrors into proper status codes.
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

module.exports = router;
