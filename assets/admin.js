/**
 * HR NEXUS — admin.js
 * Admin Dashboard Logic
 * Handles: Employees, Attendance, Announcements, Salary, Reports
 */

/* ══════════════════════════════════════════════
   ▌ STATE
   ══════════════════════════════════════════════ */
const AdminState = {
  employees:     [],
  attendance:    [],
  announcements: [],
  salary:        [],
  editTarget:    null,
  currentDetailEmp: null  // employee being viewed in detail tab
};

/* ══════════════════════════════════════════════
   ▌ INIT
   ══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Guard: admin only
  const user = requireAuth(true);
  if (!user) return;

  // Load initial tab (overview)
  showAdminTab('tab-overview', null);
  await loadOverview();

  // تحميل الطلبات في الخلفية وإظهار التنبيه
  loadRequestsBackground();

  // Tab navigation
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId   = btn.dataset.tab;
      const loadFn  = btn.dataset.load;
      showAdminTab(tabId, loadFn);

      // Update sidebar active
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Search / filter listeners
  document.getElementById('empSearch')?.addEventListener('input', debounce(filterEmployees, 300));
  document.getElementById('attEmpFilter')?.addEventListener('input', debounce(filterAttendance, 300));
  document.getElementById('attMonthFilter')?.addEventListener('change', filterAttendance);
  document.getElementById('attDayFilter')?.addEventListener('change', filterAttendance);
  document.getElementById('annSearch')?.addEventListener('input', debounce(filterAnnouncements, 300));
  document.getElementById('salEmpFilter')?.addEventListener('change', filterSalary);
});

/* ══════════════════════════════════════════════
   ▌ TAB SYSTEM
   ══════════════════════════════════════════════ */
function showAdminTab(tabId, loadFn) {
  document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
  const el = document.getElementById(tabId);
  if (el) el.classList.add('active');

  // Load data for the tab
  if (loadFn) {
    const loaders = {
      loadEmployees,
      loadAttendance,
      loadAnnouncements,
      loadSalary,
      loadReports,
      loadOverview,
      populateSalaryEmployeeFilter,
      loadRequests,
      loadLeaveBalance
    };
    if (loaders[loadFn]) loaders[loadFn]();
  }
}

/* ══════════════════════════════════════════════
   ▌ REPORTS / OVERVIEW
   ══════════════════════════════════════════════ */

// ── Helper: parse any date value to yyyy-MM-dd ──
function normDate(val) {
  if (!val) return '';
  const s = String(val);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 1970) {
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  }
  return '';
}

// ── Helper: parse time string or Date-based time ──
// ── Robust time parser — handles all formats GAS/Sheets can return ──
function normTime(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (!s || s === 'null' || s === 'undefined') return '';

  // Format 1: HH:mm:ss or H:mm:ss  (stored as text)
  const t1 = s.match(/(\d{1,2}:\d{2}:\d{2})/);
  if (t1) {
    const parts = t1[1].split(':');
    return parts[0].padStart(2,'0') + ':' + parts[1] + ':' + parts[2];
  }

  // Format 2: HH:mm
  const t2 = s.match(/^(\d{1,2}:\d{2})$/);
  if (t2) {
    const parts = t2[1].split(':');
    return parts[0].padStart(2,'0') + ':' + parts[1] + ':00';
  }

  // Format 3: ISO string like "1899-12-30T05:30:00.000Z" (Sheets Date serial)
  //           or full date string "Sat Dec 30 1899 08:30:00 GMT+0300"
  // — extract HH:MM:SS portion (avoid matching timezone offset HH:MM)
  const t3 = s.match(/T(\d{2}:\d{2}:\d{2})/);  // ISO format
  if (t3) return t3[1];

  // Format 4: any string containing HH:MM:SS (e.g. full Date.toString())
  const t4 = s.match(/ (\d{2}:\d{2}:\d{2}) /);
  if (t4) return t4[1];

  // Format 5: decimal fraction of day (0.354166... = 08:30:00)
  const num = parseFloat(s);
  if (!isNaN(num) && num >= 0 && num < 1) {
    const totalMins = Math.round(num * 24 * 60);
    const h = Math.floor(totalMins / 60), m = totalMins % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':00';
  }

  return '';
}

