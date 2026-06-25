// payroll.js — Lantern Mart payroll system (Wrap&Roll-style, Australian rates)
// Staff CRUD · timesheet · pay calculation with penalty rates + super

// ════════════════════════════════════════════════════════════
// QLD PUBLIC HOLIDAYS  (update yearly)
// ════════════════════════════════════════════════════════════
const PH_QLD = [
  '2025-01-01','2025-01-27','2025-04-18','2025-04-19','2025-04-21','2025-04-25',
  '2025-05-05','2025-06-09','2025-08-13','2025-09-22','2025-10-06','2025-12-25','2025-12-26',
  '2026-01-01','2026-01-26','2026-04-03','2026-04-04','2026-04-06','2026-04-25',
  '2026-05-04','2026-06-08','2026-10-05','2026-12-25','2026-12-28'
];

// ════════════════════════════════════════════════════════════
// PAY CALCULATION
// ════════════════════════════════════════════════════════════

// Day multiplier based on date (Sat/Sun/PH) using staff's configured rates
function getDayMultiplier(dateStr, staff) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  if (PH_QLD.includes(dateStr)) return { mult: parseFloat(staff.ph_rate) || 1, label: 'PH' };
  if (dow === 6) return { mult: parseFloat(staff.sat_rate) || 1, label: 'Sat' };
  if (dow === 0) return { mult: parseFloat(staff.sun_rate) || 1, label: 'Sun' };
  return { mult: 1, label: '' };
}

// Hours between two "HH:MM" times
function calcHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return 0;
  const [h1, m1] = clockIn.split(':').map(Number);
  const [h2, m2] = clockOut.split(':').map(Number);
  if ([h1, m1, h2, m2].some(isNaN)) return 0;
  return Math.max(0, ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60);
}

// Gross pay for one shift
// rateMode: '' = use default (daily if daily_rate>0, else hourly); 'hourly' = force hourly
function calcGross(hours, staff, dayMult, rateMode) {
  const daily = parseFloat(staff.daily_rate) || 0;
  const hourly = parseFloat(staff.hourly_rate) || 0;
  if (rateMode === 'hourly' || daily === 0) {
    return hours * hourly * dayMult;
  }
  return daily * dayMult; // daily rate ignores hours
}

function fmtAUD(n) {
  if (isNaN(n) || n == null) return '$0.00';
  return '$' + parseFloat(n).toFixed(2);
}

// ════════════════════════════════════════════════════════════
// STAFF DATA  (demo: localStorage; live: Google Sheets)
// ════════════════════════════════════════════════════════════
function getStaffList() {
  return DB.get('lm_staff_full') || [];
}
function saveStaffList(list) {
  DB.set('lm_staff_full', list);
}

// Default staff record
function newStaffRecord(name, role) {
  return {
    id: 'staff_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    name: name,
    role: role || 'staff',
    store: STATE.store || 'Rockhampton',
    pin: '0000',
    hourly_rate: 0,
    daily_rate: 0,
    super_rate: 11.5,
    sat_rate: 1.25,
    sun_rate: 1.5,
    ph_rate: 2.0,
    pay_method: 'bank',
    active: true,
  };
}

