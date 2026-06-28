'use strict';

/* ============================================================= *
 *  Accounting Task Manager — single-page application
 * ============================================================= */

const state = {
  user: null,
  users: [],
  usersById: {},
  companies: [],
  meta: { months: [], financialYears: [], defaultFY: '' },
  fy: '',
  sel: { companyId: '', month: '' },
  route: { name: 'dashboard', params: {} },
};

const MONTHS = () => state.meta.months;
const isAdmin = () => state.user && state.user.role === 'admin';
const companyById = (id) => state.companies.find((c) => c.id === id);
const userName = (id) => (state.usersById[id] ? state.usersById[id].name : 'Unknown');
// Admins see everything; a normal user only sees sub-tasks allotted to them.
const visibleSub = (s) => isAdmin() || (s.assignees || []).includes(state.user.id);

/* ------------------------- financial-year window --------------------- */
// Financial year runs April–March. The current FY's start year is the
// calendar year if we're in Apr–Dec, otherwise the previous year.
function currentFYStart(d = new Date()) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }
function fyLabel(startYear) { return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`; }
function currentFY() { return fyLabel(currentFYStart()); }
// Dropdown window: 2 years back … current … 5 years ahead (recomputed each year).
function financialYearList() {
  const start = currentFYStart();
  const list = [];
  for (let y = start - 2; y <= start + 5; y++) list.push(fyLabel(y));
  // keep any out-of-window years that already hold data, so nothing is orphaned
  (state.meta.financialYears || []).forEach((fy) => { if (!list.includes(fy)) list.push(fy); });
  return list.sort();
}

/* ----------------------------- utilities ----------------------------- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
// Format a numeric value with Indian thousands separators; passes through non-numbers.
function fmtNum(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('en-IN');
}
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

// Normalise a user-entered URL and produce a short, readable label for it.
function linkHref(u) { return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
function linkLabel(u) { try { return new URL(linkHref(u)).hostname.replace(/^www\./, ''); } catch (_) { return u; } }

// Inline meta shown right after a task/sub-task name: reference link(s) rendered
// as plain "link" hyperlinks, plus a "?" help button that pops up the description.
function inlineMeta(obj) {
  if (!obj) return '';
  const links = obj.links || [];
  const bits = [];
  links.forEach((u, i) => {
    const label = links.length > 1 ? `link ${i + 1}` : 'link';
    bits.push(`<a class="meta-link" href="${esc(linkHref(u))}" target="_blank" rel="noopener" title="${esc(u)}">🔗 ${label}</a>`);
  });
  if (obj.description) {
    bits.push(`<button type="button" class="help-btn" data-help="${esc(obj.description)}" title="Show description" aria-label="Show description">?</button>`);
  }
  return bits.length ? ` <span class="meta-inline">${bits.join('')}</span>` : '';
}

// Lightweight popover used by the help (?) buttons to reveal a description.
let helpAnchor = null;
function closeHelpPopover() {
  const p = document.getElementById('help-pop');
  if (p) p.remove();
  helpAnchor = null;
}
function showHelpPopover(btn) {
  if (helpAnchor === btn) { closeHelpPopover(); return; } // toggle off on re-click
  closeHelpPopover();
  helpAnchor = btn;
  const pop = document.createElement('div');
  pop.id = 'help-pop';
  pop.className = 'help-pop';
  pop.innerHTML = `<div class="help-pop-title">Description</div><div class="help-pop-body">${esc(btn.dataset.help || '')}</div>`;
  document.body.appendChild(pop);
  const r = btn.getBoundingClientRect();
  let left = r.left + window.scrollX;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12;
  if (left > maxLeft) left = Math.max(window.scrollX + 12, maxLeft);
  pop.style.top = `${r.bottom + window.scrollY + 8}px`;
  pop.style.left = `${left}px`;
}

// One delegated handler (capture phase) so help buttons work in any rendered view
// without re-binding, and so a click never also toggles a collapsible card.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.help-btn');
  if (btn) { e.preventDefault(); e.stopPropagation(); showHelpPopover(btn); return; }
  if (!e.target.closest('#help-pop')) closeHelpPopover();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelpPopover(); });
window.addEventListener('resize', closeHelpPopover);

function toast(msg, type = '') {
  const host = $('#toast-host');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2800);
}

/* ------------------------------- modal ------------------------------- */
function openModal({ title, body, footer = '', size = '' }) {
  const host = $('#modal-host');
  host.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${size}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" data-close>&times;</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>`;
  const backdrop = $('.modal-backdrop', host);
  const close = () => { host.innerHTML = ''; };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  $all('[data-close]', host).forEach((b) => b.addEventListener('click', close));
  return { host, close, el: $('.modal', host) };
}

function confirmDialog(message, { danger = true, okText = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title: 'Please confirm',
      body: `<p style="font-size:14px;line-height:1.6">${esc(message)}</p>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>`,
    });
    $('[data-ok]', m.host).addEventListener('click', () => { m.close(); resolve(true); });
    $('[data-cancel]', m.host).addEventListener('click', () => { m.close(); resolve(false); });
  });
}

// Two-step confirmation for deleting a sub-task: a quick prompt, then a larger
// final warning to prevent accidental deletes.
async function confirmDeleteSubtask(name) {
  const first = await confirmDialog(`Delete sub-task "${name}"?`, { okText: 'Delete' });
  if (!first) return false;
  return new Promise((resolve) => {
    const m = openModal({
      title: 'Confirm deletion',
      size: 'lg',
      body: `<div style="text-align:center;padding:14px 8px">
          <div style="font-size:52px;line-height:1;margin-bottom:14px">🗑️</div>
          <p style="font-size:17px;font-weight:700;margin-bottom:8px">Permanently delete "${esc(name)}"?</p>
          <p class="muted" style="font-size:14px">This is your final confirmation. The sub-task will be removed from the master list and cannot be recovered.</p>
        </div>`,
      footer: `<button class="btn btn-ghost" data-cancel>Cancel</button>
               <button class="btn btn-danger" data-ok>Yes, delete permanently</button>`,
    });
    $('[data-ok]', m.host).addEventListener('click', () => { m.close(); resolve(true); });
    $('[data-cancel]', m.host).addEventListener('click', () => { m.close(); resolve(false); });
  });
}

/* ----------------------------- data calc ----------------------------- */
function countSubs(tasks, filter) {
  const c = { completed: 0, in_progress: 0, pending: 0, total: 0 };
  tasks.forEach((t) => (t.subtasks || []).forEach((s) => {
    if (filter && !filter(s, t)) return;
    c[s.status] = (c[s.status] || 0) + 1; c.total += 1;
  }));
  return c;
}
function collectSubs(tasks, filter) {
  const out = [];
  tasks.forEach((t) => (t.subtasks || []).forEach((s) => { if (!filter || filter(s, t)) out.push({ task: t, sub: s }); }));
  return out;
}
const STATUS_ORDER = ['completed', 'in_progress', 'pending'];

/* =====================================================================
 *  AUTH
 * ===================================================================== */