// ── Helper: time string → minutes since midnight ──
function timeToMins(t) {
  if (!t) return null;
  const norm = normTime(t);
  if (!norm) return null;
  const p = norm.split(':');
  const h = parseInt(p[0]), m = parseInt(p[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

// ── Helper: minutes → HH:mm ──
function minsToTime(m) {
  if (m === null || m === undefined || isNaN(m)) return '—';
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}

// ── Helper: duration between two time values ──
function calcDuration(checkIn, checkOut) {
  const a = timeToMins(checkIn), b = timeToMins(checkOut);
  if (a === null || b === null) return '—';
  const diff = b > a ? b - a : (b + 24*60) - a; // handle midnight crossover
  if (diff <= 0 || diff > 16*60) return '—';    // sanity: max 16h shift
  const h = Math.floor(diff/60), m = diff % 60;
  return h + 'h ' + (m > 0 ? m + 'm' : '');
}

async function loadOverview() {
  // Set current month default
  const now = new Date();
  const monthVal = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const reportMonthEl = document.getElementById('reportMonth');
  if (reportMonthEl && !reportMonthEl.value) reportMonthEl.value = monthVal;

  try {
    // Fetch employees and all attendance in parallel
    const [empRes, attRes] = await Promise.all([API.getEmployees(), API.getAttendance({})]);
    if (!empRes.success) throw new Error(empRes.message);
    if (!attRes.success) throw new Error(attRes.message);

    AdminState.employees  = empRes.data || [];
    // Normalize attendance records
    AdminState.attendance = (attRes.data || []).map(r => ({
      id:         String(r.id || r.at || r.AT || '').trim(),
      employeeId: String(r.employeeId || r.EmployeeID || '').trim(),
      name:       String(r.name || r.Name || '').trim(),
      date:       normDate(r.date || r.Date || ''),
      checkIn:    normTime(r.checkIn || r.CheckIn || ''),
      checkOut:   normTime(r.checkOut || r.CheckOut || '')
    }));

    populateSalaryEmployeeFilter();
    renderTodayAttendance();
    renderMonthlyReport();
  } catch (e) {
    console.error('loadOverview:', e);
    Toast.error('Failed to load overview', e.message);
  }
}

function renderTodayAttendance() {
  // Use local date (not UTC) to match server timezone
  const _now = new Date();
  const today = _now.getFullYear() + '-' +
    String(_now.getMonth()+1).padStart(2,'0') + '-' +
    String(_now.getDate()).padStart(2,'0');
  const tbody = document.getElementById('todayAttBody');
  if (!tbody) return;

  const todayAtt = AdminState.attendance.filter(r => r.date === today);
  const attendedIds = new Set(todayAtt.map(r => r.employeeId.toLowerCase()));

  let present = 0, absent = 0;
  const rows = AdminState.employees
    .filter(e => e.role !== 'admin')
    .map(emp => {
      const rec = todayAtt.find(r => r.employeeId.toLowerCase() === emp.id.toLowerCase()
        || r.name.toLowerCase() === emp.name.toLowerCase());
      if (rec) present++; else absent++;
      const hasIn  = rec && rec.checkIn;
      const hasOut = rec && rec.checkOut;
      const status = !rec
        ? '<span class="badge badge-muted">Absent</span>'
        : hasOut
          ? '<span class="badge badge-blue">Complete</span>'
          : '<span class="badge badge-gold">In Progress</span>';
      const duration = (hasIn && hasOut) ? calcDuration(rec.checkIn, rec.checkOut) : '—';
      // تحديد التأخر: بعد 9:15
      const inMinsToday = hasIn ? timeToMins(rec.checkIn) : null;
      const LATE_MINS   = 9 * 60 + 15; // 9:15
      const isLate      = inMinsToday !== null && inMinsToday > LATE_MINS;
      const checkInBadge = hasIn
        ? `<span class="badge" style="background:${isLate ? 'rgba(244,63,94,0.15)' : 'rgba(34,197,94,0.15)'};color:${isLate ? '#f43f5e' : '#22c55e'};font-weight:${isLate ? '700' : '400'}">${rec.checkIn}${isLate ? ' ⚠️' : ''}</span>`
        : '<span class="badge badge-muted">—</span>';
      return `<tr style="cursor:pointer${isLate ? ';background:rgba(244,63,94,0.04)' : ''}" onclick="openEmpDetail('${escapeHtml(emp.id)}')">
        <td><strong>${escapeHtml(emp.name)}</strong><br><span class="text-muted" style="font-size:12px">${escapeHtml(emp.id)}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(emp.department || '—')}</span></td>
        <td>${checkInBadge}</td>
        <td><span class="badge ${hasOut ? 'badge-blue' : 'badge-muted'}">${hasOut ? rec.checkOut : '—'}</span></td>
        <td>${duration !== '—' ? `<span class="badge badge-green" style="font-weight:700">${duration}</span>` : '<span class="badge badge-muted">—</span>'}</td>
        <td>${status}</td>
      </tr>`;
    });

  setEl('todayPresentBadge', `${present} Present`);
  setEl('todayAbsentBadge',  `${absent} Absent`);
  tbody.innerHTML = rows.length ? rows.join('') :
    `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No employees found</div></div></td></tr>`;
}

function renderMonthlyReport() {
  const monthVal = document.getElementById('reportMonth')?.value;
  if (!monthVal) return;
  const [year, month] = monthVal.split('-').map(Number);
  const tbody = document.getElementById('monthlyReportBody');
  if (!tbody) return;

  // Working days in the month (Mon–Fri)
  const daysInMonth = new Date(year, month, 0).getDate();
  let workDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month-1, d).getDay();
    if (day !== 5) workDays++; // Only Friday is weekend
  }

  const rows = AdminState.employees
    .filter(e => e.role !== 'admin')
    .map(emp => {
      const recs = AdminState.attendance.filter(r => {
        const d = r.date;
        if (!d) return false;
        const [y,m] = d.split('-').map(Number);
        const empMatch = r.employeeId.toLowerCase() === emp.id.toLowerCase()
          || r.name.toLowerCase() === emp.name.toLowerCase();
        return empMatch && y === year && m === month;
      });

      const daysPresent = recs.length;
      const inMins  = recs.map(r => timeToMins(r.checkIn)).filter(v => v !== null);
      const outMins = recs.map(r => timeToMins(r.checkOut)).filter(v => v !== null);
      const avgIn  = inMins.length  ? Math.round(inMins.reduce((a,b)=>a+b,0)  / inMins.length)  : null;
      const avgOut = outMins.length ? Math.round(outMins.reduce((a,b)=>a+b,0) / outMins.length) : null;

      // Average hours per worked day
      const durations = recs
        .filter(r => r.checkIn && r.checkOut)
        .map(r => { const a = timeToMins(r.checkIn), b = timeToMins(r.checkOut); return (a!==null&&b!==null&&b>a) ? b-a : null; })
        .filter(v => v !== null);
      const avgDurMins = durations.length ? Math.round(durations.reduce((a,b)=>a+b,0) / durations.length) : null;
      const avgDurStr  = avgDurMins !== null ? `${Math.floor(avgDurMins/60)}h ${avgDurMins%60}m` : '—';
      const totalMins  = durations.reduce((a,b)=>a+b,0);
      const totalStr   = totalMins > 0 ? `${Math.floor(totalMins/60)}h ${totalMins%60}m` : '—';

      return `<tr style="cursor:pointer" onclick="openEmpDetail('${escapeHtml(emp.id)}')">
        <td><strong>${escapeHtml(emp.name)}</strong><br><span class="text-muted" style="font-size:12px">${escapeHtml(emp.id)}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(emp.department||'—')}</span></td>
        <td><span class="badge ${daysPresent>0?'badge-green':'badge-muted'}">${daysPresent} / ${workDays} days</span></td>
        <td>${avgIn  !== null ? minsToTime(avgIn)  : '—'}</td>
        <td>${avgOut !== null ? minsToTime(avgOut) : '—'}</td>
        <td>${avgDurMins !== null
          ? `<span class="badge badge-green" style="font-weight:700">${avgDurStr}</span><br><span class="text-muted" style="font-size:11px">Total: ${totalStr}</span>`
          : '<span class="badge badge-muted">—</span>'}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEmpDetail('${escapeHtml(emp.id)}')">🔍 View</button></td>
      </tr>`;
    });

  tbody.innerHTML = rows.length ? rows.join('') :
    `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No data</div></div></td></tr>`;
}

function openEmpDetail(empId) {
  const emp = AdminState.employees.find(e => e.id === empId);
  if (!emp) return;
  AdminState.currentDetailEmp = emp;

  // Set current month
  const now = new Date();
  const monthVal = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const detailMonthEl = document.getElementById('detailMonth');
  if (detailMonthEl) detailMonthEl.value = monthVal;

  setEl('detailEmpName', escapeHtml(emp.name));
  setEl('detailEmpInfo', `${escapeHtml(emp.department||'—')} • ${escapeHtml(emp.position||'—')} • ID: ${escapeHtml(emp.id)}`);

  switchAdminTab('tab-emp-detail', null, emp.name);
  renderEmpDetail();
}

function renderEmpDetail() {
  const emp = AdminState.currentDetailEmp;
  if (!emp) return;

  const monthVal = document.getElementById('detailMonth')?.value;
  if (!monthVal) return;
  const [year, month] = monthVal.split('-').map(Number);

  // Get all records for this employee this month
  const recs = AdminState.attendance.filter(r => {
    if (!r.date) return false;
    const [y,m] = r.date.split('-').map(Number);
    return (r.employeeId.toLowerCase() === emp.id.toLowerCase()
      || r.name.toLowerCase() === emp.name.toLowerCase())
      && y === year && m === month;
  });

  // Build full calendar for the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let daysPresent = 0, daysAbsent = 0;
  const inMins = [], outMins = [];
  const detailRows = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(year, month-1, d).getDay();
    const dayName = dayNames[dow];
    const isWeekend = dow === 5; // Only Friday is weekend
    const rec = recs.find(r => r.date === dateStr);

    if (rec) {
      daysPresent++;
      if (timeToMins(rec.checkIn)  !== null) inMins.push(timeToMins(rec.checkIn));
      if (timeToMins(rec.checkOut) !== null) outMins.push(timeToMins(rec.checkOut));
    } else if (!isWeekend) {
      // Only count weekday absences
      const isPast = new Date(dateStr) < new Date(new Date().toDateString());
      if (isPast) daysAbsent++;
    }

    const status = rec
      ? (rec.checkOut ? '<span class="badge badge-green">Complete</span>'
                      : '<span class="badge badge-gold">In Progress</span>')
      : isWeekend
        ? '<span class="badge badge-muted">Weekend</span>'
        : new Date(dateStr) > new Date(new Date().toDateString())
          ? '<span class="badge badge-muted">Upcoming</span>'
          : '<span class="badge badge-muted">Absent</span>';

    const rowStyle = isWeekend ? 'opacity:0.4' : '';
    const recId = rec?.id || '';
    detailRows.push(`<tr style="${rowStyle}">
      <td class="bold">${dateStr}</td>
      <td>${dayName}</td>
      <td><span class="badge badge-green">${rec?.checkIn  || '—'}</span></td>
      <td><span class="badge badge-blue">${rec?.checkOut || '—'}</span></td>
      <td>${rec ? calcDuration(rec.checkIn, rec.checkOut) : '—'}</td>
      <td>${status}</td>
      <td>
        ${!isWeekend ? `<button class="btn btn-ghost btn-sm btn-icon" title="${rec ? 'Edit' : 'Add'}"
          onclick="openAttEdit('${escapeHtml(emp.id)}','${escapeHtml(emp.name)}','${dateStr}','${recId}','${rec?.checkIn||''}','${rec?.checkOut||''}')"
          >${rec ? '✏️' : '➕'}</button>` : ''}
      </td>
    </tr>`);
  }

  const avgIn  = inMins.length  ? Math.round(inMins.reduce((a,b)=>a+b,0)  / inMins.length)  : null;
  const avgOut = outMins.length ? Math.round(outMins.reduce((a,b)=>a+b,0) / outMins.length) : null;

  setEl('detailDaysPresent', daysPresent);
  setEl('detailDaysAbsent',  daysAbsent);
  setEl('detailAvgIn',  avgIn  !== null ? minsToTime(avgIn)  : '—');
  setEl('detailAvgOut', avgOut !== null ? minsToTime(avgOut) : '—');
  setEl('detailTableBody', detailRows.join(''));
}