// Generate a unique login email from a name (handles Vietnamese diacritics)
function genStaffEmail(name) {
  const slug = (name || 'staff').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${slug || 'staff'}.${rand}@lanternmart.local`;
}

// Is the app in live (Google Sheets) mode with a logged-in user?
function isLiveMode() {
  return typeof SHEETS !== 'undefined' && SHEETS.isConfigured() && SHEETS.user;
}

// ════════════════════════════════════════════════════════════
// STAFF TAB — list, add, edit, delete
// ════════════════════════════════════════════════════════════
async function loadStaffFull() {
  const el = document.getElementById('staff-list');
  if (!el) return;

  let list;
  if (isLiveMode()) {
    try { list = await SHEETS.getStaff(SHEETS.user.store); saveStaffList(list); }
    catch (e) { list = getStaffList(); }
  } else {
    list = getStaffList();
  }

  if (!list.length) {
    el.innerHTML = `<div class="empty">No staff yet</div>
      <div style="padding:0 12px"><button class="pb" style="margin:0;width:100%" onclick="openStaffForm()">+ Add first staff member</button></div>`;
    return;
  }
  el.innerHTML = list.map(s => {
    const initials = s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const rateStr = s.daily_rate > 0 ? `$${s.daily_rate}/day` : `$${s.hourly_rate}/h`;
    const roleColors = { staff: 'var(--blue-bg);color:var(--blue-t)', manager: 'var(--green-bg);color:var(--green-t)', admin: 'var(--amber-bg);color:var(--amber-t)' };
    return `<div class="row" onclick="openStaffForm('${s.id}')">
      <div class="av" style="background:${roleColors[s.role] || roleColors.staff}">${initials}</div>
      <div style="flex:1">
        <div class="rn">${s.name}</div>
        <div class="rs">${s.role.charAt(0).toUpperCase() + s.role.slice(1)} · ${rateStr} · Super ${s.super_rate}% · ${s.pay_method}</div>
      </div>
      <span style="color:var(--text3)">›</span>
    </div>`;
  }).join('');
}

let editingStaffId = null;

function openStaffForm(id) {
  editingStaffId = id || null;
  const s = id ? getStaffList().find(x => x.id === id) : newStaffRecord('', 'staff');
  if (!s) return;

  const setVal = (fid, val) => { const el = document.getElementById(fid); if (el) el.value = val; };
  setVal('sf-name', s.name);
  setVal('sf-role', s.role);
  setVal('sf-pin', s.pin || '');
  setVal('sf-hourly', s.hourly_rate);
  setVal('sf-daily', s.daily_rate);
  setVal('sf-super', s.super_rate);
  setVal('sf-sat', s.sat_rate);
  setVal('sf-sun', s.sun_rate);
  setVal('sf-ph', s.ph_rate);
  setVal('sf-paymethod', s.pay_method);

  document.getElementById('sf-title').textContent = id ? 'Edit staff' : 'Add staff';
  document.getElementById('sf-delete').style.display = id ? 'block' : 'none';
  document.getElementById('staff-form-modal').classList.add('on');
}

function closeStaffForm() {
  document.getElementById('staff-form-modal').classList.remove('on');
  editingStaffId = null;
}

async function saveStaffForm() {
  const get = fid => document.getElementById(fid)?.value || '';
  const getNum = fid => parseFloat(document.getElementById(fid)?.value) || 0;
  const name = get('sf-name').trim();
  if (!name) { alert('Enter staff name'); return; }
  const pin = get('sf-pin').trim();

  const fields = {
    name,
    role: get('sf-role'),
    store: STATE.store || 'Rockhampton',
    hourly_rate: getNum('sf-hourly'),
    daily_rate: getNum('sf-daily'),
    super_rate: getNum('sf-super'),
    sat_rate: getNum('sf-sat') || 1,
    sun_rate: getNum('sf-sun') || 1,
    ph_rate: getNum('sf-ph') || 1,
    pay_method: get('sf-paymethod'),
  };

  // ── LIVE MODE (Google Sheets) ──
  if (isLiveMode()) {
    if (!editingStaffId && (!pin || pin.length < 4)) { alert('Enter a 4-digit PIN for the new staff'); return; }
    if (typeof ovSpin === 'function') ovSpin('Saving staff...');
    try {
      if (!editingStaffId) {
        // CREATE — Edge Function makes the login + staff row
        await SHEETS.addStaff({ pin, ...fields });
      } else {
        // EDIT — update fields directly; reset PIN only if a new one was typed
        await SHEETS.updateStaff({ id: editingStaffId, ...fields });
        const existing = getStaffList().find(x => x.id === editingStaffId);
        if (pin && pin.length >= 4 && existing && pin !== existing.pin) {
          await SHEETS.resetPin(editingStaffId, pin);
        }
      }
      if (typeof ovHide === 'function') ovHide();
      closeStaffForm();
      await loadStaffFull();
      loadPayrollSummaryFull();
      alert('✅ Staff saved!');
    } catch (e) {
      if (typeof ovHide === 'function') ovHide();
      alert('❌ Could not save staff:\n' + e.message);
    }
    return;
  }

  // ── DEMO MODE (localStorage) ──
  const list = getStaffList();
  let s = editingStaffId ? list.find(x => x.id === editingStaffId) : newStaffRecord(name, fields.role);
  Object.assign(s, fields);
  s.pin = pin || s.pin || '0000';
  if (!editingStaffId) list.push(s);
  saveStaffList(list);
  closeStaffForm();
  await loadStaffFull();
  loadPayrollSummaryFull();
  alert('✅ Staff saved! (demo — saved on this device)');
}

async function deleteStaffConfirm() {
  if (!editingStaffId) return;
  const s = (isLiveMode() ? getStaffList() : getStaffList()).find(x => x.id === editingStaffId);
  if (!confirm(`Delete "${s?.name}"?\nThis removes their login. Timesheet history stays.`)) return;

  if (isLiveMode()) {
    if (typeof ovSpin === 'function') ovSpin('Deleting...');
    try {
      await SHEETS.deleteStaff(editingStaffId);
      if (typeof ovHide === 'function') ovHide();
      closeStaffForm();
      await loadStaffFull();
      loadPayrollSummaryFull();
    } catch (e) {
      if (typeof ovHide === 'function') ovHide();
      alert('❌ Could not delete:\n' + e.message);
    }
    return;
  }

  // demo
  saveStaffList(getStaffList().filter(x => x.id !== editingStaffId));
  closeStaffForm();
  await loadStaffFull();
  loadPayrollSummaryFull();
}

// ════════════════════════════════════════════════════════════
// TIMESHEET — demo data + weekly view
// ════════════════════════════════════════════════════════════
function getTimesheetData() {
  return DB.get('lm_timesheet_full') || {};
}
function saveTimesheetData(d) {
  DB.set('lm_timesheet_full', d);
}

// Get this week's shifts for a staff member: { 'YYYY-MM-DD': {in, out, status} }
function getStaffWeekShifts(staffId, weekStart) {
  const all = getTimesheetData();
  return (all[staffId] && all[staffId][weekStart]) || {};
}

function weekStartOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

// ════════════════════════════════════════════════════════════
// PAYROLL SUMMARY — weekly pay per staff with penalty breakdown
// ════════════════════════════════════════════════════════════
function loadPayrollSummaryFull() {
  const staff = getStaffList();
  const el = document.getElementById('payroll-list');
  if (!el) return;
  if (!staff.length) { el.innerHTML = '<div class="empty">Add staff first</div>'; return; }

  const weekStart = weekStartOf(new Date());
  let totalPay = 0, totalBank = 0, totalCash = 0, totalSuper = 0;

  const rows = staff.map(s => {
    const shifts = getStaffWeekShifts(s.id, weekStart);
    let staffPay = 0, staffHours = 0;
    const dayDetails = [];

    for (let i = 0; i < 7; i++) {
      const ds = addDays(weekStart, i);
      const shift = shifts[ds];
      if (shift && shift.in && shift.out && (shift.status === 'approved' || shift.status === 'modified')) {
        const hrs = calcHours(shift.in, shift.out);
        const dm = getDayMultiplier(ds, s);
        const gross = calcGross(hrs, s, dm.mult, shift.rateMode);
        staffPay += gross;
        staffHours += hrs;
        if (dm.label) dayDetails.push(dm.label);
      }
    }

    const superAmt = staffPay * (s.super_rate / 100);
    totalPay += staffPay;
    totalSuper += superAmt;

    // Bank/cash split
    let bank = 0, cash = 0;
    if (s.pay_method === 'cash') cash = staffPay;
    else if (s.pay_method === 'split') { bank = staffPay / 2; cash = staffPay / 2; }
    else bank = staffPay;
    totalBank += bank; totalCash += cash;

    const initials = s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const penaltyTag = dayDetails.length ? ` · ${[...new Set(dayDetails)].join('/')}` : '';
    return `<div class="row">
      <div class="av">${initials}</div>
      <div style="flex:1">
        <div class="rn">${s.name}</div>
        <div class="rs">${staffHours.toFixed(1)}h · ${s.daily_rate > 0 ? '$' + s.daily_rate + '/day' : '$' + s.hourly_rate + '/h'}${penaltyTag} · Super ${fmtAUD(superAmt)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;font-weight:600">${fmtAUD(staffPay)}</div>
        <div style="font-size:10px;color:var(--text3)">${s.pay_method === 'bank' ? 'Bank' : s.pay_method === 'cash' ? 'Cash' : 'Split'}</div>
      </div>
    </div>`;
  }).join('');

  // Summary card
  const summary = `<div style="background:var(--bg2);margin:0 12px 9px;border-radius:var(--rl);padding:10px 12px">
    <div style="display:flex;justify-content:space-between;margin-bottom:5px"><span style="font-size:11px;color:var(--text2)">Total pay (gross)</span><span style="font-size:15px;font-weight:600">${fmtAUD(totalPay)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--text2)">Bank transfer</span><span style="font-weight:500;color:var(--blue-t)">${fmtAUD(totalBank)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:3px"><span style="color:var(--text2)">Cash payment</span><span style="font-weight:500;color:var(--amber-t)">${fmtAUD(totalCash)}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:3px;padding-top:5px;border-top:0.5px solid var(--border)"><span style="color:var(--text2)">Super (separate)</span><span style="font-weight:500">${fmtAUD(totalSuper)}</span></div>
  </div>`;

  el.innerHTML = summary + rows;

  // Update dashboard payroll cash figure
  STATE.payrollCash = totalCash;
}

// ════════════════════════════════════════════════════════════
// DEMO TIMESHEET — seed some shifts so payroll shows numbers
// ════════════════════════════════════════════════════════════
function seedDemoTimesheet() {
  const staff = getStaffList();
  if (!staff.length) return;
  const existing = getTimesheetData();
  if (Object.keys(existing).length > 0) return; // already seeded

  const weekStart = weekStartOf(new Date());
  const data = {};
  staff.forEach((s, idx) => {
    data[s.id] = {};
    data[s.id][weekStart] = {};
    // Add 5 weekday shifts
    for (let i = 0; i < 5; i++) {
      const ds = addDays(weekStart, i);
      data[s.id][weekStart][ds] = {
        in: '09:00',
        out: idx === 0 ? '17:30' : '17:00',
        status: i < 4 ? 'approved' : 'pending',
        rateMode: ''
      };
    }
  });
  saveTimesheetData(data);
}
