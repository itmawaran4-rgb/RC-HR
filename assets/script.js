/**
 * HR NEXUS — script.js
 */

const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycby9rx7iUGox2BNVBOTChqIcUw5MLz1BxTdXfulQVz5jpE7uvh_T-ChKpAIiejKVAxSx/execc',
  APP_NAME: 'HR Nexus',
  SESSION_KEY: 'hr_nexus_session',
  VERSION: '1.0.0'
};

const Session = {
  set(user)    { localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user)); },
  get()        { const r = localStorage.getItem(CONFIG.SESSION_KEY); try { return r ? JSON.parse(r) : null; } catch { return null; } },
  clear()      { localStorage.removeItem(CONFIG.SESSION_KEY); },
  isLoggedIn() { return !!this.get(); },
  isAdmin()    { const u = this.get(); return u && u.role === 'admin'; }
};

const API = {
  async request(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    if (Object.keys(params).length > 0) {
      url.searchParams.set('payload', JSON.stringify(params));
    }
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow'
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    try { return JSON.parse(text); }
    catch(e) { throw new Error('Invalid server response'); }
  },

  // POST — للطلبات ذات payload كبير (صور، إلخ)
  async postRequest(action, params = {}) {
    const url = new URL(CONFIG.API_URL);
    url.searchParams.set('action', action);
    const response = await fetch(url.toString(), {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(params)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    try { return JSON.parse(text); }
    catch(e) { throw new Error('Invalid server response'); }
  },

  async login(id, password, role)   { return this.request('login', { id, password, role }); },
  async getEmployees()              { return this.request('getEmployees'); },
  async addEmployee(data)           { return this.request('addEmployee', data); },
  async updateEmployee(data)        { return this.request('updateEmployee', data); },
  async deleteEmployee(id)          { return this.request('deleteEmployee', { id }); },
  async checkIn(employeeId, name)   { return this.request('checkIn', { employeeId, name }); },
  // FIX: pass date so GAS filters by today only — prevents writing checkout to a stale open record
  async checkOut(employeeId, name, date) {
    return this.request('checkOut', { employeeId, name, date: date || new Date().toISOString().split('T')[0] });
  },
  async getAttendance(filters = {}) { return this.request('getAttendance', filters); },
  async getAnnouncements()          { return this.request('getAnnouncements'); },
  async addAnnouncement(data)       { return this.request('addAnnouncement', data); },
  async updateAnnouncement(data)    { return this.request('updateAnnouncement', data); },
  async deleteAnnouncement(id)      { return this.request('deleteAnnouncement', { id }); },
  async getSalary(employeeId = null){ return this.request('getSalary', employeeId ? { employeeId } : {}); },
  async addSalaryRecord(data)       { return this.request('addSalaryRecord', data); },
  async updateSalaryRecord(data)    { return this.request('updateSalaryRecord', data); },
  async deleteSalaryRecord(id)      { return this.request('deleteSalaryRecord', { id }); },
  async getStats()                  { return this.request('getStats'); },
  async getRequests(filters = {})   { return this.request('getRequests', filters); },
  async addRequest(data)            { return this.postRequest('addRequest', data); },
  async approveRequest(data)        { return this.request('approveRequest', data); },
  async rejectRequest(data)         { return this.request('rejectRequest', data); },
  async getLeaves(filters = {})     { return this.request('getLeaves', filters); },
  async addLeave(data)              { return this.request('addLeave', data); }
};

const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(title, message = '', type = 'info', duration = 4000) {
    this.init();
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <div>
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-body">${message}</div>` : ''}
      </div>
      <button class="toast-dismiss" onclick="this.closest('.toast').remove()">×</button>
    `;
    this.container.appendChild(toast);
    if (duration > 0) setTimeout(() => toast.remove(), duration);
  },
  success(title, msg) { this.show(title, msg, 'success'); },
  error(title, msg)   { this.show(title, msg, 'error'); },
  info(title, msg)    { this.show(title, msg, 'info'); },
  warning(title, msg) { this.show(title, msg, 'warning'); }
};

const Loader = {
  overlay: null,
  show(text = 'Loading...') {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'loading-overlay';
      this.overlay.innerHTML = `<div class="spinner"></div><div class="loading-text" id="loaderText">${text}</div>`;
      document.body.appendChild(this.overlay);
    } else {
      document.getElementById('loaderText').textContent = text;
      this.overlay.style.display = 'flex';
    }
  },
  hide() { if (this.overlay) this.overlay.style.display = 'none'; }
};

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d)) return date;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatCurrency(amount) {
  const n = parseFloat(amount) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function getInitials(name = '') {
  return name.split(' ').slice(0, 2).map(n => n[0]?.toUpperCase()).join('') || '?';
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function initSidebar() {
  const hamburger = document.getElementById('hamburger');
  const sidebar   = document.getElementById('sidebar');
  const overlay   = document.getElementById('sidebarOverlay');
  if (!hamburger || !sidebar) return;
  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  });
  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
  document.querySelectorAll('.nav-item[href]').forEach(item => {
    item.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay?.classList.remove('show');
    });
  });
}

function startClock(clockId, dateId) {
  function update() {
    const now = new Date();
    const clockEl = document.getElementById(clockId);
    const dateEl  = document.getElementById(dateId);
    if (clockEl) clockEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    if (dateEl)  dateEl.textContent  = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  update();
  setInterval(update, 1000);
}

function requireAuth(adminOnly = false) {
  const user = Session.get();
  if (!user) { window.location.href = 'index.html'; return null; }
  if (adminOnly && user.role !== 'admin') { window.location.href = 'attendance.html'; return null; }
  return user;
}

function populateSidebarUser() {
  const user = Session.get();
  if (!user) return;
  const nameEl   = document.getElementById('sidebarUserName');
  const roleEl   = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('topbarAvatar');
  if (nameEl)   nameEl.textContent   = user.name || user.id;
  if (roleEl)   roleEl.textContent   = user.role === 'admin' ? 'HR Admin' : user.department || 'Employee';
  if (avatarEl) avatarEl.textContent = getInitials(user.name || user.id);
}

function logout() {
  if (window.confirm('Are you sure you want to logout?')) {
    Session.clear();
    window.location.href = 'index.html';
  }
}

function openModal(id)  { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function closeModal(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.style.display = 'none';
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
});

function updateTopbarDate() {
  const el = document.getElementById('topbarDate');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function markActiveNav() {
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href && href === current) item.classList.add('active');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  updateTopbarDate();
  markActiveNav();
  populateSidebarUser();
  document.querySelectorAll('[data-logout]').forEach(btn => btn.addEventListener('click', logout));
});