async function loadReports() {
  // Legacy — redirect to loadOverview
  await loadOverview();
}

/* ══════════════════════════════════════════════
   ▌ EMPLOYEES — CRUD
   ══════════════════════════════════════════════ */
async function loadEmployees() {
  setEl('empTableBody', `<tr><td colspan="8" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading employees...</td></tr>`);
  try {
    const res = await API.getEmployees();
    if (res.success) {
      AdminState.employees = res.data || [];
      renderEmployeeTable(AdminState.employees);
      populateSalaryEmployeeFilter();
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    console.error('loadEmployees:', e);
    setEl('empTableBody', `<tr><td colspan="8" class="loading-rows text-red">Failed to load employees</td></tr>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderEmployeeTable(data) {
  if (!data.length) {
    setEl('empTableBody', `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No employees found</div></div></td></tr>`);
    return;
  }
  setEl('empTableBody', data.map(emp => `
    <tr>
      <td class="bold">${escapeHtml(emp.id)}</td>
      <td class="bold">${escapeHtml(emp.name)}</td>
      <td><span class="badge badge-blue">${escapeHtml(emp.department)}</span></td>
      <td>${escapeHtml(emp.position)}</td>
      <td>${escapeHtml(emp.phone || '—')}</td>
      <td>${escapeHtml(emp.email || '—')}</td>
      <td>${formatDate(emp.hireDate)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditEmployee('${escapeHtml(emp.id)}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteEmployee('${escapeHtml(emp.id)}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>
  `).join(''));
}

function filterEmployees() {
  const q = document.getElementById('empSearch')?.value.toLowerCase() || '';
  const filtered = AdminState.employees.filter(e =>
    e.id?.toLowerCase().includes(q) ||
    e.name?.toLowerCase().includes(q) ||
    e.department?.toLowerCase().includes(q) ||
    e.position?.toLowerCase().includes(q)
  );
  renderEmployeeTable(filtered);
}

// Open ADD modal
function openAddEmployee() {
  AdminState.editTarget = null;
  document.getElementById('empModalTitle').textContent = 'Add New Employee';
  document.getElementById('empForm').reset();
  document.getElementById('empId').readOnly = false;
  openModal('empModal');
}

// Open EDIT modal
function openEditEmployee(id) {
  const emp = AdminState.employees.find(e => e.id === id);
  if (!emp) return;
  AdminState.editTarget = emp;
  document.getElementById('empModalTitle').textContent = 'Edit Employee';
  document.getElementById('empId').value         = emp.id;
  document.getElementById('empId').readOnly       = true;
  document.getElementById('empName').value        = emp.name;
  document.getElementById('empDepartment').value  = emp.department;
  document.getElementById('empPosition').value    = emp.position;
  document.getElementById('empPhone').value       = emp.phone;
  document.getElementById('empEmail').value       = emp.email;
  document.getElementById('empHireDate').value    = emp.hireDate;
  document.getElementById('empPassword').value    = emp.password || '';
  openModal('empModal');
}

// SAVE employee (add or edit)
async function saveEmployee() {
  const data = {
    id:         document.getElementById('empId').value.trim(),
    name:       document.getElementById('empName').value.trim(),
    department: document.getElementById('empDepartment').value.trim(),
    position:   document.getElementById('empPosition').value.trim(),
    phone:      document.getElementById('empPhone').value.trim(),
    email:      document.getElementById('empEmail').value.trim(),
    hireDate:   document.getElementById('empHireDate').value,
    password:   document.getElementById('empPassword').value.trim()
  };

  if (!data.id || !data.name || !data.department) {
    Toast.warning('Validation', 'ID, Name, and Department are required.');
    return;
  }

  const saveBtn = document.getElementById('empSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const isEdit = !!AdminState.editTarget;
    const res = isEdit ? await API.updateEmployee(data) : await API.addEmployee(data);
    if (res.success) {
      Toast.success(isEdit ? 'Employee Updated' : 'Employee Added', `${data.name} has been saved.`);
      closeModal('empModal');
      loadEmployees();
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    Toast.error('Save Failed', e.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save Employee';
  }
}

// DELETE employee
async function deleteEmployee(id) {
  const emp = AdminState.employees.find(e => e.id === id);
  if (!window.confirm(`Delete employee "${emp?.name || id}"? This cannot be undone.`)) return;

  try {
    Loader.show('Deleting...');
    const res = await API.deleteEmployee(id);
    if (res.success) {
      Toast.success('Employee Deleted', `${emp?.name} has been removed.`);
      loadEmployees();
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    Toast.error('Delete Failed', e.message);
  } finally {
    Loader.hide();
  }
}

/* ══════════════════════════════════════════════
   ▌ ATTENDANCE
   ══════════════════════════════════════════════ */
async function loadAttendance() {
  setEl('attTableBody', `<tr><td colspan="5" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading attendance...</td></tr>`);
  try {
    const res = await API.getAttendance();
    if (res.success) {
      AdminState.attendance = res.data || [];
      renderAttendanceTable(AdminState.attendance);
    } else throw new Error(res.message);
  } catch (e) {
    setEl('attTableBody', `<tr><td colspan="5" class="loading-rows text-red">Failed to load</td></tr>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderAttendanceTable(data) {
  if (!data.length) {
    setEl('attTableBody', `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No attendance records</div></div></td></tr>`);
    return;
  }

  // Sort newest first
  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  setEl('attTableBody', sorted.map(r => {
    const hasCheckout = r.checkOut && r.checkOut !== '—';
    return `
      <tr>
        <td class="bold">${escapeHtml(r.employeeId)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${formatDate(r.date)}</td>
        <td><span class="badge badge-green">${escapeHtml(r.checkIn || '—')}</span></td>
        <td>${hasCheckout ? `<span class="badge badge-blue">${escapeHtml(r.checkOut)}</span>` : '<span class="badge badge-muted">Pending</span>'}</td>
      </tr>
    `;
  }).join(''));
}

function onAttMonthChange() {
  const month = document.getElementById('attMonthFilter')?.value || '';
  const daySel = document.getElementById('attDayFilter');
  if (!daySel) return;

  daySel.innerHTML = '<option value="">All Days</option>';

  if (month) {
    const [year, mon] = month.split('-').map(Number);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr  = String(d).padStart(2, '0');
      const dateObj = new Date(year, mon - 1, d);
      const dayName = dayNames[dateObj.getDay()];
      const opt = document.createElement('option');
      opt.value = `${month}-${dayStr}`;
      opt.textContent = `${dayStr} — ${dayName}`;
      daySel.appendChild(opt);
    }
  }

  filterAttendance();
}

function clearAttFilters() {
  document.getElementById('attEmpFilter').value   = '';
  document.getElementById('attMonthFilter').value = '';
  document.getElementById('attDayFilter').innerHTML = '<option value="">All Days</option>';
  filterAttendance();
}

function getAttFiltered() {
  const empId = document.getElementById('attEmpFilter')?.value.toLowerCase() || '';
  const month = document.getElementById('attMonthFilter')?.value || '';
  const day   = parseInt(document.getElementById('attDayFilter')?.value) || 0;

  return AdminState.attendance.filter(r => {
    const matchEmp   = !empId  || r.employeeId?.toLowerCase().includes(empId) || r.name?.toLowerCase().includes(empId);
    const matchMonth = !month  || (r.date && r.date.startsWith(month));
    const matchDay   = !day    || parseInt((r.date || '').split('-')[2]) === day;
    return matchEmp && matchMonth && matchDay;
  });
}

function filterAttendance() {
  renderAttendanceTable(getAttFiltered());
}

function exportAttendanceExcel() {
  let data = [...getAttFiltered()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.employeeId || '').localeCompare(b.employeeId || '');
  });

  if (!data.length) {
    Toast.warning('No Data', 'No attendance records match the current filter.');
    return;
  }

  const month = document.getElementById('attMonthFilter')?.value || '';
  const day   = document.getElementById('attDayFilter')?.value   || '';

  const headers = ['Employee ID', 'Employee Name', 'Date', 'Day', 'Check-In', 'Check-Out', 'Duration'];
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const rows = data.map(r => {
    const d = new Date(r.date);
    const dayName = !isNaN(d) ? dayNames[d.getDay()] : '—';
    return [
      r.employeeId || '',
      r.name || '',
      r.date || '',
      dayName,
      r.checkIn  || '—',
      r.checkOut || '—',
      calcDuration(r.checkIn, r.checkOut)
    ];
  });

  const label    = month ? (day ? `${month}-${day}` : month) : 'All';
  const filename = `Attendance_${label}_${new Date().toISOString().split('T')[0]}.xlsx`;

  if (window.XLSX) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 13 },
      { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }
    ];
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
    XLSX.writeFile(wb, filename);
    Toast.success('Exported ✅', `${data.length} records → ${filename}`);
  } else {
    const csv = '\uFEFF' + [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })),
      download: filename.replace('.xlsx', '.csv')
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    Toast.success('Exported ✅', `${data.length} records saved as CSV`);
  }
}