async function doLogin(e) {
  e.preventDefault();
  const btn = $('#login-form button');
  const errBox = $('#login-error');
  errBox.classList.add('hidden');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { token } = await API.login($('#login-username').value, $('#login-password').value);
    API.setToken(token);
    await boot();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

function logout() {
  API.setToken(null);
  location.reload();
}

/* =====================================================================
 *  BOOTSTRAP + SHELL
 * ===================================================================== */
async function boot() {
  try {
    const data = await API.bootstrap();
    state.user = data.user;
    state.users = data.users;
    state.usersById = {};
    data.users.forEach((u) => { state.usersById[u.id] = u; });
    state.companies = data.companies;
    state.meta = data.meta;
    state.fy = currentFY(); // default to the current financial year
    $('#login-screen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderShell();
    // Sentinel root entry: pressing Back from the home view lands here and bounces
    // back to the dashboard (see popstate handler), so the app never closes.
    window.history.replaceState({ _root: true }, '');
    navigate('dashboard'); // pushed on top of the sentinel
  } catch (err) {
    API.setToken(null);
    showLogin();
  }
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

function renderShell() {
  // user chip
  $('#user-avatar').textContent = initials(state.user.name);
  $('#user-name').textContent = state.user.name;
  $('#user-role').textContent = state.user.role;

  const nav = [
    { name: 'dashboard', label: 'Dashboard', ico: '📊' },
    { name: 'mytasks', label: 'My Tasks', ico: '✅', admin: true },
    { name: 'allot', label: 'Allotment', ico: '🗂️', admin: true },
    { name: 'report', label: 'Data Sheet', ico: '📋', admin: true },
    { sec: 'Setup', admin: true },
    { name: 'master', label: 'Master List', ico: '🧩', admin: true },
    { name: 'companies', label: 'Companies', ico: '🏢', admin: true },
    { name: 'users', label: 'Users', ico: '👥', admin: true },
    { name: 'workload', label: 'User Management', ico: '🧭', admin: true },
  ];
  $('#nav').innerHTML = nav.map((n) => {
    if (n.admin && !isAdmin()) return '';
    if (n.sec) return `<div class="nav-section">${n.sec}</div>`;
    return `<div class="nav-item" data-route="${n.name}"><span class="ico">${n.ico}</span>${n.label}</div>`;
  }).join('');
  $all('.nav-item', $('#nav')).forEach((it) => it.addEventListener('click', () => navigate(it.dataset.route)));
}

function setActiveNav(name) {
  $all('.nav-item').forEach((it) => it.classList.toggle('active', it.dataset.route === name));
}

/* ------------------------------ router ------------------------------- */
const VIEWS = {};
// hist: 'push' (default, new browser history entry), 'replace' (overwrite current),
// or 'none' (don't touch history — used when responding to the browser Back button).
async function navigate(name, params = {}, hist = 'push') {
  state.route = { name, params };

  // Keep the browser Back button inside the app: every navigation is a history
  // entry, so Back returns to the previous view instead of leaving the page.
  if (hist !== 'none') {
    const entry = { name, params };
    const cur = window.history.state;
    const same = cur && cur.name === name && JSON.stringify(cur.params || {}) === JSON.stringify(params || {});
    if (hist === 'replace' || same) window.history.replaceState(entry, '');
    else window.history.pushState(entry, '');
  }

  // map drilldown routes to their nav highlight
  let navKey = name;
  if (['company', 'month'].includes(name)) navKey = 'dashboard';
  else if (['workloadUser', 'workloadCompany', 'workloadMonth'].includes(name)) navKey = 'workload';
  setActiveNav(navKey);
  Charts.destroyAll();
  const view = $('#view');
  view.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    await VIEWS[name](params);
  } catch (err) {
    view.innerHTML = `<div class="empty-state"><div class="big">⚠️</div><h3>${esc(err.message)}</h3></div>`;
  }
}

function crumbs(items) {
  const bc = $('#breadcrumbs');
  if (!bc) return; // top bar removed — breadcrumbs are a no-op
  bc.innerHTML = items.map((c, i) => {
    const last = i === items.length - 1;
    const sep = i > 0 ? '<span class="sep">/</span>' : '';
    if (last || !c.go) return `${sep}<span class="crumb current">${esc(c.label)}</span>`;
    return `${sep}<span class="crumb" data-i="${i}">${esc(c.label)}</span>`;
  }).join('');
  $all('.crumb[data-i]', $('#breadcrumbs')).forEach((el) => {
    const c = items[parseInt(el.dataset.i, 10)];
    el.addEventListener('click', c.go);
  });
}

function fySelect(onChange) {
  const years = financialYearList();
  if (!years.includes(state.fy)) state.fy = currentFY();
  const opts = years.map((y) => `<option value="${y}" ${y === state.fy ? 'selected' : ''}>FY ${y}</option>`).join('');
  const sel = document.createElement('select');
  sel.className = 'input';
  sel.innerHTML = opts;
  sel.addEventListener('change', () => { state.fy = sel.value; onChange(); });
  return sel;
}

/* =====================================================================
 *  VIEW: DASHBOARD (Home) — point 9
 * ===================================================================== */
VIEWS.dashboard = async () => {
  crumbs([{ label: 'Dashboard' }]);
  const tasks = await API.get(`/tasks?fy=${encodeURIComponent(state.fy)}`);
  const view = $('#view');
  const companies = state.companies.filter((c) => c.active);

  const totals = countSubs(tasks, (s) => visibleSub(s));
  const labels = companies.map((c) => c.name);
  const series = { completed: [], in_progress: [], pending: [] };
  companies.forEach((c) => {
    const cc = countSubs(tasks, (s, t) => t.companyId === c.id && visibleSub(s));
    series.completed.push(cc.completed);
    series.in_progress.push(cc.in_progress);
    series.pending.push(cc.pending);
  });

  view.innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><p>Company-wise task status for the financial year</p></div>
      <div class="row" id="fy-slot"></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Total Sub-tasks</div><div class="value">${totals.total}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${totals.completed}</div></div>
      <div class="stat progress"><div class="label">In Progress</div><div class="value">${totals.in_progress}</div></div>
      <div class="stat pending"><div class="label">Pending</div><div class="value">${totals.pending}</div></div>
    </div>
    <div class="card chart-card">
      <div class="chart-title">Financial year: ${esc(state.fy)}</div>
      ${totals.total === 0
        ? `<div class="chart-empty"><div class="big">📊</div><div>No tasks for this year yet.<br>${isAdmin() ? 'Use <b>Allotment</b> to import tasks from the master list.' : ''}</div></div>`
        : `<div class="chart-wrap"><canvas id="home-chart"></canvas></div>
           <div class="chart-hint">Tip: click a company's bar segment to see the underlying tasks.</div>`}
    </div>`;
  $('#fy-slot').appendChild(fySelect(() => navigate('dashboard')));

  if (totals.total > 0) {
    Charts.stacked($('#home-chart'), labels, series, STATUS_ORDER, (idx, status) => {
      const c = companies[idx];
      if (c) navigate('company', { companyId: c.id });
    });
  }
};

/* =====================================================================
 *  VIEW: COMPANY (months) — point 10
 * ===================================================================== */
VIEWS.company = async ({ companyId }) => {
  const company = companyById(companyId);
  if (!company) throw new Error('Company not found');
  state.sel.companyId = companyId;
  crumbs([
    { label: 'Dashboard', go: () => navigate('dashboard') },
    { label: company.name },
  ]);
  const tasks = await API.get(`/tasks?fy=${encodeURIComponent(state.fy)}&companyId=${companyId}`);
  const months = MONTHS();
  const series = { completed: [], in_progress: [], pending: [] };
  months.forEach((m) => {
    const cc = countSubs(tasks, (s, t) => t.month === m && visibleSub(s));
    series.completed.push(cc.completed); series.in_progress.push(cc.in_progress); series.pending.push(cc.pending);
  });
  const total = countSubs(tasks, (s) => visibleSub(s)).total;

  $('#view').innerHTML = `
    <div class="page-head">
      <div><h1>${esc(company.name)}</h1><p>Month-wise status · click a month for the staff breakdown</p></div>
      <div class="row"><button class="btn btn-outline btn-sm" id="back">← Back</button></div>
    </div>
    <div class="card chart-card">
      <div class="chart-title">${esc(company.name)} &nbsp;·&nbsp; Financial year: ${esc(state.fy)}</div>
      ${total === 0
        ? `<div class="chart-empty"><div class="big">🗓️</div><div>No tasks for this company yet.</div></div>`
        : `<div class="chart-wrap"><canvas id="comp-chart"></canvas></div>
           <div class="chart-hint">Tip: click a month's bar to open the staff-wise chart.</div>`}
    </div>`;
  $('#back').addEventListener('click', () => navigate('dashboard'));

  if (total > 0) {
    Charts.stacked($('#comp-chart'), months, series, STATUS_ORDER, (idx) => {
      navigate('month', { companyId, month: months[idx] });
    });
  }
};

/* =====================================================================
 *  VIEW: MONTH (staff-wise) — point 11 + drilldown point 12
 * ===================================================================== */
const monthFilter = { status: '', due: '' };
const monthCollapsed = new Set(); // remembers which month tasks are collapsed

VIEWS.month = async ({ companyId, month }) => {
  const company = companyById(companyId);
  if (!company) throw new Error('Company not found');
  state.sel.companyId = companyId; state.sel.month = month;
  state._monthCtx = { companyId, month };
  crumbs([
    { label: 'Dashboard', go: () => navigate('dashboard') },
    { label: company.name, go: () => navigate('company', { companyId }) },
    { label: month },
  ]);

  const view = $('#view');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>${esc(company.name)} — ${esc(month)}</h1>
        <p>${isAdmin() ? 'All tasks for this month' : 'Your tasks for this month'} · FY ${esc(state.fy)}</p></div>
      <div class="row">
        <button class="btn btn-outline btn-sm" id="back">← Back</button>
        ${isAdmin() ? `<button class="btn btn-primary btn-sm" id="goallot">Allot work →</button>` : ''}
      </div>
    </div>
    <div class="toolbar card card-pad">
      <div class="field"><span class="lbl">Status</span>
        <select class="input" id="f-status">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select></div>
      <div class="field"><span class="lbl">Due</span>
        <select class="input" id="f-due">
          <option value="">All</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
          <option value="nodue">No due date</option>
        </select></div>
      <div style="flex:1"></div>
      <button class="btn btn-ghost btn-sm" id="f-clear">Clear filters</button>
    </div>
    <div id="month-body"></div>`;

  $('#back').addEventListener('click', () => navigate('company', { companyId }));
  const ga = $('#goallot');
  if (ga) ga.addEventListener('click', () => { state.sel = { companyId, month }; navigate('allot'); });
  $('#f-status').value = monthFilter.status;
  $('#f-due').value = monthFilter.due;
  $('#f-status').addEventListener('change', (e) => { monthFilter.status = e.target.value; renderMonthTasks(); });
  $('#f-due').addEventListener('change', (e) => { monthFilter.due = e.target.value; renderMonthTasks(); });
  $('#f-clear').addEventListener('click', () => {
    monthFilter.status = ''; monthFilter.due = '';
    $('#f-status').value = ''; $('#f-due').value = ''; renderMonthTasks();
  });

  await renderMonthTasks();
};

// Task list for a company + month (replaces the staff-wise chart).
// Users see only sub-tasks allotted to them; admins see everything.
async function renderMonthTasks() {
  const { companyId, month } = state._monthCtx;
  const body = $('#month-body');
  body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const tasks = await API.get(`/tasks?fy=${encodeURIComponent(state.fy)}&companyId=${companyId}&month=${encodeURIComponent(month)}`);
  const admin = isAdmin();
  const todayStr = toDateStr(new Date());
  const weekStr = toDateStr(new Date(Date.now() + 7 * 864e5));

  const mine = collectSubs(tasks, (s) => {
    if (!admin && !(s.assignees || []).includes(state.user.id)) return false;
    if (monthFilter.status && s.status !== monthFilter.status) return false;
    if (monthFilter.due) {
      const d = s.dueDate;
      if (monthFilter.due === 'nodue' && d) return false;
      if (monthFilter.due === 'overdue' && !(d && d < todayStr && s.status !== 'completed')) return false;
      if (monthFilter.due === 'today' && d !== todayStr) return false;
      if (monthFilter.due === 'week' && !(d && d >= todayStr && d <= weekStr)) return false;
    }
    return true;
  });

  const groups = []; const gmap = {};
  mine.forEach(({ task, sub }) => {
    if (!gmap[task.id]) { gmap[task.id] = { task, subs: [] }; groups.push(gmap[task.id]); }
    gmap[task.id].subs.push(sub);
  });

  if (!groups.length) {
    body.innerHTML = `<div class="card"><div class="empty-state"><div class="big">🗂️</div>
      <h3>${admin ? 'No tasks for this month' : 'No tasks allotted to you for this month'}</h3>
      <p class="muted">${admin ? 'Use “Allot work” to add or import tasks for this month.' : 'Try another month, or check with your administrator.'}</p></div></div>`;
    return;
  }

  const dueCell = (s) => {
    if (!s.dueDate) return '<span class="faint">—</span>';
    const overdue = s.dueDate < todayStr && s.status !== 'completed';
    return `<span class="${overdue ? 'overdue' : 'nowrap'}">${fmtDate(s.dueDate)}${overdue ? ' ⚠' : ''}</span>`;
  };

  const cards = groups.map((g, gi) => `
    <div class="card mb collapsible-card ${monthCollapsed.has(g.task.id) ? 'collapsed' : ''}" data-task="${g.task.id}">
      <div class="card-head">
        <div class="row" style="gap:10px;align-items:center;min-width:0">
          <button class="btn btn-ghost btn-icon collapse-btn" data-collapse title="Collapse / expand">▾</button>
          <div class="collapse-title" data-collapse style="cursor:pointer">
            <h2><span class="serial">${gi + 1}.</span> ${esc(g.task.name)}${priorityTag(g.task, g.subs)}${inlineMeta(g.task)}</h2>
            <span class="sub">${g.subs.length} sub-task(s)</span>
          </div>
          ${countChips(statusCounts(g.subs))}
        </div>
        <div class="closing-box" data-closing="${g.task.id}"></div>
      </div>
      <div class="collapsible">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Sub-task</th>${admin ? '<th>Allottee</th>' : ''}<th style="width:130px">Due</th><th style="width:130px">Status</th><th>Remarks</th><th></th></tr></thead>
          <tbody>
          ${g.subs.map((s) => `
            <tr data-sid="${s.id}">
              <td>${esc(s.name)}${inlineMeta(s)}</td>
              ${admin ? `<td>${(s.assignees || []).map((id) => `<span class="pill ${id === state.user.id ? 'me' : ''}">${esc(userName(id))}</span>`).join('') || '<span class="faint">Unassigned</span>'}</td>` : ''}
              <td class="nowrap">${dueCell(s)}</td>
              <td><span class="badge ${s.status}">${Charts.LABELS[s.status]}</span></td>
              <td>${s.remarks ? esc(s.remarks) : '<span class="faint">—</span>'}</td>
              <td class="nowrap"><button class="btn btn-outline btn-xs" data-update>Update</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`).join('');

  body.innerHTML = `
    <div class="row gap mb" style="justify-content:space-between;align-items:center">
      <span class="muted" style="font-size:13px">${mine.length} sub-task(s) across ${groups.length} task(s)</span>
      <span class="row gap">
        <button class="btn btn-ghost btn-xs" id="expand-all">Expand all</button>
        <button class="btn btn-ghost btn-xs" id="collapse-all">Collapse all</button>
      </span>
    </div>
    ${cards}`;

  const setCollapsed = (card, id, on) => { card.classList.toggle('collapsed', on); on ? monthCollapsed.add(id) : monthCollapsed.delete(id); };
  $('#expand-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.task, false)));
  $('#collapse-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.task, true)));

  const subById = {}; mine.forEach((m) => { subById[m.sub.id] = m; });
  const taskMap = {}; groups.forEach((g) => { taskMap[g.task.id] = g.task; });
  $all('[data-task]', body).forEach((card) => {
    $all('[data-collapse]', card).forEach((el) => el.addEventListener('click', () => setCollapsed(card, card.dataset.task, !card.classList.contains('collapsed'))));
    $all('[data-update]', card).forEach((btn) => btn.addEventListener('click', () => {
      const entry = subById[btn.closest('tr').dataset.sid];
      const cb = () => renderMonthTasks();
      if (admin) assignModal(entry.task, entry.sub, cb);
      else openStatusModal(entry, cb);
    }));
    const box = $('.closing-box', card);
    if (box) bindClosingBox(box, taskMap[card.dataset.task]);
  });
}

// Numeric "closing value" editor in a task header: shows the saved value with an
// Edit button, or a number input with Save (and Cancel when a value already exists).
function bindClosingBox(boxEl, task) {
  if (!task) return;
  const taskId = task.id;
  const render = (editing, focus) => {
    const v = task.closingValue == null ? '' : String(task.closingValue);
    const showInput = editing || v === '';
    if (showInput) {
      boxEl.innerHTML = `<label>Closing value</label>
        <div class="closing-row">
          <input type="number" step="any" inputmode="decimal" class="input closing-input" placeholder="Enter value…" value="${esc(v)}">
          <button class="btn btn-primary btn-xs" data-save>Save</button>
          ${v !== '' ? '<button class="btn btn-ghost btn-xs" data-cancel>Cancel</button>' : ''}
        </div>`;
      const input = $('.closing-input', boxEl);
      if (focus) { input.focus(); input.select(); }
      $('[data-save]', boxEl).addEventListener('click', async () => {
        const val = input.value.trim();
        if (val !== '' && isNaN(Number(val))) return toast('Enter a valid number', 'error');
        try {
          await API.put(`/tasks/${taskId}/closing`, { value: val });
          task.closingValue = val;
          toast('Closing value saved', 'success');
          render(false);
        } catch (e) { toast(e.message, 'error'); }
      });
      const cancel = $('[data-cancel]', boxEl);
      if (cancel) cancel.addEventListener('click', () => render(false));
    } else {
      boxEl.innerHTML = `<label>Closing value</label>
        <div class="closing-row">
          <span class="closing-val">${esc(fmtNum(v))}</span>
          <button class="btn btn-ghost btn-xs" data-edit>Edit</button>
        </div>`;
      $('[data-edit]', boxEl).addEventListener('click', () => render(true, true));
    }
  };
  render(false, false);
}

/* =====================================================================
 *  VIEW: MY TASKS (admin's own assignments across the year)
 * ===================================================================== */
const mytasksCollapsed = new Set(); // remembers which company cards are collapsed

VIEWS.mytasks = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'My Tasks' }]);
  const tasks = await API.get(`/tasks?fy=${encodeURIComponent(state.fy)}`);
  const isMine = (s) => (s.assignees || []).includes(state.user.id);
  const mine = collectSubs(tasks, isMine);
  const totals = countSubs(tasks, isMine);
  const todayStr = toDateStr(new Date());

  // group the admin's sub-tasks by company
  const groups = []; const gmap = {};
  mine.forEach(({ task, sub }) => {
    const cid = task.companyId;
    if (!gmap[cid]) { gmap[cid] = { companyId: cid, name: (companyById(cid) || {}).name || 'Unknown', items: [] }; groups.push(gmap[cid]); }
    gmap[cid].items.push({ task, sub });
  });
  groups.sort((a, b) => a.name.localeCompare(b.name));

  // my sub-tasks grouped by task id (for the priority badge + all-done check)
  const taskSubs = {};
  mine.forEach(({ task, sub }) => { (taskSubs[task.id] = taskSubs[task.id] || []).push(sub); });

  $('#view').innerHTML = `
    <div class="page-head">
      <div><h1>My Tasks</h1><p>Sub-tasks assigned to you across all companies · FY ${esc(state.fy)}</p></div>
      <div class="row" id="fy-slot"></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Total Sub-tasks</div><div class="value">${totals.total}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${totals.completed}</div></div>
      <div class="stat progress"><div class="label">In Progress</div><div class="value">${totals.in_progress}</div></div>
      <div class="stat pending"><div class="label">Pending</div><div class="value">${totals.pending}</div></div>
    </div>
    <div id="mt-body"></div>`;
  $('#fy-slot').appendChild(fySelect(() => navigate('mytasks')));

  const body = $('#mt-body');
  if (!groups.length) {
    body.innerHTML = `<div class="card"><div class="empty-state"><div class="big">🗂️</div>
      <h3>No tasks assigned to you</h3>
      <p class="muted">When a sub-task is assigned to you (in <b>Allotment</b>), it will appear here.</p></div></div>`;
    return;
  }

  const dueCell = (s) => {
    if (!s.dueDate) return '<span class="faint">—</span>';
    const overdue = s.dueDate < todayStr && s.status !== 'completed';
    return `<span class="${overdue ? 'overdue' : 'nowrap'}">${fmtDate(s.dueDate)}${overdue ? ' ⚠' : ''}</span>`;
  };

  body.innerHTML = `
    <div class="row gap mb" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-xs" id="expand-all">Expand all</button>
      <button class="btn btn-ghost btn-xs" id="collapse-all">Collapse all</button>
    </div>
    ${groups.map((g, gi) => `
    <div class="card mb collapsible-card ${mytasksCollapsed.has(g.companyId) ? 'collapsed' : ''}" data-co="${g.companyId}">
      <div class="card-head">
        <div class="row" style="gap:10px;align-items:center;min-width:0">
          <button class="btn btn-ghost btn-icon collapse-btn" data-collapse title="Collapse / expand">▾</button>
          <div class="collapse-title" data-collapse style="cursor:pointer">
            <h2><span class="serial">${gi + 1}.</span> ${esc(g.name)}</h2>
            <span class="sub">${g.items.length} sub-task(s)</span>
          </div>
          ${countChips(statusCounts(g.items.map((x) => x.sub)))}
        </div>
      </div>
      <div class="collapsible">
        <div class="table-wrap"><table class="data">
          <thead><tr><th style="width:24%">Task</th><th>Sub-task</th><th style="width:80px">Month</th><th style="width:120px">Due</th><th style="width:130px">Status</th><th>Remarks</th><th></th></tr></thead>
          <tbody>
          ${g.items.map(({ task, sub }) => `
            <tr data-sid="${sub.id}">
              <td><b>${esc(task.name)}</b>${priorityTag(task, taskSubs[task.id])}${inlineMeta(task)}</td>
              <td>${esc(sub.name)}${inlineMeta(sub)}</td>
              <td class="nowrap">${esc(task.month)}</td>
              <td class="nowrap">${dueCell(sub)}</td>
              <td><span class="badge ${sub.status}">${Charts.LABELS[sub.status]}</span></td>
              <td>${sub.remarks ? esc(sub.remarks) : '<span class="faint">—</span>'}</td>
              <td class="nowrap"><button class="btn btn-outline btn-xs" data-update>Update</button></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`).join('')}`;

  const setCollapsed = (c, id, on) => { c.classList.toggle('collapsed', on); on ? mytasksCollapsed.add(id) : mytasksCollapsed.delete(id); };
  $('#expand-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.co, false)));
  $('#collapse-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.co, true)));

  const byId = {}; mine.forEach((m) => { byId[m.sub.id] = m; });
  $all('[data-co]', body).forEach((card) => {
    $all('[data-collapse]', card).forEach((el) => el.addEventListener('click', () => setCollapsed(card, card.dataset.co, !card.classList.contains('collapsed'))));
    $all('[data-update]', card).forEach((btn) => btn.addEventListener('click', () => {
      const entry = byId[btn.closest('tr').dataset.sid];
      openStatusModal(entry, () => navigate('mytasks'));
    }));
  });
};

/* date helper (YYYY-MM-DD in local time), used by the month task list */
function toDateStr(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

/* Shared status/remarks editor — used by users on the month task list (point 8) */
function openStatusModal({ task, sub }, onDone) {
  const m = openModal({
    title: 'Update sub-task',
    body: `
      <p class="mb"><b>${esc(task.name)}</b> — ${esc(sub.name)}</p>
      <div class="field">
        <label>Status</label>
        <select class="input" id="st-status">
          <option value="pending" ${sub.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${sub.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="completed" ${sub.status === 'completed' ? 'selected' : ''}>Completed</option>
        </select>
      </div>
      <div class="field">
        <label>Remarks / Balance</label>
        <textarea class="input" id="st-remarks" placeholder="Add remarks or balance note…">${esc(sub.remarks || '')}</textarea>
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="st-save">Save</button>`,
  });
  $('#st-save', m.host).addEventListener('click', async () => {
    try {
      await API.put(`/subtasks/${sub.id}`, { status: $('#st-status', m.host).value, remarks: $('#st-remarks', m.host).value });
      m.close(); toast('Updated', 'success'); onDone();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* =====================================================================
 *  VIEW: ALLOTMENT — points 6,7,14,15,17
 * ===================================================================== */
VIEWS.allot = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'Allotment' }]);
  if (!state.sel.companyId) state.sel.companyId = (state.companies.find((c) => c.active) || {}).id || '';
  if (!state.sel.month) state.sel.month = MONTHS()[0];

  const view = $('#view');
  view.innerHTML = `
    <div class="page-head">
      <div><h1>Allot Work</h1><p>Assign tasks &amp; sub-tasks to staff with due dates</p></div>
    </div>
    <div class="toolbar card card-pad">
      <div class="field"><span class="lbl">Financial Year</span><span id="fy-slot"></span></div>
      <div class="field"><span class="lbl">Company</span><span id="cmp-slot"></span></div>
      <div class="field"><span class="lbl">Month</span><span id="mon-slot"></span></div>
      <div class="field"><span class="lbl">Priority</span>
        <select class="input" id="prio-filter">
          <option value="">All</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select></div>
      <div style="flex:1"></div>
      <button class="btn btn-outline" id="btn-import">＋ Import from Master</button>
      <button class="btn btn-outline" id="btn-copy">⧉ Copy from month</button>
      <button class="btn btn-primary" id="btn-addtask">＋ Add Task</button>
    </div>
    <div id="allot-body"></div>`;

  $('#fy-slot').appendChild(fySelect(() => navigate('allot')));
  buildCompanySelect($('#cmp-slot'), () => navigate('allot'));
  buildMonthSelect($('#mon-slot'), () => navigate('allot'));

  $('#btn-import').addEventListener('click', importModal);
  $('#btn-copy').addEventListener('click', copyModal);
  $('#btn-addtask').addEventListener('click', addTaskModal);

  const prioSel = $('#prio-filter');
  prioSel.value = allotPriorityFilter;
  prioSel.addEventListener('change', () => { allotPriorityFilter = prioSel.value; renderAllotBody(); });

  await renderAllotBody();
};

function buildCompanySelect(slot, onChange, includeInactive = false) {
  const sel = document.createElement('select');
  sel.className = 'input';
  const list = state.companies.filter((c) => includeInactive || c.active);
  sel.innerHTML = list.map((c) => `<option value="${c.id}" ${c.id === state.sel.companyId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  if (!state.sel.companyId && list[0]) state.sel.companyId = list[0].id;
  sel.addEventListener('change', () => { state.sel.companyId = sel.value; onChange(); });
  slot.appendChild(sel);
}
function buildMonthSelect(slot, onChange) {
  const sel = document.createElement('select');
  sel.className = 'input';
  sel.innerHTML = MONTHS().map((m) => `<option value="${m}" ${m === state.sel.month ? 'selected' : ''}>${esc(m)}</option>`).join('');
  sel.addEventListener('change', () => { state.sel.month = sel.value; onChange(); });
  slot.appendChild(sel);
}

const allotCollapsed = new Set(); // remembers which allotment tasks are collapsed
let allotPriorityFilter = '';     // '' = all, else 'high' | 'medium' | 'low'

// task priority helpers (allotment)
const PRIO_RANK = { high: 0, medium: 1, low: 2, '': 3 };
const PRIO_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const prioRank = (t) => (PRIO_RANK[t.priority || ''] ?? 3);
const prioBadge = (p) => (p ? `<span class="prio prio-${p}">${PRIO_LABEL[p]}</span>` : '');
// Priority badge for a task, hidden once every (relevant) sub-task is complete.
function priorityTag(task, subs) {
  if (!task || !task.priority) return '';
  const list = (subs && subs.length) ? subs : (task.subtasks || []);
  const allDone = list.length > 0 && list.every((s) => s.status === 'completed');
  return allDone ? '' : ` ${prioBadge(task.priority)}`;
}
function prioSelectHtml(val) {
  const opt = (v, l) => `<option value="${v}" ${(val || '') === v ? 'selected' : ''}>${l}</option>`;
  return `<select class="input" id="prio" style="width:100%">${opt('', 'No priority')}${opt('high', 'High')}${opt('medium', 'Medium')}${opt('low', 'Low')}</select>`;
}

// status counts (completed / in_progress / pending) for a task's sub-tasks
function statusCounts(subtasks) {
  const c = { completed: 0, in_progress: 0, pending: 0 };
  (subtasks || []).forEach((s) => { c[s.status] = (c[s.status] || 0) + 1; });
  return c;
}
function countChips(c) {
  const chip = (k, label) => (c[k] ? `<span class="cnt ${k}">${c[k]} ${label}</span>` : '');
  return `<span class="count-chips">${chip('completed', 'Completed')}${chip('in_progress', 'In Progress')}${chip('pending', 'Pending')}</span>`;
}

async function renderAllotBody() {
  const body = $('#allot-body');
  body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { companyId, month } = state.sel;
  const [tasks, master] = await Promise.all([
    API.get(`/tasks?fy=${encodeURIComponent(state.fy)}&companyId=${companyId}&month=${encodeURIComponent(month)}`),
    API.get(`/master?companyId=${companyId}`),
  ]);

  // active master tasks that are not yet imported into this month
  const importedIds = new Set(tasks.map((t) => t.masterTaskId).filter(Boolean));
  const missing = master.filter((m) => m.active && !importedIds.has(m.id));

  const importMissing = async () => {
    try {
      const r = await API.post('/import', { fy: state.fy, companyId, month, taskIds: missing.map((m) => m.id) });
      toast(`${r.added} task(s) added to ${month}`, 'success'); renderAllotBody();
    } catch (e) { toast(e.message, 'error'); }
  };

  if (!tasks.length) {
    body.innerHTML = `<div class="card"><div class="empty-state"><div class="big">🗂️</div>
      <h3>No tasks for ${esc(month)} yet</h3>
      <p class="muted">${missing.length ? `There are ${missing.length} task(s) in the master list ready to import.` : 'Add a task or build the master list first.'}</p>
      ${missing.length ? `<button class="btn btn-primary mt" id="import-all-empty">＋ Import ${missing.length} task(s) from Master</button>` : ''}
    </div></div>`;
    if (missing.length) $('#import-all-empty', body).addEventListener('click', importMissing);
    return;
  }

  const banner = missing.length ? `
    <div class="help-note spread" style="margin-bottom:16px">
      <span><b>${missing.length}</b> task(s) from the master list are not in ${esc(month)} yet.</span>
      <button class="btn btn-primary btn-xs" id="import-missing">＋ Import them now</button>
    </div>` : '';

  // sort by priority (high → low, unset last), then existing order; then apply the filter
  let list = tasks.slice().sort((a, b) => (prioRank(a) - prioRank(b)) || ((a.order || 0) - (b.order || 0)));
  if (allotPriorityFilter) list = list.filter((t) => (t.priority || '') === allotPriorityFilter);

  body.innerHTML = banner + `
    <div class="row gap mb" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-xs" id="expand-all">Expand all</button>
      <button class="btn btn-ghost btn-xs" id="collapse-all">Collapse all</button>
    </div>
    ${list.length ? list.map((t, ti) => `
    <div class="card mb collapsible-card ${allotCollapsed.has(t.id) ? 'collapsed' : ''}" data-task="${t.id}">
      <div class="card-head">
        <div class="row" style="gap:10px;align-items:center;min-width:0">
          <button class="btn btn-ghost btn-icon collapse-btn" data-collapse title="Collapse / expand">▾</button>
          <div class="collapse-title" data-collapse style="cursor:pointer">
            <h2><span class="serial">${ti + 1}.</span> ${esc(t.name)}${priorityTag(t, t.subtasks)}</h2>
            <span class="sub">${t.subtasks.length} sub-task(s)</span>
          </div>
          ${countChips(statusCounts(t.subtasks))}
        </div>
        <div class="row gap">
          <button class="btn btn-outline btn-xs" data-addsub>＋ Sub-task</button>
          <button class="btn btn-ghost btn-xs" data-edittask>Edit</button>
          <button class="btn btn-ghost btn-xs" data-deltask>Delete task</button>
        </div>
      </div>
      <div class="collapsible">
        <div class="table-wrap"><table class="data">
          <thead><tr><th style="width:56px">#</th><th style="width:24%">Sub-task</th><th style="width:28%">Allottee(s)</th><th style="width:130px">Due date</th><th>Status</th><th></th></tr></thead>
          <tbody>
          ${t.subtasks.length ? t.subtasks.map((s, si) => `
            <tr data-sub="${s.id}">
              <td class="serial nowrap">${ti + 1}.${si + 1}</td>
              <td>${esc(s.name)}</td>
              <td>${(s.assignees || []).map((id) => `<span class="pill ${id === state.user.id ? 'me' : ''}">${esc(userName(id))}</span>`).join('') || '<span class="faint">Unassigned</span>'}</td>
              <td class="nowrap">${s.dueDate ? fmtDate(s.dueDate) : '<span class="faint">—</span>'}</td>
              <td><span class="badge ${s.status}">${Charts.LABELS[s.status]}</span></td>
              <td class="nowrap"><button class="btn btn-outline btn-xs" data-editsub>Assign</button>
                <button class="btn btn-ghost btn-xs" data-delsub>✕</button></td>
            </tr>`).join('') : `<tr><td colspan="6" class="faint">No sub-tasks yet</td></tr>`}
          </tbody>
        </table></div>
      </div>
    </div>`).join('') : `<div class="card"><div class="empty-state" style="padding:32px"><div class="big">🔍</div><p class="muted">No <b>${esc(PRIO_LABEL[allotPriorityFilter] || '')}</b> priority tasks in ${esc(month)}.</p></div></div>`}`;

  const im = $('#import-missing', body);
  if (im) im.addEventListener('click', importMissing);

  const setCollapsed = (card, id, on) => { card.classList.toggle('collapsed', on); on ? allotCollapsed.add(id) : allotCollapsed.delete(id); };
  $('#expand-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.task, false)));
  $('#collapse-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.task, true)));

  const taskById = {}; tasks.forEach((t) => { taskById[t.id] = t; });

  $all('[data-task]', body).forEach((card) => {
    const task = taskById[card.dataset.task];
    $all('[data-collapse]', card).forEach((el) => el.addEventListener('click', () => setCollapsed(card, task.id, !card.classList.contains('collapsed'))));
    $('[data-addsub]', card).addEventListener('click', () => addSubtaskModal(task, renderAllotBody));
    $('[data-edittask]', card).addEventListener('click', () => editTaskModal(task));
    $('[data-deltask]', card).addEventListener('click', async () => {
      if (await confirmDialog(`Delete task "${task.name}" and its sub-tasks?`)) {
        await API.del(`/tasks/${task.id}`); toast('Task deleted', 'success'); renderAllotBody();
      }
    });
    $all('[data-sub]', card).forEach((row) => {
      const sub = task.subtasks.find((s) => s.id === row.dataset.sub);
      $('[data-editsub]', row).addEventListener('click', () => assignModal(task, sub, renderAllotBody));
      $('[data-delsub]', row).addEventListener('click', async () => {
        if (await confirmDialog(`Delete sub-task "${sub.name}"?`)) {
          await API.del(`/subtasks/${sub.id}`); toast('Sub-task deleted', 'success'); renderAllotBody();
        }
      });
    });
  });
}

function assigneeChips(selected) {
  return `<div class="chip-select" id="chip-select">
    ${state.users.map((u) => `<span class="chip ${selected.includes(u.id) ? 'on' : ''}" data-id="${u.id}">${esc(u.name)}<span class="x">${selected.includes(u.id) ? '✓' : '+'}</span></span>`).join('')}
  </div>`;
}
function bindChips(host) {
  $all('.chip', host).forEach((ch) => ch.addEventListener('click', () => {
    ch.classList.toggle('on');
    $('.x', ch).textContent = ch.classList.contains('on') ? '✓' : '+';
  }));
}
function selectedChips(host) {
  return $all('.chip.on', host).map((c) => c.dataset.id);
}

function assignModal(task, sub, onDone) {
  const m = openModal({
    title: 'Assign sub-task',
    body: `
      <p class="mb"><b>${esc(task.name)}</b> — ${esc(sub.name)}</p>
      <div class="field"><label>Allottee(s) — a sub-task may be given to more than one user</label>${assigneeChips(sub.assignees || [])}</div>
      <div class="field"><label>Due date</label><input type="date" class="input" id="due" value="${sub.dueDate || ''}"></div>
      <div class="field"><label>Status</label>
        <select class="input" id="st">
          <option value="pending" ${sub.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="in_progress" ${sub.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="completed" ${sub.status === 'completed' ? 'selected' : ''}>Completed</option>
        </select></div>
      <div class="field"><label>Remarks</label><textarea class="input" id="rem">${esc(sub.remarks || '')}</textarea></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button>`,
  });
  bindChips(m.host);
  $('#save', m.host).addEventListener('click', async () => {
    try {
      await API.put(`/subtasks/${sub.id}`, {
        assignees: selectedChips(m.host),
        dueDate: $('#due', m.host).value || null,
        status: $('#st', m.host).value,
        remarks: $('#rem', m.host).value,
      });
      m.close(); toast('Saved', 'success'); onDone();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function addSubtaskModal(task, onDone) {
  const m = openModal({
    title: 'Add sub-task',
    body: `
      <div class="field"><label>Sub-task name</label><input class="input" id="name" placeholder="e.g. File GSTR-3B" style="width:100%"></div>
      <div class="field"><label>Allottee(s)</label>${assigneeChips([])}</div>
      <div class="field"><label>Due date</label><input type="date" class="input" id="due"></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">Add</button>`,
  });
  bindChips(m.host);
  $('#save', m.host).addEventListener('click', async () => {
    const name = $('#name', m.host).value.trim();
    if (!name) return toast('Enter a name', 'error');
    try {
      await API.post(`/tasks/${task.id}/subtasks`, { name, assignees: selectedChips(m.host), dueDate: $('#due', m.host).value || null });
      m.close(); toast('Sub-task added', 'success'); onDone();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function addTaskModal() {
  const m = openModal({
    title: 'Add task',
    body: `<div class="field"><label>Task name</label><input class="input" id="name" placeholder="e.g. GST Compliance" style="width:100%"></div>
           <div class="field"><label>Priority (optional)</label>${prioSelectHtml('')}</div>
           <p class="faint" style="font-size:12.5px">Adds to <b>${esc(companyById(state.sel.companyId).name)}</b> · ${esc(state.sel.month)} · FY ${esc(state.fy)}</p>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">Add</button>`,
  });
  $('#save', m.host).addEventListener('click', async () => {
    const name = $('#name', m.host).value.trim();
    if (!name) return toast('Enter a name', 'error');
    try {
      await API.post('/tasks', { fy: state.fy, companyId: state.sel.companyId, month: state.sel.month, name, priority: $('#prio', m.host).value });
      m.close(); toast('Task added', 'success'); renderAllotBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function editTaskModal(task) {
  const m = openModal({
    title: 'Edit task',
    body: `<div class="field"><label>Task name</label><input class="input" id="name" value="${esc(task.name)}" style="width:100%"></div>
           <div class="field"><label>Priority</label>${prioSelectHtml(task.priority)}</div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button>`,
  });
  const input = $('#name', m.host); input.focus(); input.select();
  $('#save', m.host).addEventListener('click', async () => {
    const name = $('#name', m.host).value.trim();
    if (!name) return toast('Enter a name', 'error');
    try {
      await API.put(`/tasks/${task.id}`, { name, priority: $('#prio', m.host).value });
      m.close(); toast('Saved', 'success'); renderAllotBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function importModal() {
  const master = await API.get(`/master?companyId=${state.sel.companyId}`);
  const active = master.filter((m) => m.active);
  if (!active.length) { toast('No active master tasks for this company', 'error'); return; }
  const m = openModal({
    title: 'Import from Master list',
    size: 'lg',
    body: `
      <p class="help-note">Importing into <b>${esc(companyById(state.sel.companyId).name)}</b> · ${esc(state.sel.month)} · FY ${esc(state.fy)}. Already-imported tasks are skipped.</p>
      <label class="checkbox mb"><input type="checkbox" id="all" checked> Select all</label>
      <div id="mlist">
      ${active.map((t) => `<label class="checkbox" style="padding:6px 0"><input type="checkbox" class="mt" value="${t.id}" checked> <b>${esc(t.name)}</b> <span class="faint">(${t.subtasks.filter((s) => s.active).length} sub-tasks)</span></label>`).join('')}
      </div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="imp">Import</button>`,
  });
  $('#all', m.host).addEventListener('change', (e) => $all('.mt', m.host).forEach((c) => { c.checked = e.target.checked; }));
  $('#imp', m.host).addEventListener('click', async () => {
    const ids = $all('.mt', m.host).filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return toast('Select at least one task', 'error');
    try {
      const r = await API.post('/import', { fy: state.fy, companyId: state.sel.companyId, month: state.sel.month, taskIds: ids });
      m.close(); toast(`${r.added} task(s) imported`, 'success'); renderAllotBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function copyModal() {
  const months = MONTHS().filter((x) => x !== state.sel.month);
  const m = openModal({
    title: 'Copy from another month',
    size: 'lg',
    body: `
      <p class="help-note">Copy the selected tasks &amp; sub-tasks into <b>${esc(state.sel.month)}</b> · ${esc(companyById(state.sel.companyId).name)} · FY ${esc(state.fy)} (statuses reset to Pending).</p>
      <div class="row gap" style="align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:180px"><label>Copy from month</label>
          <select class="input" id="from" style="width:100%">${months.map((x) => `<option value="${x}">${esc(x)}</option>`).join('')}</select></div>
        <label class="checkbox" style="padding-bottom:9px"><input type="checkbox" id="keep" checked> Keep the same allottees</label>
      </div>
      <div class="divider"></div>
      <label class="checkbox mb"><input type="checkbox" id="all" checked> Select all</label>
      <div id="copytree"><div class="loading"><div class="spinner"></div></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="go">Copy</button>`,
  });

  const tree = $('#copytree', m.host);
  const allBox = $('#all', m.host);

  const syncAll = () => {
    const cts = $all('.ct', tree);
    allBox.checked = cts.length > 0 && cts.every((c) => c.checked);
  };

  const bindTree = () => {
    $all('.ct', tree).forEach((ct) => ct.addEventListener('change', () => {
      $all(`.cs[data-task="${ct.dataset.task}"]`, tree).forEach((cs) => { cs.checked = ct.checked; });
      syncAll();
    }));
    $all('.cs', tree).forEach((cs) => cs.addEventListener('change', () => {
      const subs = $all(`.cs[data-task="${cs.dataset.task}"]`, tree);
      $(`.ct[data-task="${cs.dataset.task}"]`, tree).checked = subs.some((x) => x.checked);
      syncAll();
    }));
  };

  const load = async (month) => {
    tree.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    const tasks = await API.get(`/tasks?fy=${encodeURIComponent(state.fy)}&companyId=${state.sel.companyId}&month=${encodeURIComponent(month)}`);
    if (!tasks.length) { tree.innerHTML = `<p class="faint">No tasks in ${esc(month)} to copy.</p>`; syncAll(); return; }
    tree.innerHTML = tasks.map((t) => `
      <div class="copy-task">
        <label class="checkbox"><input type="checkbox" class="ct" data-task="${t.id}" checked> <b>${esc(t.name)}</b> <span class="faint">(${t.subtasks.length} sub-task${t.subtasks.length === 1 ? '' : 's'})</span></label>
        ${t.subtasks.length ? `<div class="copy-subs">
          ${t.subtasks.map((s) => `<label class="checkbox"><input type="checkbox" class="cs" data-task="${t.id}" value="${s.id}" checked> ${esc(s.name)}${(s.assignees || []).length ? ` <span class="faint">· ${esc((s.assignees || []).map(userName).join(', '))}</span>` : ''}</label>`).join('')}
        </div>` : ''}
      </div>`).join('');
    bindTree();
    syncAll();
  };

  allBox.addEventListener('change', (e) => {
    $all('.ct', tree).forEach((c) => { c.checked = e.target.checked; });
    $all('.cs', tree).forEach((c) => { c.checked = e.target.checked; });
  });
  $('#from', m.host).addEventListener('change', (e) => load(e.target.value));
  load(months[0]);

  $('#go', m.host).addEventListener('click', async () => {
    const taskIds = $all('.ct', tree).filter((c) => c.checked).map((c) => c.dataset.task);
    const subtaskIds = $all('.cs', tree).filter((c) => c.checked).map((c) => c.value);
    if (!taskIds.length) return toast('Select at least one task or sub-task', 'error');
    try {
      const r = await API.post('/copy', {
        fy: state.fy, companyId: state.sel.companyId,
        fromMonth: $('#from', m.host).value, toMonth: state.sel.month,
        includeAssignees: $('#keep', m.host).checked,
        taskIds, subtaskIds,
      });
      m.close(); toast(`${r.copied} task(s) · ${r.copiedSubs} sub-task(s) copied`, 'success'); renderAllotBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* =====================================================================
 *  VIEW: DATA SHEET REPORT — point 13
 * ===================================================================== */
VIEWS.report = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'Data Sheet' }]);
  if (!state.sel.companyId) state.sel.companyId = (state.companies[0] || {}).id || '';
  if (!state.sel.month) state.sel.month = MONTHS()[0];

  const view = $('#view');
  view.innerHTML = `
    <div class="page-head"><div><h1>Data Sheet Report</h1><p>${isAdmin() ? 'All tasks, sub-tasks, allottees &amp; status' : 'Your tasks, sub-tasks &amp; status'}</p></div></div>
    <div class="toolbar card card-pad">
      <div class="field"><span class="lbl">Financial Year</span><span id="fy-slot"></span></div>
      <div class="field"><span class="lbl">Company</span><span id="cmp-slot"></span></div>
      <div class="field"><span class="lbl">Month</span><span id="mon-slot"></span></div>
      <div style="flex:1"></div>
      <button class="btn btn-outline" id="csv">⬇ Export CSV</button>
      <button class="btn btn-outline" id="print">🖨 Print</button>
    </div>
    <div id="report-body"></div>`;
  $('#fy-slot').appendChild(fySelect(() => navigate('report')));
  buildCompanySelect($('#cmp-slot'), () => navigate('report'), true);
  buildMonthSelect($('#mon-slot'), () => navigate('report'));
  $('#print').addEventListener('click', () => window.print());

  await renderReportBody();
};

let _reportRows = [];
async function renderReportBody() {
  const body = $('#report-body');
  body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const { companyId, month } = state.sel;
  const company = companyById(companyId);
  const tasks = await API.get(`/tasks?fy=${encodeURIComponent(state.fy)}&companyId=${companyId}&month=${encodeURIComponent(month)}`);
  const totals = countSubs(tasks, (s) => visibleSub(s));

  _reportRows = [];
  const rows = [];
  tasks.forEach((t) => {
    const subs = t.subtasks.filter(visibleSub); // non-admins only see their own
    if (!subs.length) {
      if (isAdmin()) {
        rows.push(`<tr class="task-row"><td>${esc(t.name)}${priorityTag(t, subs)}</td><td colspan="5" class="faint">No sub-tasks</td></tr>`);
        _reportRows.push([t.name, '', '', '', '', '']);
      }
      return;
    }
    subs.forEach((s, i) => {
      const allottees = (s.assignees || []).map(userName).join(', ');
      rows.push(`<tr>
        ${i === 0 ? `<td rowspan="${subs.length}"><b>${esc(t.name)}</b>${priorityTag(t, subs)}</td>` : ''}
        <td>${esc(s.name)}</td>
        <td>${allottees ? esc(allottees) : '<span class="faint">Unassigned</span>'}</td>
        <td class="nowrap">${s.dueDate ? fmtDate(s.dueDate) : '<span class="faint">—</span>'}</td>
        <td><span class="badge ${s.status}">${Charts.LABELS[s.status]}</span></td>
        <td>${s.remarks ? esc(s.remarks) : '<span class="faint">—</span>'}${s.completedDate ? `<div class="faint" style="font-size:11px">✓ ${fmtDate(s.completedDate)}</div>` : ''}</td>
      </tr>`);
      _reportRows.push([t.name, s.name, allottees, s.dueDate ? fmtDate(s.dueDate) : '', Charts.LABELS[s.status], s.remarks || '']);
    });
  });

  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="label">Total</div><div class="value">${totals.total}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${totals.completed}</div></div>
      <div class="stat progress"><div class="label">In Progress</div><div class="value">${totals.in_progress}</div></div>
      <div class="stat pending"><div class="label">Pending</div><div class="value">${totals.pending}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><div><h2>${esc(company ? company.name : '')} · ${esc(month)} · FY ${esc(state.fy)}</h2></div></div>
      ${tasks.length === 0
        ? `<div class="empty-state"><div class="big">📋</div><h3>No data for this selection</h3></div>`
        : `<div class="table-wrap"><table class="data">
            <thead><tr><th>Task</th><th>Sub-task</th><th>Allottee</th><th>Due date</th><th>Status</th><th>Remarks</th></tr></thead>
            <tbody>${rows.join('')}</tbody></table></div>`}
    </div>`;

  $('#csv').onclick = () => exportCSV(company ? company.name : 'report');
}

function exportCSV(name) {
  if (!_reportRows.length) return toast('Nothing to export', 'error');
  const header = ['Task', 'Sub-task', 'Allottee', 'Due date', 'Status', 'Remarks'];
  const lines = [header, ..._reportRows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${state.sel.month}_${state.fy}.csv`.replace(/\s+/g, '_');
  a.click();
  URL.revokeObjectURL(a.href);
}

/* =====================================================================
 *  VIEW: MASTER LIST — point 16
 * ===================================================================== */
VIEWS.master = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'Master List' }]);
  if (!state.sel.companyId) state.sel.companyId = (state.companies[0] || {}).id || '';
  const view = $('#view');
  view.innerHTML = `
    <div class="page-head"><div><h1>Master List</h1><p>Company-wise task &amp; sub-task templates · activate, deactivate or add</p></div></div>
    <div class="toolbar card card-pad">
      <div class="field"><span class="lbl">Company</span><span id="cmp-slot"></span></div>
      <div style="flex:1"></div>
      <button class="btn btn-outline" id="import-company">⇄ Import from Company</button>
      <button class="btn btn-primary" id="add">＋ Add Master Task</button>
    </div>
    <div id="master-body"></div>`;
  buildCompanySelect($('#cmp-slot'), () => navigate('master'), true);
  $('#add').addEventListener('click', () => masterTaskModal());
  $('#import-company').addEventListener('click', importFromCompanyModal);
  await renderMasterBody();
};

async function importFromCompanyModal() {
  const target = companyById(state.sel.companyId);
  const others = state.companies.filter((c) => c.id !== state.sel.companyId);
  if (!others.length) { toast('No other companies to import from', 'error'); return; }

  const m = openModal({
    title: 'Import master list from another company',
    size: 'lg',
    body: `
      <p class="help-note">Copies tasks &amp; sub-tasks into <b>${esc(target.name)}</b>'s master list. Tasks with a name that already exists here are skipped.</p>
      <div class="field"><label>Copy from company</label>
        <select class="input" id="src" style="width:100%">${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <label class="checkbox mb"><input type="checkbox" id="all" checked> Select all</label>
      <div id="src-list"><div class="loading"><div class="spinner"></div></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="imp">Import</button>`,
  });

  const listEl = $('#src-list', m.host);
  async function loadList() {
    listEl.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    const master = await API.get(`/master?companyId=${$('#src', m.host).value}`);
    if (!master.length) { listEl.innerHTML = `<p class="faint">This company has no master tasks.</p>`; return; }
    listEl.innerHTML = master.map((t) => `
      <label class="checkbox" style="padding:6px 0">
        <input type="checkbox" class="mt" value="${t.id}" checked>
        <b>${esc(t.name)}</b> <span class="faint">(${t.subtasks.length} sub-tasks)${t.active ? '' : ' · inactive'}</span>
      </label>`).join('');
    const allBox = $('#all', m.host);
    $all('.mt', m.host).forEach((c) => c.addEventListener('change', () => { allBox.checked = $all('.mt', m.host).every((x) => x.checked); }));
  }
  $('#src', m.host).addEventListener('change', loadList);
  $('#all', m.host).addEventListener('change', (e) => $all('.mt', m.host).forEach((c) => { c.checked = e.target.checked; }));
  await loadList();

  $('#imp', m.host).addEventListener('click', async () => {
    const ids = $all('.mt', m.host).filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return toast('Select at least one task', 'error');
    try {
      const r = await API.post('/master/import-company', { fromCompanyId: $('#src', m.host).value, toCompanyId: state.sel.companyId, taskIds: ids });
      m.close();
      toast(`${r.added} task(s) imported${r.skipped ? `, ${r.skipped} skipped (duplicate)` : ''}`, 'success');
      renderMasterBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

const masterCollapsed = new Set(); // remembers which master tasks are collapsed

async function renderMasterBody() {
  const body = $('#master-body');
  body.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const master = await API.get(`/master?companyId=${state.sel.companyId}`);
  if (!master.length) {
    body.innerHTML = `<div class="card"><div class="empty-state"><div class="big">🧩</div><h3>No master tasks yet</h3><p class="muted">Add a master task to build the template for this company.</p></div></div>`;
    return;
  }
  body.innerHTML = `
    <div class="row gap mb" style="justify-content:flex-end">
      <button class="btn btn-ghost btn-xs" id="expand-all">Expand all</button>
      <button class="btn btn-ghost btn-xs" id="collapse-all">Collapse all</button>
    </div>
    ${master.map((t, ti) => `
    <div class="card mb collapsible-card ${masterCollapsed.has(t.id) ? 'collapsed' : ''}" data-mt="${t.id}">
      <div class="card-head">
        <div class="row" style="gap:10px;align-items:center;min-width:0">
          <button class="btn btn-ghost btn-icon collapse-btn" data-collapse title="Collapse / expand">▾</button>
          <div class="collapse-title" data-collapse style="cursor:pointer">
            <h2><span class="serial">${ti + 1}.</span> ${esc(t.name)}${inlineMeta(t)} ${t.active ? '' : '<span class="tag-inactive">· Inactive</span>'}</h2>
            <span class="sub">${t.subtasks.length} sub-task(s)</span>
          </div>
        </div>
        <div class="row gap">
          <button class="btn btn-outline btn-xs" data-addsub>＋ Sub-task</button>
          <button class="btn btn-xs ${t.active ? 'btn-danger-outline' : 'btn-outline'}" data-toggle>${t.active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-ghost btn-xs" data-edit>Edit</button>
          <button class="btn btn-ghost btn-xs" data-del>Delete</button>
        </div>
      </div>
      <div class="collapsible">
        <div class="table-wrap"><table class="data">
          <thead><tr><th style="width:60px">#</th><th>Sub-task</th><th style="width:120px">Status</th><th style="width:240px"></th></tr></thead>
          <tbody>
          ${t.subtasks.length ? t.subtasks.map((s, si) => `
            <tr data-ms="${s.id}">
              <td class="serial nowrap">${ti + 1}.${si + 1}</td>
              <td>${esc(s.name)}${inlineMeta(s)}</td>
              <td>${s.active ? '<span class="tag-active">Active</span>' : '<span class="tag-inactive">Inactive</span>'}</td>
              <td class="nowrap">
                <button class="btn btn-xs ${s.active ? 'btn-danger-outline' : 'btn-outline'}" data-stoggle>${s.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn btn-ghost btn-xs" data-sedit>Edit</button>
                <button class="btn btn-ghost btn-xs" data-sdel>✕</button>
              </td>
            </tr>`).join('') : `<tr><td colspan="4" class="faint">No sub-tasks</td></tr>`}
          </tbody>
        </table></div>
      </div>
    </div>`).join('')}`;

  const setCollapsed = (card, id, on) => { card.classList.toggle('collapsed', on); on ? masterCollapsed.add(id) : masterCollapsed.delete(id); };

  $('#expand-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.mt, false)));
  $('#collapse-all', body).addEventListener('click', () => $all('.collapsible-card', body).forEach((c) => setCollapsed(c, c.dataset.mt, true)));

  const byId = {}; master.forEach((t) => { byId[t.id] = t; });
  $all('[data-mt]', body).forEach((card) => {
    const t = byId[card.dataset.mt];
    $all('[data-collapse]', card).forEach((el) => el.addEventListener('click', () => setCollapsed(card, t.id, !card.classList.contains('collapsed'))));
    $('[data-addsub]', card).addEventListener('click', () => masterSubModal(t));
    $('[data-toggle]', card).addEventListener('click', async () => {
      if (t.active && !(await confirmDialog(`Deactivate master task "${t.name}"? It will no longer be available to import into a month.`, { danger: true, okText: 'Deactivate' }))) return;
      await API.put(`/master/task/${t.id}`, { active: !t.active }); renderMasterBody();
    });
    $('[data-edit]', card).addEventListener('click', () => masterTaskModal(t));
    $('[data-del]', card).addEventListener('click', async () => { if (await confirmDialog(`Delete master task "${t.name}"?`)) { await API.del(`/master/task/${t.id}`); renderMasterBody(); } });
    $all('[data-ms]', card).forEach((row) => {
      const s = t.subtasks.find((x) => x.id === row.dataset.ms);
      $('[data-stoggle]', row).addEventListener('click', async () => {
        if (s.active && !(await confirmDialog(`Deactivate sub-task "${s.name}"?`, { danger: true, okText: 'Deactivate' }))) return;
        await API.put(`/master/subtask/${s.id}`, { active: !s.active }); renderMasterBody();
      });
      $('[data-sedit]', row).addEventListener('click', () => masterSubModal(t, s));
      $('[data-sdel]', row).addEventListener('click', async () => {
        if (await confirmDeleteSubtask(s.name)) { await API.del(`/master/subtask/${s.id}`); toast('Sub-task deleted', 'success'); renderMasterBody(); }
      });
    });
  });
}

function renamePrompt(title, current, onSave) {
  const m = openModal({
    title,
    body: `<div class="field"><label>Name</label><input class="input" id="v" value="${esc(current)}" style="width:100%"></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">Save</button>`,
  });
  const input = $('#v', m.host); input.focus(); input.select();
  $('#save', m.host).addEventListener('click', async () => {
    const v = input.value.trim(); if (!v) return toast('Enter a name', 'error');
    try { await onSave(v); m.close(); toast('Saved', 'success'); } catch (e) { toast(e.message, 'error'); }
  });
}

/* ---------- shared editor for instructions + multiple reference links ---------- */
function linkRowHtml(val) {
  return `<div class="row gap link-row" style="margin-bottom:6px">
    <input class="input link-input" type="url" placeholder="https://…" value="${esc(val || '')}" style="flex:1;min-width:0">
    <button type="button" class="btn btn-ghost btn-xs link-del" title="Remove">✕</button></div>`;
}
function linksEditorHtml(links) {
  const rows = (links && links.length ? links : ['']).map(linkRowHtml).join('');
  return `<div id="links-ed">${rows}</div>
    <button type="button" class="btn btn-outline btn-xs" id="add-link">＋ Add another link</button>`;
}
function bindLinksEditor(host) {
  const ed = $('#links-ed', host);
  const bindDel = () => $all('.link-del', ed).forEach((b) => {
    b.onclick = () => {
      if ($all('.link-row', ed).length > 1) b.closest('.link-row').remove();
      else b.closest('.link-row').querySelector('.link-input').value = '';
    };
  });
  $('#add-link', host).addEventListener('click', () => { ed.insertAdjacentHTML('beforeend', linkRowHtml('')); bindDel(); });
  bindDel();
}
function collectLinks(host) {
  return $all('.link-input', host).map((i) => i.value.trim()).filter(Boolean);
}

function masterTaskModal(task) {
  const editing = !!task;
  const m = openModal({
    title: editing ? 'Edit master task' : 'Add master task',
    size: 'lg',
    body: `
      <div class="field"><label>Task name</label><input class="input" id="name" value="${editing ? esc(task.name) : ''}" placeholder="e.g. GST Compliance" style="width:100%"></div>
      <div class="field"><label>Description / Instructions</label><textarea class="input" id="desc" placeholder="Instructions for the staff doing this task…">${editing ? esc(task.description || '') : ''}</textarea></div>
      <div class="field"><label>Reference links (optional — add as many as you need)</label>${linksEditorHtml(editing ? task.links : [])}</div>
      ${editing ? '' : `<p class="faint" style="font-size:12.5px">For <b>${esc(companyById(state.sel.companyId).name)}</b></p>`}`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">${editing ? 'Save' : 'Add'}</button>`,
  });
  bindLinksEditor(m.host);
  $('#name', m.host).focus();
  $('#save', m.host).addEventListener('click', async () => {
    const name = $('#name', m.host).value.trim(); if (!name) return toast('Enter a name', 'error');
    const payload = { name, description: $('#desc', m.host).value, links: collectLinks(m.host) };
    try {
      if (editing) { await API.put(`/master/task/${task.id}`, payload); toast('Saved', 'success'); }
      else { await API.post('/master/task', { companyId: state.sel.companyId, ...payload }); toast('Task added to the master list and to every month (unassigned)', 'success'); }
      m.close(); renderMasterBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function masterSubModal(task, sub) {
  const editing = !!sub;
  const m = openModal({
    title: editing ? 'Edit sub-task' : `Add sub-task to "${task.name}"`,
    size: 'lg',
    body: `
      <div class="field"><label>Sub-task name</label><input class="input" id="name" value="${editing ? esc(sub.name) : ''}" placeholder="e.g. File GSTR-1" style="width:100%"></div>
      <div class="field"><label>Description / Instructions</label><textarea class="input" id="desc" placeholder="Instructions for the staff doing this sub-task…">${editing ? esc(sub.description || '') : ''}</textarea></div>
      <div class="field"><label>Reference links (optional — add as many as you need)</label>${linksEditorHtml(editing ? sub.links : [])}</div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">${editing ? 'Save' : 'Add'}</button>`,
  });
  bindLinksEditor(m.host);
  $('#name', m.host).focus();
  $('#save', m.host).addEventListener('click', async () => {
    const name = $('#name', m.host).value.trim(); if (!name) return toast('Enter a name', 'error');
    const payload = { name, description: $('#desc', m.host).value, links: collectLinks(m.host) };
    try {
      if (editing) { await API.put(`/master/subtask/${sub.id}`, payload); toast('Saved', 'success'); }
      else { await API.post(`/master/task/${task.id}/subtask`, payload); toast('Sub-task added to every month (unassigned)', 'success'); }
      m.close(); renderMasterBody();
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* =====================================================================
 *  VIEW: COMPANIES — admin
 * ===================================================================== */
VIEWS.companies = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'Companies' }]);
  const companies = await API.get('/companies');
  state.companies = companies;
  $('#view').innerHTML = `
    <div class="page-head"><div><h1>Companies</h1><p>Client companies you do accounting for</p></div>
      <button class="btn btn-primary" id="add">＋ Add Company</button></div>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Company</th><th>Status</th><th></th></tr></thead>
      <tbody>${companies.map((c) => `<tr data-id="${c.id}">
        <td><b>${esc(c.name)}</b></td>
        <td>${c.active ? '<span class="tag-active">Active</span>' : '<span class="tag-inactive">Inactive</span>'}</td>
        <td class="nowrap">
          <button class="btn btn-outline btn-xs" data-toggle>${c.active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-ghost btn-xs" data-edit>Edit</button>
          <button class="btn btn-ghost btn-xs" data-del>Delete</button>
        </td></tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#add').addEventListener('click', () => renamePrompt('Add company', '', async (v) => { await API.post('/companies', { name: v }); await refreshCompanies(); navigate('companies'); }));
  $all('tr[data-id]').forEach((row) => {
    const c = companies.find((x) => x.id === row.dataset.id);
    $('[data-toggle]', row).addEventListener('click', async () => { await API.put(`/companies/${c.id}`, { active: !c.active }); await refreshCompanies(); navigate('companies'); });
    $('[data-edit]', row).addEventListener('click', () => renamePrompt('Edit company', c.name, async (v) => { await API.put(`/companies/${c.id}`, { name: v }); await refreshCompanies(); navigate('companies'); }));
    $('[data-del]', row).addEventListener('click', async () => { if (await confirmDialog(`Delete "${c.name}"? This removes its master list and all tasks.`)) { await API.del(`/companies/${c.id}`); await refreshCompanies(); navigate('companies'); } });
  });
};
async function refreshCompanies() { state.companies = await API.get('/companies'); }

/* =====================================================================
 *  VIEW: USERS — admin
 * ===================================================================== */
VIEWS.users = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'Users' }]);
  const users = await API.get('/users');
  $('#view').innerHTML = `
    <div class="page-head"><div><h1>Users</h1><p>One administrator and your team members (2–5 users)</p></div>
      <button class="btn btn-primary" id="add">＋ Add User</button></div>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Phone</th><th>Role</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr data-id="${u.id}">
        <td><div class="row"><span class="avatar" style="width:28px;height:28px;font-size:11px">${esc(initials(u.name))}</span><b>${esc(u.name)}</b></div></td>
        <td>${esc(u.username)}</td>
        <td>${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : '<span class="faint">—</span>'}</td>
        <td class="nowrap">${u.phone ? `<a href="tel:${esc(u.phone.replace(/\s+/g, ''))}">${esc(u.phone)}</a>` : '<span class="faint">—</span>'}</td>
        <td style="text-transform:capitalize">${esc(u.role)}</td>
        <td class="nowrap">
          <button class="btn btn-outline btn-xs" data-edit>Edit</button>
          ${u.id === state.user.id ? '' : `<button class="btn btn-ghost btn-xs" data-del>Delete</button>`}
        </td></tr>`).join('')}</tbody>
    </table></div></div>`;
  $('#add').addEventListener('click', () => userModal(null));
  $all('tr[data-id]').forEach((row) => {
    const u = users.find((x) => x.id === row.dataset.id);
    $('[data-edit]', row).addEventListener('click', () => userModal(u));
    const del = $('[data-del]', row);
    if (del) del.addEventListener('click', async () => { if (await confirmDialog(`Delete user "${u.name}"?`)) { await API.del(`/users/${u.id}`); await refreshUsers(); navigate('users'); } });
  });
};
async function refreshUsers() {
  state.users = await API.get('/users');
  state.usersById = {}; state.users.forEach((u) => { state.usersById[u.id] = u; });
}
function userModal(user) {
  const editing = !!user;
  const m = openModal({
    title: editing ? 'Edit user' : 'Add user',
    body: `
      <div class="field"><label>Full name</label><input class="input" id="name" value="${editing ? esc(user.name) : ''}" style="width:100%"></div>
      <div class="field"><label>Username</label><input class="input" id="username" value="${editing ? esc(user.username) : ''}" ${editing ? 'disabled' : ''} style="width:100%"></div>
      <div class="grid-2">
        <div class="field"><label>Email</label><input class="input" id="email" type="email" value="${editing ? esc(user.email || '') : ''}" placeholder="name@firm.com" style="width:100%"></div>
        <div class="field"><label>Phone</label><input class="input" id="phone" type="tel" value="${editing ? esc(user.phone || '') : ''}" placeholder="+91 …" style="width:100%"></div>
      </div>
      <div class="field"><label>Role</label><select class="input" id="role" style="width:100%">
        <option value="user" ${editing && user.role === 'user' ? 'selected' : ''}>User</option>
        <option value="admin" ${editing && user.role === 'admin' ? 'selected' : ''}>Administrator</option></select></div>
      <div class="field"><label>${editing ? 'Password (edit to change)' : 'Password'}</label>
        <div class="pw-wrap">
          <input class="input" id="password" type="password" value="${editing ? esc(user.passwordPlain || '') : ''}" placeholder="${editing ? '••••••' : 'set a password'}" style="width:100%">
          <button type="button" class="pw-eye" id="pw-toggle" title="Show password" aria-label="Show password">👁</button>
        </div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="save">${editing ? 'Save' : 'Create'}</button>`,
  });
  const pwInput = $('#password', m.host);
  $('#pw-toggle', m.host).addEventListener('click', (e) => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    e.currentTarget.classList.toggle('on', show);
    e.currentTarget.title = e.currentTarget.ariaLabel = show ? 'Hide password' : 'Show password';
  });
  $('#save', m.host).addEventListener('click', async () => {
    const name = $('#name', m.host).value.trim();
    const role = $('#role', m.host).value;
    const password = pwInput.value;
    const email = $('#email', m.host).value.trim();
    const phone = $('#phone', m.host).value.trim();
    if (!name) return toast('Enter a name', 'error');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email', 'error');
    try {
      if (editing) {
        await API.put(`/users/${user.id}`, { name, role, email, phone, password: password || undefined });
      } else {
        const username = $('#username', m.host).value.trim();
        if (!username || !password) return toast('Username and password required', 'error');
        await API.post('/users', { name, username, role, email, phone, password });
      }
      await refreshUsers(); m.close(); toast('Saved', 'success'); navigate('users');
    } catch (e) { toast(e.message, 'error'); }
  });
}

/* =====================================================================
 *  VIEW: USER MANAGEMENT — graph drill-down: users → companies → tasks
 * ===================================================================== */
const getAssignments = () => API.get(`/assignments?fy=${encodeURIComponent(state.fy)}`);

const wlTaskCollapsed = new Set(); // remembers collapsed tasks in the workload tables

// Render a company's assignments as one collapsible card per task.
function workloadTasksHtml(c) {
  return `<div class="wl-tasklist">${c.tasks.map((tk) => {
    const key = `${c.id}|${tk.name}`;
    return `
    <div class="card mb collapsible-card ${wlTaskCollapsed.has(key) ? 'collapsed' : ''}" data-wltask="${esc(key)}">
      <div class="card-head">
        <div class="row" style="gap:10px;align-items:center;min-width:0">
          <button class="btn btn-ghost btn-icon collapse-btn" data-collapse title="Collapse / expand">▾</button>
          <div class="collapse-title" data-collapse style="cursor:pointer">
            <h2>${esc(tk.name)}${priorityTag(tk, tk.subtasks)}</h2>
            <span class="sub">${tk.subtasks.length} sub-task(s)</span>
          </div>
          ${countChips(statusCounts(tk.subtasks))}
        </div>
      </div>
      <div class="collapsible">
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Sub-task</th><th style="width:80px">Month</th><th style="width:120px">Due</th><th style="width:120px">Status</th><th style="width:150px">Closing value</th></tr></thead>
          <tbody>
          ${tk.subtasks.map((s) => `
            <tr>
              <td>${esc(s.name)}</td>
              <td class="nowrap">${esc(s.month)}</td>
              <td class="nowrap">${s.dueDate ? fmtDate(s.dueDate) : '<span class="faint">—</span>'}</td>
              <td><span class="badge ${s.status}">${Charts.LABELS[s.status]}</span></td>
              <td class="nowrap">${s.closingValue ? esc(fmtNum(s.closingValue)) : '<span class="faint">—</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// Header row (count + expand/collapse all) above a workload task list.
function workloadTasksToolbar(c) {
  return `<div class="row gap mb" style="justify-content:space-between;align-items:center;margin-top:18px">
      <h2 style="font-size:14px;font-weight:700">🏢 ${esc(c.name)} <span class="muted" style="font-weight:500;font-size:12.5px">· ${c.taskCount} task(s) · ${c.subtaskCount} sub-task(s)</span></h2>
      <span class="row gap">
        <button class="btn btn-ghost btn-xs" id="wl-expand">Expand all</button>
        <button class="btn btn-ghost btn-xs" id="wl-collapse">Collapse all</button>
      </span>
    </div>`;
}

// Wire up per-task and expand/collapse-all toggles for a workload task list.
function bindWorkloadTasks(host) {
  const setC = (card, on) => { card.classList.toggle('collapsed', on); on ? wlTaskCollapsed.add(card.dataset.wltask) : wlTaskCollapsed.delete(card.dataset.wltask); };
  $all('[data-wltask]', host).forEach((card) => {
    $all('[data-collapse]', card).forEach((el) => el.addEventListener('click', () => setC(card, !card.classList.contains('collapsed'))));
  });
  const ex = $('#wl-expand', host); const co = $('#wl-collapse', host);
  if (ex) ex.addEventListener('click', () => $all('[data-wltask]', host).forEach((c) => setC(c, false)));
  if (co) co.addEventListener('click', () => $all('[data-wltask]', host).forEach((c) => setC(c, true)));
}

// Level 1 — all users as a status stacked bar; click a user to drill in.
VIEWS.workload = async () => {
  if (!isAdmin()) throw new Error('Admins only');
  crumbs([{ label: 'User Management' }]);
  const data = await getAssignments();
  const users = data.users.slice().sort((a, b) => (b.totals.subtasks - a.totals.subtasks) || a.name.localeCompare(b.name));

  const team = users.filter((u) => u.role === 'user').length;
  const totalSub = users.reduce((n, u) => n + u.totals.subtasks, 0);
  const totalDone = users.reduce((n, u) => n + u.totals.completed, 0);
  const compsCovered = new Set(); users.forEach((u) => u.companies.forEach((c) => compsCovered.add(c.id)));

  // only chart users who actually have assignments (avoids empty bars)
  const charted = users.filter((u) => u.totals.subtasks > 0);
  const labels = charted.map((u) => u.name);
  const series = { completed: [], in_progress: [], pending: [] };
  charted.forEach((u) => { series.completed.push(u.totals.completed); series.in_progress.push(u.totals.in_progress); series.pending.push(u.totals.pending); });

  $('#view').innerHTML = `
    <div class="page-head">
      <div><h1>User Management</h1><p>Who is working on which company &amp; task · click a user's bar to drill in</p></div>
      <div class="row" id="fy-slot"></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Team members</div><div class="value">${team}</div></div>
      <div class="stat"><div class="label">Companies covered</div><div class="value">${compsCovered.size}</div></div>
      <div class="stat"><div class="label">Sub-tasks assigned</div><div class="value">${totalSub}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${totalDone}</div></div>
    </div>
    <div class="card chart-card">
      <div class="chart-title">User-wise workload &nbsp;·&nbsp; FY ${esc(state.fy)}</div>
      ${charted.length === 0
        ? `<div class="chart-empty"><div class="big">🧭</div><div>No assignments yet for this year.<br>Use <b>Allotment</b> to assign sub-tasks to your team.</div></div>`
        : `<div class="chart-wrap"><canvas id="wl-chart"></canvas></div>
           <div class="chart-hint">Tip: click a user's bar to see their company-wise breakdown.</div>`}
    </div>`;
  $('#fy-slot').appendChild(fySelect(() => navigate('workload')));

  if (charted.length) {
    Charts.stacked($('#wl-chart'), labels, series, STATUS_ORDER, (idx) => {
      navigate('workloadUser', { userId: charted[idx].id });
    });
  }
};

// Level 2 — one user's companies as a chart; click a company for the task table.
VIEWS.workloadUser = async ({ userId }) => {
  if (!isAdmin()) throw new Error('Admins only');
  const data = await getAssignments();
  const u = data.users.find((x) => x.id === userId);
  if (!u) throw new Error('User not found');
  crumbs([
    { label: 'User Management', go: () => navigate('workload') },
    { label: u.name },
  ]);

  const comps = u.companies; // already sorted by name
  const labels = comps.map((c) => c.name);
  const series = { completed: [], in_progress: [], pending: [] };
  comps.forEach((c) => { series.completed.push(c.counts.completed); series.in_progress.push(c.counts.in_progress); series.pending.push(c.counts.pending); });
  const t = u.totals;

  $('#view').innerHTML = `
    <div class="page-head">
      <div class="row" style="gap:12px;align-items:center;min-width:0">
        <span class="avatar">${esc(initials(u.name))}</span>
        <div style="min-width:0">
          <h1>${esc(u.name)} <span class="role-badge ${u.role}">${esc(u.role)}</span></h1>
          <p>@${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''}${u.phone ? ` · ${esc(u.phone)}` : ''}</p>
        </div>
      </div>
      <div class="row"><button class="btn btn-outline btn-sm" id="back">← Back</button></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Companies</div><div class="value">${t.companies}</div></div>
      <div class="stat"><div class="label">Tasks</div><div class="value">${t.tasks}</div></div>
      <div class="stat"><div class="label">Sub-tasks</div><div class="value">${t.subtasks}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${t.completed}</div></div>
    </div>
    <div class="card chart-card">
      <div class="chart-title">${esc(u.name)} &nbsp;·&nbsp; company-wise workload</div>
      ${comps.length === 0
        ? `<div class="chart-empty"><div class="big">🗂️</div><div>No tasks assigned to ${esc(u.name)} in FY ${esc(state.fy)}.</div></div>`
        : `<div class="chart-wrap"><canvas id="wl-user-chart"></canvas></div>
           <div class="chart-hint">Tip: click a company's bar to see the tasks &amp; sub-tasks.</div>`}
    </div>`;
  $('#back').addEventListener('click', () => navigate('workload'));

  if (comps.length) {
    Charts.stacked($('#wl-user-chart'), labels, series, STATUS_ORDER, (idx) => {
      navigate('workloadCompany', { userId, companyId: comps[idx].id });
    });
  }
};

// Filtered copy of a company's assignments limited to one month (+ recomputed counts).
function filterCompanyByMonth(c, month) {
  const tasks = c.tasks
    .map((tk) => ({ ...tk, subtasks: tk.subtasks.filter((s) => s.month === month) }))
    .filter((tk) => tk.subtasks.length);
  const counts = { completed: 0, in_progress: 0, pending: 0 };
  let subtaskCount = 0;
  tasks.forEach((tk) => tk.subtasks.forEach((s) => { counts[s.status] = (counts[s.status] || 0) + 1; subtaskCount++; }));
  return { ...c, tasks, taskCount: tasks.length, subtaskCount, counts };
}

// Level 3 — month-wise distribution for one user within one company; click a month for the table.
VIEWS.workloadCompany = async ({ userId, companyId }) => {
  if (!isAdmin()) throw new Error('Admins only');
  const data = await getAssignments();
  const u = data.users.find((x) => x.id === userId);
  if (!u) throw new Error('User not found');
  const c = u.companies.find((x) => x.id === companyId);
  if (!c) throw new Error('No assignments for this company');
  crumbs([
    { label: 'User Management', go: () => navigate('workload') },
    { label: u.name, go: () => navigate('workloadUser', { userId }) },
    { label: c.name },
  ]);

  // aggregate this company's sub-tasks by month
  const byMonth = {};
  c.tasks.forEach((tk) => tk.subtasks.forEach((s) => {
    const mc = byMonth[s.month] || (byMonth[s.month] = { completed: 0, in_progress: 0, pending: 0 });
    mc[s.status] = (mc[s.status] || 0) + 1;
  }));
  const months = MONTHS().filter((m) => byMonth[m]); // financial-year order, only months with data
  const labels = months;
  const series = { completed: [], in_progress: [], pending: [] };
  months.forEach((m) => { series.completed.push(byMonth[m].completed); series.in_progress.push(byMonth[m].in_progress); series.pending.push(byMonth[m].pending); });

  $('#view').innerHTML = `
    <div class="page-head">
      <div><h1>${esc(u.name)} — ${esc(c.name)}</h1><p>Month-wise distribution · FY ${esc(state.fy)}</p></div>
      <div class="row"><button class="btn btn-outline btn-sm" id="back">← Back</button></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Months</div><div class="value">${months.length}</div></div>
      <div class="stat"><div class="label">Tasks</div><div class="value">${c.taskCount}</div></div>
      <div class="stat"><div class="label">Sub-tasks</div><div class="value">${c.subtaskCount}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${c.counts.completed}</div></div>
    </div>
    <div class="card chart-card">
      <div class="chart-title">${esc(c.name)} &nbsp;·&nbsp; month-wise workload</div>
      ${months.length === 0
        ? `<div class="chart-empty"><div class="big">🗓️</div><div>No assignments for ${esc(u.name)} in this company.</div></div>`
        : `<div class="chart-wrap"><canvas id="wl-month-chart"></canvas></div>
           <div class="chart-hint">Tip: click a month's bar to jump to that month, or browse the full year below.</div>`}
    </div>
    ${workloadTasksToolbar(c)}
    <div id="wl-tasks">${workloadTasksHtml(c)}</div>`;
  $('#back').addEventListener('click', () => navigate('workloadUser', { userId }));
  bindWorkloadTasks($('#view'));

  if (months.length) {
    Charts.stacked($('#wl-month-chart'), labels, series, STATUS_ORDER, (idx) => {
      navigate('workloadMonth', { userId, companyId, month: months[idx] });
    });
  }
};

// Level 4 — table of one user's tasks/sub-tasks within one company for one month.
VIEWS.workloadMonth = async ({ userId, companyId, month }) => {
  if (!isAdmin()) throw new Error('Admins only');
  const data = await getAssignments();
  const u = data.users.find((x) => x.id === userId);
  if (!u) throw new Error('User not found');
  const full = u.companies.find((x) => x.id === companyId);
  if (!full) throw new Error('No assignments for this company');
  const c = filterCompanyByMonth(full, month);
  crumbs([
    { label: 'User Management', go: () => navigate('workload') },
    { label: u.name, go: () => navigate('workloadUser', { userId }) },
    { label: full.name, go: () => navigate('workloadCompany', { userId, companyId }) },
    { label: month },
  ]);

  $('#view').innerHTML = `
    <div class="page-head">
      <div><h1>${esc(u.name)} — ${esc(full.name)}</h1><p>${esc(month)} · FY ${esc(state.fy)}</p></div>
      <div class="row"><button class="btn btn-outline btn-sm" id="back">← Back</button></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="label">Tasks</div><div class="value">${c.taskCount}</div></div>
      <div class="stat"><div class="label">Sub-tasks</div><div class="value">${c.subtaskCount}</div></div>
      <div class="stat completed"><div class="label">Completed</div><div class="value">${c.counts.completed}</div></div>
      <div class="stat pending"><div class="label">Pending</div><div class="value">${c.counts.pending}</div></div>
    </div>
    ${c.tasks.length ? workloadTasksToolbar(c) + `<div id="wl-tasks">${workloadTasksHtml(c)}</div>` : '<div class="card"><div class="empty-state"><div class="big">🗓️</div><h3>Nothing in ' + esc(month) + '</h3></div></div>'}`;
  $('#back').addEventListener('click', () => navigate('workloadCompany', { userId, companyId }));
  bindWorkloadTasks($('#view'));
};

/* =====================================================================
 *  INIT
 * ===================================================================== */
$('#login-form').addEventListener('submit', doLogin);
$('#logout-btn').addEventListener('click', logout);

// Browser Back/Forward: re-render the target view without pushing a new entry.
// If we run out of in-app entries, fall back to the dashboard so the app never closes.
window.addEventListener('popstate', (e) => {
  if (!state.user) return; // not logged in — let the browser do its thing
  closeHelpPopover();
  const r = e.state;
  if (r && r._root) {
    // Back from the home view hit the sentinel — bounce back so we never leave the app.
    window.history.pushState({ name: 'dashboard', params: {} }, '');
    navigate('dashboard', {}, 'none');
    return;
  }
  if (r && r.name && VIEWS[r.name]) {
    navigate(r.name, r.params || {}, 'none');
  } else {
    navigate('dashboard', {}, 'replace');
  }
});

(async function init() {
  if (API.hasToken()) {
    await boot();
  } else {
    showLogin();
  }
})();