/* ══════════════════════════════════════════════
   ▌ ANNOUNCEMENTS — CRUD
   ══════════════════════════════════════════════ */
async function loadAnnouncements() {
  setEl('annList', `<div class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div> Loading...</div>`);
  try {
    const res = await API.getAnnouncements();
    if (res.success) {
      AdminState.announcements = res.data || [];
      renderAnnouncementList(AdminState.announcements);
    } else throw new Error(res.message);
  } catch (e) {
    setEl('annList', `<div class="loading-rows text-red">Failed to load announcements</div>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderAnnouncementList(data) {
  if (!data.length) {
    setEl('annList', `<div class="empty-state"><div class="empty-icon">📢</div><div class="empty-title">No announcements yet</div></div>`);
    return;
  }
  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  setEl('annList', sorted.map(ann => `
    <div class="announcement-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <div class="announcement-title">${escapeHtml(ann.title)}</div>
          <div class="announcement-body">${escapeHtml(ann.message)}</div>
          <div class="announcement-meta">📅 ${formatDate(ann.date)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditAnnouncement('${escapeHtml(ann.id || ann.title)}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteAnnouncement('${escapeHtml(ann.id || ann.title)}')" title="Delete">🗑️</button>
        </div>
      </div>
    </div>
  `).join(''));
}

function filterAnnouncements() {
  const q = document.getElementById('annSearch')?.value.toLowerCase() || '';
  const filtered = AdminState.announcements.filter(a =>
    a.title?.toLowerCase().includes(q) || a.message?.toLowerCase().includes(q)
  );
  renderAnnouncementList(filtered);
}

function openAddAnnouncement() {
  AdminState.editTarget = null;
  document.getElementById('annModalTitle').textContent = 'New Announcement';
  document.getElementById('annForm').reset();
  document.getElementById('annDate').value = new Date().toISOString().split('T')[0];
  openModal('annModal');
}

function openEditAnnouncement(id) {
  const ann = AdminState.announcements.find(a => (a.id || a.title) === id);
  if (!ann) return;
  AdminState.editTarget = ann;
  document.getElementById('annModalTitle').textContent = 'Edit Announcement';
  document.getElementById('annTitle').value   = ann.title;
  document.getElementById('annMessage').value = ann.message;
  document.getElementById('annDate').value    = ann.date;
  openModal('annModal');
}

async function saveAnnouncement() {
  const data = {
    id:      AdminState.editTarget?.id || null,
    title:   document.getElementById('annTitle').value.trim(),
    message: document.getElementById('annMessage').value.trim(),
    date:    document.getElementById('annDate').value
  };

  if (!data.title || !data.message) {
    Toast.warning('Validation', 'Title and message are required.');
    return;
  }

  const btn = document.getElementById('annSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const isEdit = !!AdminState.editTarget;
    const res = isEdit ? await API.updateAnnouncement(data) : await API.addAnnouncement(data);
    if (res.success) {
      Toast.success(isEdit ? 'Announcement Updated' : 'Announcement Added');
      closeModal('annModal');
      loadAnnouncements();
    } else throw new Error(res.message);
  } catch (e) {
    Toast.error('Save Failed', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function deleteAnnouncement(id) {
  if (!window.confirm('Delete this announcement?')) return;
  try {
    Loader.show('Deleting...');
    const res = await API.deleteAnnouncement(id);
    if (res.success) { Toast.success('Deleted'); loadAnnouncements(); }
    else throw new Error(res.message);
  } catch (e) {
    Toast.error('Delete Failed', e.message);
  } finally {
    Loader.hide();
  }
}

/* ══════════════════════════════════════════════
   ▌ SALARY / BONUSES & DEDUCTIONS — CRUD
   ══════════════════════════════════════════════ */
async function loadSalary() {
  setEl('salTableBody', `<tr><td colspan="7" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading...</td></tr>`);
  try {
    const res = await API.getSalary();
    if (res.success) {
      AdminState.salary = res.data || [];
      renderSalaryTable(AdminState.salary);
    } else throw new Error(res.message);
  } catch (e) {
    setEl('salTableBody', `<tr><td colspan="7" class="loading-rows text-red">Failed to load</td></tr>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderSalaryTable(data) {
  if (!data.length) {
    setEl('salTableBody', `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">No salary records</div></div></td></tr>`);
    return;
  }
  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  setEl('salTableBody', sorted.map(r => `
    <tr>
      <td class="bold">${escapeHtml(r.employeeId)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="text-green font-bold">+${formatCurrency(r.bonus)}</td>
      <td class="text-red font-bold">-${formatCurrency(r.deduction)}</td>
      <td>${escapeHtml(r.notes || '—')}</td>
      <td>${formatDate(r.date)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditSalary('${escapeHtml(r.id)}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteSalary('${escapeHtml(r.id)}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>
  `).join(''));
}

function filterSalary() {
  const empId = document.getElementById('salEmpFilter')?.value.toLowerCase() || '';
  const filtered = !empId ? AdminState.salary
    : AdminState.salary.filter(r => r.employeeId?.toLowerCase() === empId || r.name?.toLowerCase().includes(empId));
  renderSalaryTable(filtered);
}

function populateSalaryEmployeeFilter() {
  const sel = document.getElementById('salEmpFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Employees</option>' +
    AdminState.employees.map(e =>
      `<option value="${escapeHtml(e.id.toLowerCase())}">${escapeHtml(e.name)} (${escapeHtml(e.id)})</option>`
    ).join('');
  sel.value = current;

  // Also populate salary form employee select
  const formSel = document.getElementById('salEmployeeId');
  if (formSel) {
    formSel.innerHTML = '<option value="">Select Employee</option>' +
      AdminState.employees.map(e =>
        `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} — ${escapeHtml(e.id)}</option>`
      ).join('');
  }
}

function openAddSalary() {
  AdminState.editTarget = null;
  document.getElementById('salModalTitle').textContent = 'Add Bonus / Deduction';
  document.getElementById('salForm').reset();
  document.getElementById('salDate').value = new Date().toISOString().split('T')[0];
  openModal('salModal');
}

function openEditSalary(id) {
  const r = AdminState.salary.find(s => s.id == id);
  if (!r) return;
  AdminState.editTarget = r;
  document.getElementById('salModalTitle').textContent = 'Edit Record';
  document.getElementById('salEmployeeId').value = r.employeeId;
  document.getElementById('salBonus').value      = r.bonus;
  document.getElementById('salDeduction').value  = r.deduction;
  document.getElementById('salNotes').value      = r.notes;
  document.getElementById('salDate').value       = r.date;
  openModal('salModal');
}

async function saveSalary() {
  const employeeSelect = document.getElementById('salEmployeeId');
  const selectedId = employeeSelect?.value;
  const selectedEmp = AdminState.employees.find(e => e.id === selectedId);

  const data = {
    id:          AdminState.editTarget?.id || null,
    employeeId:  selectedId,
    name:        selectedEmp?.name || '',
    bonus:       parseFloat(document.getElementById('salBonus').value) || 0,
    deduction:   parseFloat(document.getElementById('salDeduction').value) || 0,
    notes:       document.getElementById('salNotes').value.trim(),
    date:        document.getElementById('salDate').value
  };

  if (!data.employeeId) {
    Toast.warning('Validation', 'Please select an employee.');
    return;
  }

  const btn = document.getElementById('salSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const isEdit = !!AdminState.editTarget;
    const res = isEdit ? await API.updateSalaryRecord(data) : await API.addSalaryRecord(data);
    if (res.success) {
      Toast.success(isEdit ? 'Record Updated' : 'Record Added');
      closeModal('salModal');
      loadSalary();
    } else throw new Error(res.message);
  } catch (e) {
    Toast.error('Save Failed', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function deleteSalary(id) {
  if (!window.confirm('Delete this salary record?')) return;
  try {
    Loader.show('Deleting...');
    const res = await API.deleteSalaryRecord(id);
    if (res.success) { Toast.success('Deleted'); loadSalary(); }
    else throw new Error(res.message);
  } catch (e) {
    Toast.error('Delete Failed', e.message);
  } finally {
    Loader.hide();
  }
}


/* ══════════════════════════════════════════════
   ▌ REQUESTS
   ══════════════════════════════════════════════ */
let allRequests = [];
let currentReqFilter = 'all';

// تحميل الطلبات في الخلفية عند فتح الصفحة
function showPendingAlert(count) {
  const existing = document.getElementById('pendingAlertOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pendingAlertOverlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:rgba(0,0,0,0.55); backdrop-filter:blur(4px);
    display:flex; align-items:center; justify-content:center;
  `;

  overlay.innerHTML = `
    <div style="
      background:var(--bg-card);
      border:1px solid var(--border-color);
      border-top:4px solid var(--gold-500);
      border-radius:16px;
      padding:32px 36px;
      min-width:320px; max-width:440px; width:90%;
      box-shadow:0 24px 60px rgba(0,0,0,0.5);
      position:relative;
      text-align:center;
      animation:pendingAlertIn .25s ease;
    ">
      <button onclick="document.getElementById('pendingAlertOverlay').remove()" style="
        position:absolute; top:12px; right:14px;
        background:none; border:none; cursor:pointer;
        color:var(--text-muted); font-size:20px; line-height:1;
        padding:4px 8px; border-radius:6px;
        transition:background .15s, color .15s;
      " onmouseover="this.style.background='rgba(255,255,255,0.08)';this.style.color='var(--text-primary)'"
         onmouseout="this.style.background='none';this.style.color='var(--text-muted)'">✕</button>

      <div style="font-size:48px; margin-bottom:16px; line-height:1;">📋</div>
      <div style="font-size:20px; font-weight:700; color:var(--text-primary); margin-bottom:8px;">
        Pending Requests
      </div>
      <div style="
        font-size:42px; font-weight:800;
        color:var(--gold-500); margin:12px 0;
        text-shadow:0 0 20px rgba(245,158,11,0.4);
      ">${count}</div>
      <div style="font-size:14px; color:var(--text-muted); margin-bottom:24px;">
        ${count > 1 ? `There are ${count} requests waiting for your review.` : `There is 1 request waiting for your review.`}
      </div>
      <button id="pendingAlertReviewBtn" style="
        background:var(--gold-500); color:#000;
        border:none; border-radius:8px;
        padding:10px 28px; font-size:14px; font-weight:700;
        cursor:pointer; transition:opacity .15s;
      " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        Review Now →
      </button>
    </div>
    <style>
      @keyframes pendingAlertIn {
        from { opacity:0; transform:scale(.92) translateY(-12px); }
        to   { opacity:1; transform:scale(1)   translateY(0); }
      }
    </style>
  `;

  document.body.appendChild(overlay);

  document.getElementById('pendingAlertReviewBtn').addEventListener('click', () => {
    overlay.remove();
    showAdminTab('tab-requests', 'loadRequests');
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="tab-requests"]')?.classList.add('active');
  });
}

async function loadRequestsBackground() {
  try {
    const res = await API.getRequests({});
    if (!res.success) return;
    const all     = res.data || [];
    const pending = all.filter(r => r.status === 'pending');

    // تحديث badge رقم الطلبات
    const badge = document.getElementById('pendingRequestsBadge');
    if (badge) badge.textContent = pending.length > 0 ? pending.length : '';

    // إشعار مركزي للطلبات المعلقة
    if (pending.length > 0) {
      setTimeout(() => showPendingAlert(pending.length), 1200);
    }

    // حفظ البيانات لاستخدامها عند فتح التاب
    allRequests = all.sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.date) - new Date(a.date);
    });
  } catch(e) { /* صامت */ }
}

async function loadRequests() {
  const listEl = document.getElementById('requestsList');
  if (!listEl) return;

  // إذا البيانات محملة مسبقاً من الخلفية، اعرضها فوراً
  if (allRequests.length > 0) {
    renderRequests();
  }

  listEl.innerHTML = '<div class="loading-rows"><div class="spinner" style="margin:0 auto 12px"></div>Loading...</div>';

  try {
    const res = await API.getRequests({});
    if (!res.success) throw new Error(res.message);

    allRequests = (res.data || []).sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.date) - new Date(a.date);
    });

    const pending = allRequests.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('pendingRequestsBadge');
    if (badge) badge.textContent = pending > 0 ? pending : '';

    renderRequests();
  } catch (e) {
    const listEl2 = document.getElementById('requestsList');
    if (listEl2) listEl2.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Failed</div><div class="empty-desc">' + e.message + '</div></div>';
  }
}

function filterRequestsTab(filter) {
  currentReqFilter = filter;
  ['all','leave','outside'].forEach(f => {
    const el = document.getElementById('reqTab' + f.charAt(0).toUpperCase() + f.slice(1));
    if (el) el.classList.toggle('active', f === filter);
  });
  renderRequests();
}

function renderRequests() {
  const listEl = document.getElementById('requestsList');
  if (!listEl) return;

  let filtered = allRequests;
  if (currentReqFilter === 'leave')   filtered = allRequests.filter(r => String(r.type||'').startsWith('leave'));
  if (currentReqFilter === 'outside') filtered = allRequests.filter(r => String(r.type||'').includes('outside'));

  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No requests</div></div>';
    return;
  }

  const typeLabel = t => {
    if (!t) return '—';
    if (t.includes('annual'))    return '🌴 Annual Leave';
    if (t.includes('sick'))      return '🏥 Sick Leave';
    if (t.includes('emergency')) return '🚨 Emergency Leave';
    if (t.includes('outside'))   return '📍 Outside Office';
    if (t.includes('leave'))     return '🌴 Leave';
    return t;
  };
  const statusBadge = s => {
    if (s === 'approved') return '<span class="badge badge-green">✅ Approved</span>';
    if (s === 'rejected') return '<span class="badge badge-muted" style="background:#f43f5e20;color:#f43f5e">❌ Rejected</span>';
    return '<span class="badge badge-gold">⏳ Pending</span>';
  };

  listEl.innerHTML = filtered.map(r => {
    const rid = String(r.id || r.at || r.AT || '').trim();
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch(e) {}
    const isPending   = r.status === 'pending';
    const borderColor = isPending ? 'var(--gold-500)' : (r.status === 'approved' ? '#22c55e' : '#f43f5e');
    const photoSrc    = extra.photoBase64 || extra.photoUrl || '';

    const photoHtml = photoSrc ? `
      <div class="req-photo-wrap">
        <img src="${photoSrc}"
          class="req-photo-thumb"
          onclick="openPhotoLightbox(this.src)"
          title="Click to enlarge"
          onerror="this.closest('.req-photo-wrap').innerHTML='<div style=\\'font-size:13px;color:var(--text-muted);padding:8px\\'>📷 وێنەکە بەردەست نیە</div>'">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;text-align:center">📷 کلیک بکە بۆ گەورەکردن</div>
      </div>` : '';

    return `<div class="card req-card" style="margin-bottom:12px;border-right:4px solid ${borderColor}">
      <div class="req-inner">
        <div class="req-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
            <div>
              <div style="font-weight:700;font-size:15px">${escapeHtml(r.name||'—')}</div>
              <div style="color:var(--text-muted);font-size:13px">${escapeHtml(r.employeeId||'')} · ${r.date||''}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${statusBadge(r.status)}
              <span class="badge badge-blue">${typeLabel(r.type)}</span>
            </div>
          </div>
          <div style="color:var(--text-secondary);font-size:14px;margin-bottom:10px">${escapeHtml(r.message||'—')}</div>
          ${extra.note ? `<div style="font-size:13px;background:rgba(245,158,11,0.08);padding:8px 12px;border-radius:6px;margin-bottom:10px;color:var(--text-primary)">📝 ${escapeHtml(extra.note)}</div>` : ''}
          ${extra.requestTime && String(r.type||'').includes('outside') ? `<div style="font-size:13px;background:rgba(59,130,246,0.08);padding:8px 12px;border-radius:6px;margin-bottom:10px;color:#3b82f6">🕐 ${extra.action === 'checkout' ? 'وقت الخروج' : 'وقت الدخول'}: <strong>${extra.requestTime}</strong> — ${r.date||''}</div>` : ''}
          ${isPending && rid && String(r.type||'').startsWith('leave') ? (() => {
            const isHourly = (extra.leaveType || '') === 'hourly';
            const defDays  = extra.days  !== undefined ? extra.days  : '';
            const defHours = extra.hours !== undefined ? extra.hours
              : (extra.timeFrom && extra.timeTo ? (() => {
                  const [h1,m1]=(extra.timeFrom||'00:00').split(':').map(Number);
                  const [h2,m2]=(extra.timeTo  ||'00:00').split(':').map(Number);
                  return Math.max(0,((h2*60+m2)-(h1*60+m1))/60).toFixed(2);
                })() : '');
            return `<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:10px 12px;margin-bottom:10px">
              <div style="font-size:12px;color:var(--gold-500);margin-bottom:8px;font-weight:600">✏️ Edit duration before approving (8h = 1 day)</div>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:4px">
                  Days
                  <input type="number" id="ovDays_${rid}" value="${defDays}" min="0" step="0.5"
                    style="width:80px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:13px">
                </label>
                <label style="font-size:12px;color:var(--text-muted);display:flex;flex-direction:column;gap:4px">
                  Hours
                  <input type="number" id="ovHours_${rid}" value="${defHours}" min="0" step="0.5"
                    style="width:80px;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-secondary);color:var(--text-primary);font-size:13px">
                </label>
              </div>
            </div>`;
          })() : ''}
          ${isPending && rid ? `
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-primary btn-sm" onclick="doApproveReq('${rid}')">✅ Approve</button>
            <button class="btn btn-danger btn-sm" onclick="doRejectReq('${rid}')">❌ Reject</button>
          </div>` : (isPending ? '<div style="color:red;font-size:12px">⚠️ Missing request ID</div>' : '')}
        </div>
        ${photoHtml}
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════
   ▌ ATTENDANCE EDIT / ADD (Admin)
   ══════════════════════════════════════════════ */
let _attEditState = {};

function openAttEdit(empId, empName, date, recId, checkIn, checkOut) {
  _attEditState = { empId, empName, date, recId };
  const isEdit = !!recId;
  document.getElementById('attEditTitle').textContent = isEdit ? 'Edit Attendance' : 'Add Attendance';
  document.getElementById('attEditMeta').textContent  = `${empName} (${empId}) — ${date}`;

  // time inputs need HH:MM format (trim seconds)
  const toHHMM = t => t ? t.substring(0, 5) : '';
  document.getElementById('attEditIn').value  = toHHMM(checkIn);
  document.getElementById('attEditOut').value = toHHMM(checkOut);
  openModal('attEditModal');
}

async function saveAttEdit() {
  const btn  = document.getElementById('attEditSaveBtn');
  const inV  = document.getElementById('attEditIn').value.trim();
  const outV = document.getElementById('attEditOut').value.trim();
  const { empId, empName, date, recId } = _attEditState;

  if (!inV && !outV) {
    Toast.warning('Validation', 'Enter at least Check-In or Check-Out time.');
    return;
  }

  // Convert HH:MM → HH:MM:00
  const toHMS = t => t ? t + ':00' : '';

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';
  try {
    let res;
    if (recId) {
      // Update existing record
      res = await API.request('updateAttendance', {
        id: recId,
        checkIn:  toHMS(inV),
        checkOut: toHMS(outV)
      });
    } else {
      // Add new record
      res = await API.request('addAttendance', {
        employeeId: empId,
        name:       empName,
        date,
        checkIn:  toHMS(inV),
        checkOut: toHMS(outV)
      });
    }
    if (!res.success) throw new Error(res.message);
    Toast.success('Saved ✅', `Attendance updated for ${empName}`);
    closeModal('attEditModal');

    // Refresh data
    const [empRes, attRes] = await Promise.all([API.getEmployees(), API.getAttendance({})]);
    if (attRes.success) {
      AdminState.attendance = (attRes.data || []).map(r => ({
        id:         String(r.id || r.at || r.AT || '').trim(),
        employeeId: String(r.employeeId || r.EmployeeID || '').trim(),
        name:       String(r.name || r.Name || '').trim(),
        date:       normDate(r.date || r.Date || ''),
        checkIn:    normTime(r.checkIn || r.CheckIn || ''),
        checkOut:   normTime(r.checkOut || r.CheckOut || '')
      }));
    }
    renderEmpDetail();
    renderTodayAttendance();
  } catch(e) {
    Toast.error('Save Failed', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 Save';
  }
}

function openPhotoLightbox(src) {
  const lb = document.getElementById('photoLightbox');
  const img = document.getElementById('lightboxImg');
  if (!lb || !img) return;
  img.src = src;
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closePhotoLightbox() {
  const lb = document.getElementById('photoLightbox');
  if (lb) lb.style.display = 'none';
  document.body.style.overflow = '';
}

async function doApproveReq(id) {
  if (!id) { Toast.error('Error', 'Missing request ID'); return; }
  if (!window.confirm('Approve this request?')) return;

  // Read override duration if fields exist (leave requests)
  const daysEl  = document.getElementById('ovDays_'  + id);
  const hoursEl = document.getElementById('ovHours_' + id);
  const payload = { id };
  if (daysEl  && daysEl.value  !== '') payload.overrideDays  = parseFloat(daysEl.value)  || 0;
  if (hoursEl && hoursEl.value !== '') payload.overrideHours = parseFloat(hoursEl.value) || 0;

  try {
    Loader.show('Approving...');
    const res = await API.approveRequest(payload);
    if (res.success) { Toast.success('Approved ✅'); await loadRequests(); }
    else throw new Error(res.message || JSON.stringify(res));
  } catch (e) {
    Toast.error('Failed', e.message);
    console.error('approveRequest error:', e);
  } finally { Loader.hide(); }
}

async function doRejectReq(id) {
  if (!id) { Toast.error('Error', 'Missing request ID'); return; }
  if (!window.confirm('Reject this request?')) return;
  try {
    Loader.show('Rejecting...');
    const res = await API.rejectRequest({ id });
    if (res.success) { Toast.warning('Rejected ❌'); await loadRequests(); }
    else throw new Error(res.message || JSON.stringify(res));
  } catch (e) {
    Toast.error('Failed', e.message);
    console.error('rejectRequest error:', e);
  } finally { Loader.hide(); }
}

/* ══════════════════════════════════════════════
   ▌ LEAVE BALANCE (Admin)
   ══════════════════════════════════════════════ */
async function loadLeaveBalance() {
  const tbody = document.getElementById('leaveBalanceBody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading...</td></tr>`;
  try {
    const [empRes, lvRes] = await Promise.all([API.getEmployees(), API.getLeaves({})]);
    if (!empRes.success) throw new Error(empRes.message);
    if (!lvRes.success)  throw new Error(lvRes.message);

    const employees = (empRes.data || []).filter(e => e.role !== 'admin');
    const leaves    = lvRes.data || [];

    if (!employees.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🌴</div><div class="empty-title">No employees</div></div></td></tr>`;
      return;
    }

    tbody.innerHTML = employees.map(emp => {
      const empLeaves = leaves.filter(l =>
        String(l.employeeId || '').toLowerCase() === String(emp.id || '').toLowerCase()
      );
      const annualDays  = empLeaves.filter(l => l.leaveType === 'annual').reduce((s,l) => s + (parseFloat(l.days)||0), 0);
      const sickDays    = empLeaves.filter(l => l.leaveType === 'sick').reduce((s,l)   => s + (parseFloat(l.days)||0), 0);
      const hourlyHours = empLeaves.filter(l => l.leaveType === 'hourly').reduce((s,l) => s + (parseFloat(l.hours)||0), 0);
      const totalDays   = empLeaves.reduce((s,l) => s + (parseFloat(l.days)||0), 0);
      const totalHours  = empLeaves.reduce((s,l) => s + (parseFloat(l.hours)||0), 0);

      const fmt = n => n > 0 ? `<strong>${n.toFixed(1).replace('.0','')}</strong>` : '<span style="color:var(--text-muted)">—</span>';
      return `<tr style="cursor:pointer" onclick="showLeaveDetail('${escapeHtml(emp.id)}','${escapeHtml(emp.name)}')">
        <td><strong style="color:var(--gold-500)">${escapeHtml(emp.name)}</strong><br><span class="text-muted" style="font-size:12px">${escapeHtml(emp.id)}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(emp.department||'—')}</span></td>
        <td>${fmt(annualDays)}</td>
        <td>${fmt(sickDays)}</td>
        <td>${fmt(hourlyHours)}</td>
        <td><span class="badge badge-gold">${totalDays > 0 ? totalDays.toFixed(1).replace('.0','') + ' days' : '—'}</span></td>
        <td><span class="badge badge-blue">${totalHours > 0 ? totalHours.toFixed(1).replace('.0','') + ' hrs' : '—'}</span></td>
      </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-rows text-red">${e.message}</td></tr>`;
    Toast.error('Failed', e.message);
  }
}

async function showLeaveDetail(empId, empName) {
  const modal  = document.getElementById('leaveDetailModal');
  const title  = document.getElementById('leaveDetailTitle');
  const body   = document.getElementById('leaveDetailBody');
  if (!modal) return;
  title.textContent = `🌴 ${empName} — Leave Records`;
  body.innerHTML = `<div class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading...</div>`;
  openModal('leaveDetailModal');

  try {
    const res = await API.getLeaves({ employeeId: empId });
    if (!res.success) throw new Error(res.message);
    const records = (res.data || []).sort((a,b) => new Date(b.date) - new Date(a.date));
    if (!records.length) {
      body.innerHTML = `<div class="empty-state"><div class="empty-icon">🌴</div><div class="empty-title">No leave records</div></div>`;
      return;
    }
    const typeLabel = t => ({ annual:'🌴 Annual', sick:'🏥 Sick', hourly:'⏰ Hourly' }[t] || t);
    body.innerHTML = `<table style="width:100%">
      <thead><tr>
        <th>Date</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Hours</th>
      </tr></thead>
      <tbody>
        ${records.map(r => `<tr>
          <td style="font-size:13px">${r.date||'—'}</td>
          <td>${typeLabel(r.leaveType)}</td>
          <td>${r.from||'—'}</td>
          <td>${r.to||r.from||'—'}</td>
          <td>${r.days > 0 ? `<span class="badge badge-gold">${(+r.days).toFixed(1).replace('.0','')}</span>` : '—'}</td>
          <td>${r.hours > 0 ? `<span class="badge badge-blue">${(+r.hours).toFixed(1).replace('.0','')}h</span>` : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  } catch(e) {
    body.innerHTML = `<div class="loading-rows text-red">${e.message}</div>`;
  }
}

function openAddLeave() {
  // Populate employee select
  const sel = document.getElementById('addLeaveEmpId');
  sel.innerHTML = '<option value="">Select Employee</option>' +
    AdminState.employees
      .filter(e => e.role !== 'admin')
      .map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} (${escapeHtml(e.id)})</option>`)
      .join('');

  // Default dates to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('addLeaveFrom').value  = today;
  document.getElementById('addLeaveTo').value    = today;
  document.getElementById('addLeaveDays').value  = '';
  document.getElementById('addLeaveHours').value = '';
  document.getElementById('addLeaveNotes').value = '';
  openModal('addLeaveModal');
}

async function saveManualLeave() {
  const empId = document.getElementById('addLeaveEmpId').value.trim();
  const type  = document.getElementById('addLeaveType').value;
  const from  = document.getElementById('addLeaveFrom').value;
  const to    = document.getElementById('addLeaveTo').value || from;
  let days    = parseFloat(document.getElementById('addLeaveDays').value)  || 0;
  let hours   = parseFloat(document.getElementById('addLeaveHours').value) || 0;
  const notes = document.getElementById('addLeaveNotes').value.trim();

  if (!empId) { Toast.warning('Validation', 'Please select an employee.'); return; }
  if (!from)  { Toast.warning('Validation', 'From date is required.'); return; }
  if (!days && !hours) { Toast.warning('Validation', 'Enter Days or Hours.'); return; }

  // Auto-calculate missing field
  if (days && !hours) hours = days * 8;
  if (hours && !days) days  = hours / 8;

  const emp  = AdminState.employees.find(e => e.id === empId);
  const name = emp ? emp.name : empId;
  const btn  = document.getElementById('addLeaveSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const res = await API.request('addLeave', {
      employeeId: empId,
      name,
      leaveType: type,
      days,
      hours,
      from,
      to,
      notes
    });
    if (!res.success) throw new Error(res.message);
    Toast.success('Saved ✅', `Leave added for ${name}`);
    closeModal('addLeaveModal');
    loadLeaveBalance();
  } catch(e) {
    Toast.error('Save Failed', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 Save';
  }
}


function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
