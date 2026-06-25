// app.js — Lantern Mart main application logic

// ── STATE ────────────────────────────────────────────────────
const STATE = {
  pin: '',
  store: '',
  currentTab: 'scan',
  drawerOpen: false,
  dateType: 'bb',
  loadProductId: null,
  syncInProgress: false,
};

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 10000);
  loadDemoDataIfEmpty();
  if (typeof SHEETS !== 'undefined') SHEETS.restoreSession();
  showScreen('login');
});

// ── CLOCK ────────────────────────────────────────────────────
function updateClock() {
  const n = new Date();
  const el = document.getElementById('clk');
  if (el) el.textContent = n.getHours() + ':' + String(n.getMinutes()).padStart(2, '0');
}

// ── SCREENS ──────────────────────────────────────────────────
function showScreen(name) {
  ['login', 'namepick', 'pin', 'app'].forEach(s => {
    const e = document.getElementById('s-' + s);
    if (e) e.style.display = 'none';
  });
  const t = document.getElementById('s-' + name);
  if (t) t.style.display = 'flex';
}

// Also update logout to clear the Sheets session
async function doLogout() {
  if (typeof SHEETS !== 'undefined' && SHEETS.user) { try { SHEETS.logout(); } catch (e) {} }
  STATE.selectedStaff = null;
  STATE.pin = '';
  showScreen('login');
}

// ── PIN ──────────────────────────────────────────────────────
function goPin(store) {
  STATE.store = store;
  STATE.pin = '';
  STATE.selectedStaff = null;
  // Live mode: show staff name picker first. Demo: straight to PIN.
  if (typeof SHEETS !== 'undefined' && SHEETS.isConfigured()) {
    showNamePicker(store);
  } else {
    document.getElementById('pin-store').textContent = store;
    document.getElementById('pin-err').textContent = '';
    updatePinDots();
    showScreen('pin');
  }
}

async function showNamePicker(store) {
  showScreen('namepick');
  document.getElementById('np-store').textContent = store;
  const listEl = document.getElementById('np-list');
  listEl.innerHTML = '<div class="empty">Loading staff...</div>';
  try {
    const staff = await SHEETS.getStaff(store);
    if (!staff.length) {
      listEl.innerHTML = '<div class="empty">No staff for this store yet.<br>Add staff in Settings (admin).</div>';
      return;
    }
    const roleColors = { staff: 'var(--blue-bg);color:var(--blue-t)', manager: 'var(--green-bg);color:var(--green-t)', admin: 'var(--amber-bg);color:var(--amber-t)' };
    listEl.innerHTML = staff.map(s => {
      const initials = s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      return `<button class="store-btn" onclick='pickStaff(${JSON.stringify(s).replace(/'/g, "&#39;")})'>
        <div class="store-icon" style="background:${roleColors[s.role] || roleColors.staff}">${initials}</div>
        <div><div style="font-weight:600;font-size:14px">${s.name}</div><div style="font-size:11px;color:var(--text2)">${s.role.charAt(0).toUpperCase() + s.role.slice(1)}</div></div>
        <div style="margin-left:auto;color:var(--text3);font-size:18px">›</div>
      </button>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<div class="empty">Could not load staff:<br>' + e.message + '</div>';
  }
}

function pickStaff(staff) {
  STATE.selectedStaff = staff;
  STATE.pin = '';
  document.getElementById('pin-store').textContent = STATE.store + ' · ' + staff.name;
  document.getElementById('pin-err').textContent = '';
  updatePinDots();
  showScreen('pin');
}

function addPin(n) {
  if (STATE.pin.length >= 4) return;
  STATE.pin += n;
  updatePinDots();
  if (STATE.pin.length === 4) {
    // ── LIVE MODE: authenticate against Google Sheets ──
    if (STATE.selectedStaff && typeof SHEETS !== 'undefined' && SHEETS.isConfigured()) {
      const pin = STATE.pin;
      if (typeof ovSpin === 'function') ovSpin('Signing in...');
      SHEETS.login(STATE.selectedStaff.name, pin).then(() => {
        if (typeof ovHide === 'function') ovHide();
        STATE.pin = ''; updatePinDots();
        enterApp();
      }).catch(() => {
        if (typeof ovHide === 'function') ovHide();
        document.getElementById('pin-err').textContent = 'Wrong PIN. Try again.';
        STATE.pin = ''; updatePinDots();
      });
      return;
    }
    // ── DEMO MODE: check local PIN ──
    const settings = DB.getSettings();
    const correctPin = settings.pin || '1234';
    if (STATE.pin === correctPin) {
      setTimeout(() => { STATE.pin = ''; updatePinDots(); enterApp(); }, 200);
    } else {
      setTimeout(() => {
        document.getElementById('pin-err').textContent = 'Wrong PIN. Try again.';
        STATE.pin = '';
        updatePinDots();
      }, 300);
    }
  }
}

function deletePin() { STATE.pin = STATE.pin.slice(0, -1); document.getElementById('pin-err').textContent = ''; updatePinDots(); }
function clearPin() { STATE.pin = ''; document.getElementById('pin-err').textContent = ''; updatePinDots(); }
function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('pd' + i);
    if (d) d.className = 'pin-dot' + (i < STATE.pin.length ? ' filled' : '');
  }
}

function enterApp() {
  const settings = DB.getSettings();
  const user = (SHEETS.user && SHEETS.user.name) || settings.user || 'Staff';
  // In demo mode (no Sheets URL), default role = admin so all tabs visible for testing.
  // In live mode, role comes from the authenticated staff record.
  const role = (SHEETS.user && SHEETS.user.role) || 'admin';
  document.getElementById('scan-store').textContent = STATE.store;
  document.getElementById('dh-store').textContent = STATE.store;
  document.getElementById('dh-user').textContent = user;
  applyRoleGating(role);
  showScreen('app');
  switchTab('scan');
  loadSyncMeta();
  checkLowStock();
  loadInventoryOverview();
}

// ── DRAWER ───────────────────────────────────────────────────
function toggleDrawer() { STATE.drawerOpen ? closeDrawer() : openDrawer(); }

function openDrawer() {
  STATE.drawerOpen = true;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  const btn = document.getElementById('menu-btn');
  btn.textContent = '‹';
  btn.style.transition = 'left .25s ease';
  btn.style.left = '240px';
}

function closeDrawer() {
  STATE.drawerOpen = false;
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  const btn = document.getElementById('menu-btn');
  btn.style.transition = 'left .25s ease';
  btn.style.left = '0';
  btn.textContent = '›';
}

// ── TABS ─────────────────────────────────────────────────────
const TABS = ['scan', 'inventory', 'order', 'cashflow', 'dashboard', 'payroll', 'sync', 'export', 'settings'];

function switchTab(name) {
  TABS.forEach(t => {
    const e = document.getElementById('t-' + t);
    if (e) e.style.display = t === name ? 'flex' : 'none';
    const ni = document.getElementById('ni-' + t);
    if (ni) ni.classList.toggle('active', t === name);
  });
  // Reset sub-panels
  const resets = {
    inventory: () => invSeg('overview'),
    order: () => ordSeg('orders'),
    cashflow: () => cfSeg('today'),
    dashboard: () => dashSeg('weekly'),
    payroll: () => paySeg('timesheet'),
  };
  resets[name]?.();
  STATE.currentTab = name;
  closeDrawer();

  // Load tab-specific data
  if (name === 'cashflow') loadCashflowToday();
  if (name === 'dashboard') loadDashboard();
  if (name === 'sync') loadSyncMeta();
  if (name === 'inventory') loadInventoryOverview();
}

// ── SEGMENTS ─────────────────────────────────────────────────
function invSeg(n) { toggleSeg('ip', 'is', ['overview','alerts','shelves','load'], n); if(n==='alerts') loadAlerts(); }
function ordSeg(n) { toggleSeg('op', 'os', ['orders','wishlist','suggest'], n); if(n==='suggest') loadSuggested(); if(n==='wishlist') loadWishlist(); }
function cfSeg(n) { toggleSeg('cp', 'cs', ['today','eod','history'], n); if(n==='today') loadCashflowToday(); if(n==='history') loadCashflowHistory(); }
function dashSeg(n) { toggleSeg('dp', 'ds', ['weekly','alerts'], n); }
function paySeg(n) { toggleSeg('pp', 'ps', ['timesheet','payroll','staff'], n); if(n==='staff') loadStaffFull(); if(n==='payroll') loadPayrollSummaryFull(); }

function toggleSeg(panelPfx, btnPfx, panels, active) {
  panels.forEach(p => {
    const panel = document.getElementById(panelPfx + '-' + p);
    const btn = document.getElementById(btnPfx + '-' + p);
    if (panel) panel.classList.toggle('active', p === active);
    if (btn) btn.classList.toggle('active', p === active);
  });
}

// ── SEARCH ───────────────────────────────────────────────────
function doSearch(q, ctx) {
  const clr = document.getElementById(ctx + '-clr');
  if (clr) clr.style.display = q ? 'inline' : 'none';
  if (!q || q.length < 1) { clearResults(ctx); return; }
  const results = DB.searchProducts(q);
  renderResults(results, ctx);
}

function clearSearch(ctx) {
  const inp = document.getElementById(ctx + '-q');
  if (inp) inp.value = '';
  const clr = document.getElementById(ctx + '-clr');
  if (clr) clr.style.display = 'none';
  clearResults(ctx);
}

function clearResults(ctx) {
  const map = {
    scan: ['scan-res', 'scan-prod'],
    inv: ['inv-sr'],
    load: ['load-sr'],
    wish: ['wish-sr'],
  };
  (map[ctx] || []).forEach(id => {
    const e = document.getElementById(id);
    if (e) { e.innerHTML = ''; if (id === 'scan-res' || id === 'scan-prod') e.style.display = 'none'; }
  });
  if (ctx === 'scan') document.getElementById('scan-empty').style.display = 'block';
}

function renderResults(products, ctx) {
  if (ctx === 'scan') {
    document.getElementById('scan-empty').style.display = 'none';
    document.getElementById('scan-prod').style.display = 'none';
    const el = document.getElementById('scan-res');
    el.style.display = 'block';
    if (products.length === 1) { showProduct(products[0].id, 'scan'); return; }
    el.innerHTML = products.length
      ? products.map(p => rowHTML(p, `showProduct('${p.id}','scan')`)).join('')
      : '<div class="empty">No products found</div>';
    return;
  }
  const ids = { inv: 'inv-sr', load: 'load-sr', wish: 'wish-sr' };
  const el = document.getElementById(ids[ctx]);
  if (!el) return;
  const clickFn = ctx === 'load' ? id => `selectLoad('${id}')` : id => `showProduct('${id}','${ctx}')`;
  el.innerHTML = products.length
    ? `<div class="result-count">${products.length} result${products.length > 1 ? 's' : ''}</div>` +
      products.map(p => rowHTML(p, clickFn(p.id))).join('')
    : '<div class="empty">No products found</div>';
}

function rowHTML(p, onclick) {
  return `<div class="row" onclick="${onclick}">
    <div style="flex:1">
      <div class="rn">${p.name}${p.variant ? ` <span class="var-label">· ${p.variant}</span>` : ''}</div>
      <div class="rs">SKU: ${p.sku}${p.supplier ? ' · ' + p.supplier : ''}${p.supplier_code ? ' · ' + p.supplier_code : ''}</div>
    </div>
    <span style="font-size:12px;font-weight:600;color:var(--text2)">$${(p.retail_price || 0).toFixed(2)}</span>
  </div>`;
}

// ── FAKE SCAN (demo) ──────────────────────────────────────────
const DEMO_SKUS = ['8851952140281', '8994800100021', '8850987654321', '3333678901234', '9556001234567', '1234567890123'];

function fakeScan(ctx) {
  const products = DB.getProducts();
  let p = null;
  if (products.length > 0) {
    p = products[Math.floor(Math.random() * Math.min(products.length, 20))];
  }
  if (!p) { alert('No products loaded yet. Please sync first.'); return; }

  if (ctx === 'scan') {
    document.getElementById('scan-q').value = p.name;
    doSearch(p.name, 'scan');
    setTimeout(() => showProduct(p.id, 'scan'), 300);
  } else if (ctx === 'inv') {
    document.getElementById('inv-q').value = p.name;
    doSearch(p.name, 'inv');
  } else if (ctx === 'load') {
    selectLoad(p.id);
  } else if (ctx === 'wish') {
    document.getElementById('wish-q').value = p.name;
    doSearch(p.name, 'wish');
  }
}

// ── BB/EXPIRY LOGIC ───────────────────────────────────────────
function getBatchStatus(batch) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(batch.date);
  if (batch.date_type === 'expiry') {
    return d < today ? { cls: 'b-exp', label: 'Expired' } : { cls: 'b-ok', label: 'Exp: ' + fmtDate(batch.date) };
  }
  const diff = Math.floor((d - today) / 86400000);
  if (diff < 0) return Math.abs(diff) > 180 ? { cls: 'b-exp', label: 'Expired' } : { cls: 'b-bb', label: 'BB passed' };
  if (diff <= 7) return { cls: 'b-exp', label: `BB: ${fmtDate(batch.date)} (${diff}d)` };
  if (diff <= 30) return { cls: 'b-warn', label: `BB: ${fmtDate(batch.date)} (${diff}d)` };
  return { cls: 'b-ok', label: 'BB: ' + fmtDate(batch.date) };
}

function fmtDate(s) {
  const d = new Date(s);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayISO() { return new Date().toISOString().split('T')[0]; }
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

// ── PRODUCT CARD ──────────────────────────────────────────────
function showProduct(id, ctx) {
  const p = DB.getProductById(id);
  if (!p) return;
  const batches = DB.getBatchesByProduct(id);
  const margin = p.retail_price > 0 ? ((p.retail_price - p.supply_price) / p.retail_price * 100).toFixed(1) : 0;
  const markup = p.supply_price > 0 ? ((p.retail_price - p.supply_price) / p.supply_price * 100).toFixed(1) : 0;
  const totalBatchQty = batches.reduce((s, b) => s + (b.quantity || 0), 0);

  const batchHTML = batches.length
    ? `<div class="batch-hd">Batches — ${batches.length} · ${totalBatchQty} units</div>` +
      batches.map(b => {
        const st = getBatchStatus(b);
        return `<div class="bi">
          <span class="bl">${b.location}</span>
          <span style="font-size:11px;color:var(--text2);flex:1">${b.quantity} units</span>
          <span class="badge ${st.cls}">${st.label}</span>
        </div>`;
      }).join('')
    : '<div style="font-size:11px;color:var(--text3);padding:3px 0">No batches loaded yet</div>';

  const html = `<div class="pc">
    <div style="font-size:14px;font-weight:700">${p.name}${p.variant ? ` <span class="var-label">· ${p.variant}</span>` : ''}</div>
    <div style="font-size:10px;color:var(--text2);margin-bottom:7px">SKU: ${p.sku}${p.category ? ' · ' + p.category : ''}${p.brand ? ' · ' + p.brand : ''}</div>
    <div class="ps">
      <div class="psc"><div class="psl">Supply</div><div class="psv">$${(p.supply_price || 0).toFixed(2)}</div></div>
      <div class="psc"><div class="psl">Retail</div><div class="psv">$${(p.retail_price || 0).toFixed(2)}</div></div>
      <div class="psc"><div class="psl">Margin</div><div class="psv" style="color:var(--green)">${margin}%</div></div>
      <div class="psc" style="border-right:none"><div class="psl">Markup</div><div class="psv">${markup}%</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text2);margin-bottom:7px">
      ${p.has_gst ? '<span class="badge b-blue">GST inc.</span>' : '<span class="badge b-gray">No GST</span>'}
      ${p.supplier ? `Supplier: ${p.supplier}${p.supplier_code ? ' · ' + p.supplier_code : ''}` : ''}
    </div>
    <div style="background:var(--bg2);border-radius:var(--r);padding:8px 10px;margin-bottom:7px">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:9px;font-weight:600;color:var(--text3);text-transform:uppercase">Stock (Lightspeed)</span>
        <span style="font-size:12px;font-weight:600;color:${(p.stock || 0) > 0 ? 'var(--green)' : 'var(--red)'}">${p.stock || 0} units</span>
      </div>
      ${batchHTML}
    </div>
    <div class="ar">
      <button class="ab" onclick="selectLoad('${p.id}');switchTab('inventory');invSeg('load')">
        <div style="font-size:17px">📥</div>Load stock
      </button>
      <button class="ab" onclick="alert('Move stock — select batch to move')">
        <div style="font-size:17px">🔀</div>Move
      </button>
      <button class="ab" onclick="addToWishlist('${p.id}')">
        <div style="font-size:17px">♡</div>Wishlist
      </button>
    </div>
  </div>`;

  if (ctx === 'scan') {
    document.getElementById('scan-empty').style.display = 'none';
    document.getElementById('scan-res').style.display = 'none';
    const pd = document.getElementById('scan-prod');
    pd.innerHTML = `<button class="bk" onclick="backFromProduct()">← Results</button>${html}`;
    pd.style.display = 'block';
  }
}

function backFromProduct() {
  document.getElementById('scan-prod').style.display = 'none';
  const q = document.getElementById('scan-q')?.value;
  if (q) document.getElementById('scan-res').style.display = 'block';
  else document.getElementById('scan-empty').style.display = 'block';
}

// ── INVENTORY ─────────────────────────────────────────────────
function loadInventoryOverview() {
  const products = DB.getProducts();
  const batches = DB.getBatches();
  const expired = DB.getExpiredBatches();
  const expiring = DB.getExpiringBatches(30);
  const bbPassed = DB.getBBPassedBatches();
  const low = products.filter(p => p.reorder_point > 0 && (p.stock || 0) < p.reorder_point);

  const el = document.getElementById('inv-stats');
  if (el) el.innerHTML = `
    <div class="sc"><div class="sl">Total SKUs</div><div class="sv">${products.length.toLocaleString()}</div></div>
    <div class="sc"><div class="sl">Expired</div><div class="sv" style="color:var(--red)">${expired.length}</div></div>
    <div class="sc"><div class="sl">Expiring soon</div><div class="sv" style="color:var(--amber)">${expiring.length}</div></div>
    <div class="sc"><div class="sl">Low stock</div><div class="sv" style="color:var(--orange)">${low.length}</div></div>`;

  // Update alert badge
  const alertCount = expired.length + expiring.length + bbPassed.length;
  const badge = document.getElementById('inv-alert-badge');
  if (badge) badge.textContent = alertCount;
}

function loadAlerts() {
  const expired = DB.getExpiredBatches();
  const expiring = DB.getExpiringBatches(30);
  const bbPassed = DB.getBBPassedBatches();

  const el = document.getElementById('ip-alerts');
  if (!el) return;

  const batchRow = (b, cls, label) => {
    const p = DB.getProductById(b.product_id);
    return `<div class="row"><div class="dot" style="background:var(--${cls === 'b-exp' ? 'red' : cls === 'b-warn' ? 'amber' : 'orange'})"></div>
      <div style="flex:1"><div class="rn">${p?.name || 'Unknown'}</div>
      <div class="rs">${b.location} · ${b.quantity} units · ${fmtDate(b.date)}</div></div>
      <span class="badge ${cls}">${label}</span></div>`;
  };

  el.innerHTML =
    (expired.length ? `<div class="sh" style="color:var(--red)">Expired — discard today</div>` + expired.map(b => batchRow(b, 'b-exp', 'Discard')).join('') : '') +
    (bbPassed.length ? `<div class="sh" style="color:var(--orange);margin-top:4px">Best before passed — still sellable</div>` + bbPassed.map(b => batchRow(b, 'b-bb', 'BB passed')).join('') : '') +
    (expiring.length ? `<div class="sh" style="color:var(--amber);margin-top:4px">Expiring within 30 days</div>` + expiring.map(b => batchRow(b, 'b-warn', fmtDate(b.date))).join('') : '') +
    (!expired.length && !expiring.length && !bbPassed.length ? '<div class="empty">✅ No alerts — all good!</div>' : '');
}

// ── LOAD STOCK ────────────────────────────────────────────────
function selectLoad(id) {
  STATE.loadProductId = id;
  const p = DB.getProductById(id);
  if (!p) return;
  document.getElementById('lf-name').textContent = p.name + (p.variant ? ' · ' + p.variant : '');
  document.getElementById('lf-sku').textContent = 'SKU: ' + p.sku;
  document.getElementById('load-sa').style.display = 'none';
  document.getElementById('load-form').style.display = 'block';
  document.getElementById('lf-qty').value = '';
  document.getElementById('lf-date').value = '';
  setDateType('bb');
  switchTab('inventory');
  invSeg('load');
}

function setDateType(t) {
  STATE.dateType = t;
  document.getElementById('dt-bb').classList.toggle('active', t === 'bb');
  document.getElementById('dt-exp').classList.toggle('active', t === 'exp');
  document.getElementById('dt-lbl').textContent = t === 'bb' ? 'Best Before date' : 'Expiry date';
}

function resetLoadForm() {
  STATE.loadProductId = null;
  document.getElementById('load-sa').style.display = 'block';
  document.getElementById('load-form').style.display = 'none';
  document.getElementById('load-q').value = '';
  clearResults('load');
}

function saveLoadStock() {
  const locFull = document.getElementById('lf-loc').value;
  const loc = locFull.split(' — ')[0];
  const qty = parseInt(document.getElementById('lf-qty').value);
  const date = document.getElementById('lf-date').value;
  if (!qty || qty < 1 || !date) { alert('Please fill in quantity and date'); return; }

  DB.addBatch({
    product_id: STATE.loadProductId,
    location: loc,
    quantity: qty,
    date_type: STATE.dateType,
    date: date,
  });

  const p = DB.getProductById(STATE.loadProductId);
  alert(`✅ Batch saved!\n${p?.name}\n${loc} · ${qty} units\n${STATE.dateType === 'bb' ? 'Best Before' : 'Expiry'}: ${fmtDate(date)}`);
  resetLoadForm();
  loadInventoryOverview();
}

// ── ORDERS & WISHLIST ─────────────────────────────────────────
function loadWishlist() {
  const list = DB.getWishlist();
  const el = document.getElementById('wish-items');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="empty">Wishlist is empty</div>'; return; }
  el.innerHTML = list.map(w => `<div class="row">
    <div style="flex:1">
      <div class="rn">${w.name}${(w.stock || 0) <= 0 ? ' <span class="badge b-exp" style="font-size:9px">Low stock</span>' : ''}</div>
      <div class="rs">${w.supplier || '—'} · ${w.supplier_code || '—'} · Stock: ${w.stock || 0}</div>
    </div>
    <button onclick="DB.removeFromWishlist('${w.product_id}');loadWishlist()" style="border:none;background:none;cursor:pointer;color:var(--text3);font-size:16px">✕</button>
  </div>`).join('');
}

function loadSuggested() {
  const products = DB.getProducts().filter(p => p.reorder_point > 0 && (p.stock || 0) < p.reorder_point);
  const el = document.getElementById('op-suggest');
  if (!el) return;
  const listEl = el.querySelector('#suggest-list');
  if (!listEl) return;
  if (!products.length) { listEl.innerHTML = '<div class="empty">✅ All products are above reorder point</div>'; return; }
  listEl.innerHTML = products.slice(0, 20).map(p => `<div class="row">
    <div style="flex:1">
      <div class="rn">${p.name}${p.variant ? ` · ${p.variant}` : ''}</div>
      <div class="rs">Stock: ${p.stock || 0} · Reorder: ${p.reorder_point} · ${p.supplier || '—'} · ${p.supplier_code || '—'}</div>
    </div>
    <span class="badge b-exp">${(p.stock || 0) - p.reorder_point}</span>
  </div>`).join('');
}

function addToWishlist(id) {
  const p = DB.getProductById(id);
  if (!p) return;
  const added = DB.addToWishlist(p);
  alert(added ? `Added to wishlist:\n${p.name}` : `${p.name} is already in wishlist`);
}

function checkLowStock() {
  const products = DB.getProducts();
  const low = products.filter(p => p.reorder_point > 0 && (p.stock || 0) < p.reorder_point);
  const badge = document.getElementById('suggest-badge');
  if (badge) badge.textContent = low.length;
}

// ── CASHFLOW ──────────────────────────────────────────────────
function loadCashflowToday() {
  const today = todayISO();
  const data = DB.getCashflow(today);
  const el = document.getElementById('cf-entries');
  if (!el) return;

  let cashIn = 0, cashOut = 0;
  if (data.entries.length) {
    el.innerHTML = data.entries.map(e => {
      const isIn = e.type === 'in';
      if (isIn) cashIn += e.amount; else cashOut += e.amount;
      return `<div class="row">
        <div class="dot" style="background:var(--${isIn ? 'green' : 'red'})"></div>
        <div style="flex:1"><div class="rn">${e.note}</div><div class="rs">${new Date(e.timestamp).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit'})} · ${isIn?'Cash in':'Cash out'}</div></div>
        <span style="font-size:12px;font-weight:600;color:var(--${isIn?'green':'red'})">${isIn?'+':'-'}$${e.amount.toFixed(2)}</span>
      </div>`;
    }).join('');
  } else {
    el.innerHTML = '<div class="empty">No entries today</div>';
  }

  // Update stats
  const stats = document.getElementById('cf-stats');
  if (stats) {
    stats.innerHTML = `
      <div class="sc"><div class="sl">Cash in</div><div class="sv" style="color:var(--green)">$${cashIn.toFixed(2)}</div></div>
      <div class="sc"><div class="sl">Cash out</div><div class="sv" style="color:var(--red)">$${cashOut.toFixed(2)}</div></div>
      <div class="sc"><div class="sl">Net cash</div><div class="sv">$${(cashIn - cashOut).toFixed(2)}</div></div>
      <div class="sc"><div class="sl">Entries</div><div class="sv">${data.entries.length}</div></div>`;
  }
}

function addCashEntry() {
  const note = prompt('Note (e.g. Local vege payment):');
  if (!note) return;
  const amount = parseFloat(prompt('Amount ($):'));
  if (isNaN(amount) || amount <= 0) { alert('Invalid amount'); return; }
  const isIn = confirm('Cash IN?\n(Cancel = Cash OUT)');
  DB.addCashEntry(todayISO(), { type: isIn ? 'in' : 'out', amount, note });
  loadCashflowToday();
}

function calcVariance() {
  const actual = parseFloat(document.getElementById('eod-act').value);
  const el = document.getElementById('eod-var');
  if (isNaN(actual)) { el.textContent = '—'; el.style.color = 'var(--text2)'; return; }

  const today = todayISO();
  const data = DB.getCashflow(today);
  const cashIn = data.entries.filter(e => e.type === 'in').reduce((s, e) => s + e.amount, 0);
  const cashOut = data.entries.filter(e => e.type === 'out').reduce((s, e) => s + e.amount, 0);
  const expected = cashIn - cashOut;
  const diff = actual - expected;

  el.textContent = (diff >= 0 ? '+' : '') + '$' + Math.abs(diff).toFixed(2);
  el.style.color = diff >= 0 ? 'var(--green)' : diff < -10 ? 'var(--red)' : 'var(--amber)';
}

function confirmEOD() {
  const actual = parseFloat(document.getElementById('eod-act').value);
  if (isNaN(actual)) { alert('Please enter actual cash count'); return; }
  const today = todayISO();
  const meta = DB.getSyncMeta();
  const salesByDay = meta.sales_by_day || {};
  const daySales = salesByDay[today] || { cash_sale: 0, card_sale: 0 };

  DB.saveEOD(today, {
    actual_cash: actual,
    ls_cash_sale: daySales.cash_sale,
    ls_card_sale: daySales.card_sale,
  });
  alert(`✅ End of day confirmed!\n${today} — locked.`);
}

function loadCashflowHistory() {
  const history = DB.getCashflowHistory().slice(0, 14);
  const el = document.getElementById('cf-history-list');
  if (!el) return;
  if (!history.length) { el.innerHTML = '<div class="empty">No history yet</div>'; return; }
  el.innerHTML = history.map(d => {
    const cashIn = (d.entries || []).filter(e => e.type === 'in').reduce((s, e) => s + e.amount, 0);
    const cashOut = (d.entries || []).filter(e => e.type === 'out').reduce((s, e) => s + e.amount, 0);
    const eodTotal = d.eod ? (d.eod.ls_cash_sale || 0) + (d.eod.ls_card_sale || 0) : 0;
    const variance = d.eod ? d.eod.actual_cash - (cashIn - cashOut) : null;
    return `<div class="row">
      <div style="flex:1">
        <div class="rn">${new Date(d.date).toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'})}</div>
        <div class="rs">Revenue: $${eodTotal.toFixed(2)} · ${variance !== null ? `Variance: <span style="color:var(--${Math.abs(variance)<0.01?'text2':variance>0?'green':'red'})">${variance>=0?'+':''}$${Math.abs(variance).toFixed(2)}</span>` : 'Not confirmed'}</div>
      </div><span style="color:var(--text3)">›</span>
    </div>`;
  }).join('');
}

// ── DASHBOARD ─────────────────────────────────────────────────
function loadDashboard() {
  const meta = DB.getSyncMeta();
  const salesByDay = meta.sales_by_day || {};
  const history = DB.getCashflowHistory();

  let weekCash = 0, weekCard = 0, weekCashOut = 0;
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().split('T')[0];
    const s = salesByDay[key] || {};
    weekCash += s.cash_sale || 0;
    weekCard += s.card_sale || 0;
    const cf = DB.getCashflow(key);
    weekCashOut += (cf.entries || []).filter(e => e.type === 'out').reduce((s, e) => s + e.amount, 0);
  }

  const totalRevenue = weekCash + weekCard;
  const staff = DB.getStaff();
  const weekStart = getWeekStart();
  const timesheets = DB.getTimesheets(weekStart);
  let payrollCash = 0;
  staff.forEach(s => {
    if (s.pay_method === 'cash') payrollCash += (s.hourly_rate || 0) * 40; // estimated
  });

  const settings = DB.getSettings();
  const prevOpening = settings.last_closing_balance || 0;
  const cashOnHand = prevOpening + weekCash - weekCashOut - payrollCash;

  const el = document.getElementById('dash-kpis');
  if (el) el.innerHTML = `
    <div class="kc"><div class="kl">Total revenue</div><div class="kv">$${totalRevenue.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div><div class="ks" style="color:var(--text2)">This week</div></div>
    <div class="kc"><div class="kl">Cash on hand</div><div class="kv">$${cashOnHand.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div><div class="ks" style="color:var(--text2)">Est. after payroll</div></div>
    <div class="kc"><div class="kl">Cash sale</div><div class="kv">$${weekCash.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div></div>
    <div class="kc"><div class="kl">Card sale</div><div class="kv">$${weekCard.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div></div>
    <div class="kc"><div class="kl">Cash out</div><div class="kv">$${weekCashOut.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div></div>
    <div class="kc"><div class="kl">Payroll est.</div><div class="kv">$${payrollCash.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div><div class="ks" style="color:var(--text2)">Cash portion</div></div>`;
}

// ── STAFF & PAYROLL ───────────────────────────────────────────
function loadStaff() {
  const staff = DB.getStaff();
  const el = document.getElementById('staff-list');
  if (!el) return;
  if (!staff.length) {
    el.innerHTML = `<div class="empty">No staff added yet</div>
      <div style="padding:0 12px"><button class="pb" onclick="addStaff()">+ Add first staff member</button></div>`;
    return;
  }
  el.innerHTML = staff.map(s => `<div class="row" onclick="editStaff('${s.id}')">
    <div class="av" style="background:var(--blue-bg);color:var(--blue-t)">${s.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
    <div style="flex:1">
      <div class="rn">${s.name}</div>
      <div class="rs">${s.role || 'Staff'} · $${s.hourly_rate}/h · Super: ${s.apply_super?'on':'off'} · Penalty: ${s.apply_penalty?'on':'off'}</div>
    </div><span style="color:var(--text3)">›</span>
  </div>`).join('');
}

function addStaff() {
  const name = prompt('Staff name:');
  if (!name) return;
  const rate = parseFloat(prompt('Hourly rate ($):'));
  if (isNaN(rate)) return;
  const staff = DB.getStaff();
  staff.push({ id: `staff_${Date.now()}`, name, hourly_rate: rate, role: 'Staff', apply_super: false, apply_penalty: false, pay_method: 'bank' });
  DB.setStaff(staff);
  loadStaff();
}

function editStaff(id) {
  const staff = DB.getStaff();
  const s = staff.find(x => x.id === id);
  if (!s) return;
  const rate = parseFloat(prompt(`New hourly rate for ${s.name}:`, s.hourly_rate));
  if (!isNaN(rate)) {
    s.hourly_rate = rate;
    DB.setStaff(staff);
    loadStaff();
  }
}

function loadPayrollSummary() {
  const staff = DB.getStaff();
  const el = document.getElementById('payroll-list');
  if (!el) return;
  if (!staff.length) { el.innerHTML = '<div class="empty">No staff configured</div>'; return; }
  el.innerHTML = staff.map(s => {
    const hours = 40; // placeholder
    const base = hours * s.hourly_rate;
    return `<div class="row">
      <div class="av" style="background:var(--blue-bg);color:var(--blue-t)">${s.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div style="flex:1"><div class="rn">${s.name}</div><div class="rs">${hours}h · $${s.hourly_rate}/h</div></div>
      <span style="font-size:12px;font-weight:600">$${base.toFixed(2)}</span>
    </div>`;
  }).join('');
}

function selectDay(el) { document.querySelectorAll('.cd').forEach(d => d.classList.remove('sel')); el.classList.add('sel'); }

// ── SYNC ──────────────────────────────────────────────────────
async function triggerSync() {
  if (STATE.syncInProgress) { alert('Sync already in progress...'); return; }

  const settings = DB.getSettings();
  if (!settings.ls_account_id || !settings.ls_api_key) {
    alert('⚠️ Lightspeed API not configured.\n\nGo to Settings tab to add:\n• Account ID\n• API Key');
    switchTab('settings');
    return;
  }

  STATE.syncInProgress = true;
  const btn = document.getElementById('sync-now-btn');
  const statusEl = document.getElementById('sync-status');
  if (btn) { btn.textContent = 'Syncing...'; btn.disabled = true; }

  try {
    const results = await SYNC.syncAll(msg => {
      if (statusEl) statusEl.textContent = msg;
    });
    const meta = DB.getSyncMeta();
    if (statusEl) statusEl.textContent = `Last synced: ${new Date(meta.last_sync).toLocaleTimeString('en-AU')} · ${results.products.toLocaleString()} products`;
    if (btn) btn.textContent = '✅ Sync complete';
    loadSyncLog();
    loadInventoryOverview();
    checkLowStock();
  } catch (err) {
    if (statusEl) statusEl.textContent = `❌ Sync failed: ${err.message}`;
    if (btn) btn.textContent = '⚠️ Sync failed — retry?';
    alert('Sync failed: ' + err.message);
  } finally {
    STATE.syncInProgress = false;
    setTimeout(() => { if (btn) { btn.textContent = '🔄 Sync now'; btn.disabled = false; } }, 3000);
  }
}

function loadSyncMeta() {
  const meta = DB.getSyncMeta();
  const statusEl = document.getElementById('sync-status');
  if (statusEl) {
    if (meta.last_sync) {
      const d = new Date(meta.last_sync);
      statusEl.textContent = `Last synced: ${d.toLocaleDateString('en-AU')} ${d.toLocaleTimeString('en-AU')} · ${(meta.product_count || 0).toLocaleString()} products`;
    } else {
      statusEl.textContent = 'Never synced — tap Sync now to start';
    }
  }
  loadSyncLog();
}

function loadSyncLog() {
  const el = document.getElementById('sync-log');
  if (!el) return;
  const meta = DB.getSyncMeta();
  if (!meta.last_sync) { el.innerHTML = '<div class="empty">No sync history yet</div>'; return; }
  const icon = meta.status === 'success' ? '✅' : '⚠️';
  const d = new Date(meta.last_sync);
  el.innerHTML = `<div class="row" style="cursor:default">
    <div style="flex:1"><div class="rn" style="font-size:11px">${icon} ${d.toLocaleDateString('en-AU')} ${d.toLocaleTimeString('en-AU')}</div>
    <div class="rs">${(meta.product_count||0).toLocaleString()} products${meta.errors?.length ? ` · ${meta.errors.length} error(s)` : ''}</div></div>
  </div>`;
}

// ── SETTINGS ──────────────────────────────────────────────────
function loadSettings() {
  const s = DB.getSettings();
  const map = {
    'sheets-url': s.sheets_url,
    'ls-account-id': s.ls_account_id, 'ls-api-key': s.ls_api_key, 'ls-shop-id': s.ls_shop_id,
    'setting-user': s.user, 'setting-pin': s.pin || '1234'
  };
  Object.entries(map).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val || ''; });
  const sz = document.getElementById('storage-size');
  if (sz) sz.textContent = DB.getStorageSize();
}

function saveSettings() {
  const s = DB.getSettings();
  const get = id => document.getElementById(id)?.value?.trim() || '';
  s.sheets_url = get('sheets-url');
  s.ls_account_id = get('ls-account-id');
  s.ls_api_key = get('ls-api-key');
  s.ls_shop_id = get('ls-shop-id');
  s.user = get('setting-user') || 'Staff';
  s.pin = get('setting-pin') || '1234';
  DB.saveSettings(s);
  alert('✅ Settings saved!');
}

async function testSheets() {
  const s = DB.getSettings();
  if (!s.sheets_url) { alert('⚠️ Enter the Apps Script URL first'); return; }
  if (typeof ovSpin === 'function') ovSpin('Testing connection...');
  try {
    const r = await SHEETS.ping();
    if (typeof ovHide === 'function') ovHide();
    if (r && r.ok) alert('✅ Connected to Google Sheets!\nBackend is reachable.');
    else alert('⚠️ Connected but got unexpected response. Check the URL.');
  } catch (err) {
    if (typeof ovHide === 'function') ovHide();
    alert('❌ Connection failed:\n' + err.message + '\n\nCheck:\n• URL ends with /exec\n• Deployed as Anyone can access');
  }
}

function _oldLoadSettings() {
  const s = DB.getSettings();
  const fields = ['ls-account-id', 'ls-api-key', 'ls-shop-id', 'setting-user', 'setting-pin'];
  const values = [s.ls_account_id, s.ls_api_key, s.ls_shop_id, s.user, s.pin || '1234'];
  fields.forEach((f, i) => { const el = document.getElementById(f); if (el) el.value = values[i] || ''; });
}

function saveSettings() {
  const s = DB.getSettings();
  s.ls_account_id = document.getElementById('ls-account-id')?.value?.trim() || '';
  s.ls_api_key = document.getElementById('ls-api-key')?.value?.trim() || '';
  s.ls_shop_id = document.getElementById('ls-shop-id')?.value?.trim() || '';
  s.user = document.getElementById('setting-user')?.value?.trim() || 'Staff';
  s.pin = document.getElementById('setting-pin')?.value?.trim() || '1234';
  DB.saveSettings(s);
  alert('✅ Settings saved!');
}

async function testConnection() {
  try {
    const name = await SYNC.testConnection();
    alert(`✅ Connected to Lightspeed!\nAccount: ${name}`);
  } catch (err) {
    alert(`❌ Connection failed:\n${err.message}`);
  }
}

// ── EXPORT STUBS ──────────────────────────────────────────────
function exportData(type, format) {
  alert(`Export ${type} as ${format} — will be implemented in production build.\n\nData will download to your device.`);
}

// ════════════════════════════════════════════════════════════
// SCANNER CALLBACK — called by ux.js when a barcode is decoded
// ════════════════════════════════════════════════════════════
function onScanComplete(code, ctx) {
  // Look up product by barcode/SKU
  const p = DB.getProductBySku(code);
  if (ctx === 'scan') {
    document.getElementById('scan-q').value = code;
    if (p) { doSearch(p.name, 'scan'); setTimeout(() => showProduct(p.id, 'scan'), 200); }
    else { doSearch(code, 'scan'); }
  } else if (ctx === 'inv') {
    document.getElementById('inv-q').value = code;
    doSearch(code, 'inv');
  } else if (ctx === 'load') {
    if (p) selectLoad(p.id);
    else { document.getElementById('load-q').value = code; doSearch(code, 'load'); }
  } else if (ctx === 'wish') {
    document.getElementById('wish-q').value = code;
    doSearch(code, 'wish');
  }
}

// ════════════════════════════════════════════════════════════
// ROLE-BASED MENU GATING
// Staff: NO cashflow / dashboard / payroll / sync / export / settings
// Manager: all except settings(API)/staff-mgmt
// Admin: everything
// ════════════════════════════════════════════════════════════
const ROLE_TABS = {
  staff:   ['scan', 'inventory', 'order'],
  manager: ['scan', 'inventory', 'order', 'cashflow', 'dashboard', 'payroll', 'sync', 'export'],
  admin:   ['scan', 'inventory', 'order', 'cashflow', 'dashboard', 'payroll', 'sync', 'export', 'settings'],
};

function applyRoleGating(role) {
  const allowed = ROLE_TABS[role] || ROLE_TABS.staff;
  const allTabs = ['scan', 'inventory', 'order', 'cashflow', 'dashboard', 'payroll', 'sync', 'export', 'settings'];
  allTabs.forEach(t => {
    const navItem = document.getElementById('ni-' + t);
    if (navItem) navItem.style.display = allowed.includes(t) ? 'flex' : 'none';
  });
  // Hide the "Admin" section header if no admin tabs visible
  const adminVisible = allowed.some(t => ['dashboard', 'payroll', 'sync', 'export', 'settings'].includes(t));
  document.querySelectorAll('.nav-section').forEach(s => {
    if (s.textContent.trim() === 'Admin') s.style.display = adminVisible ? 'block' : 'none';
  });
  // Update role label in drawer
  const userEl = document.getElementById('dh-user');
  if (userEl) {
    const s = DB.getSettings();
    const name = (SHEETS.user && SHEETS.user.name) || s.user || 'Staff';
    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    userEl.textContent = roleLabel + ' · ' + name;
  }
}

// ════════════════════════════════════════════════════════════
// DEMO DATA — loaded when Sheets NOT configured, so the app
// is fully testable (UX, scanner, BB logic) before going live.
// ════════════════════════════════════════════════════════════
const DEMO_PRODUCTS = [
  {id:"59b9da06",sku:"8851952140281",barcode:"8851952140281",name:"100 PLUS DRINK",category:"DRINKS",brand:"100 PLUS",supply_price:1.05,retail_price:2.49,has_gst:true,supplier:"Yuen's Market",supplier_code:"D100",variant:"100 PLUS",stock:-28,reorder_point:0},
  {id:"198a7270",sku:"8851952141288",barcode:"8851952141288",name:"100 PLUS DRINK",category:"DRINKS",brand:"100 PLUS",supply_price:1.05,retail_price:2.49,has_gst:true,supplier:"Yuen's Market",supplier_code:"D100",variant:"LEMON LIME 370ML",stock:0,reorder_point:0},
  {id:"a1b2c3d4",sku:"8994800100021",barcode:"8994800100021",name:"INDOMIE MI GORENG",category:"NOODLES",brand:"INDOMIE",supply_price:0.75,retail_price:1.99,has_gst:true,supplier:"INTRADCO",supplier_code:"D7LS",variant:"ORIGINAL",stock:8,reorder_point:48},
  {id:"b2c3d4e5",sku:"8994800100038",barcode:"8994800100038",name:"INDOMIE MI GORENG",category:"NOODLES",brand:"INDOMIE",supply_price:0.75,retail_price:1.99,has_gst:true,supplier:"INTRADCO",supplier_code:"D7LS",variant:"CHICKEN",stock:12,reorder_point:48},
  {id:"c3d4e5f6",sku:"1234567890123",barcode:"1234567890123",name:"MAGGI NOODLES",category:"NOODLES",brand:"MAGGI",supply_price:0.8,retail_price:2.19,has_gst:true,supplier:"MUR THAI",supplier_code:"SDMD",variant:"CHICKEN FLAVOUR",stock:24,reorder_point:24},
  {id:"d4e5f6a7",sku:"9556001234567",barcode:"9556001234567",name:"POCKY CHOCOLATE",category:"SNACK",brand:"POCKY",supply_price:1.5,retail_price:3.99,has_gst:true,supplier:"NIPPON FOOD",supplier_code:"PACS",variant:"ORIGINAL",stock:12,reorder_point:12},
  {id:"e5f6a7b8",sku:"9556001234574",barcode:"9556001234574",name:"POCKY STRAWBERRY",category:"SNACK",brand:"POCKY",supply_price:1.5,retail_price:3.99,has_gst:true,supplier:"NIPPON FOOD",supplier_code:"PACS",variant:"STRAWBERRY",stock:3,reorder_point:12},
  {id:"f6a7b8c9",sku:"8850987654321",barcode:"8850987654321",name:"TCC COCONUT MILK",category:"COOKING INGREDIENTS",brand:"TCC",supply_price:0.9,retail_price:2.79,has_gst:true,supplier:"HTC",supplier_code:"TCC-007",variant:"400ML",stock:2,reorder_point:12},
  {id:"a7b8c9d0",sku:"8850356789012",barcode:"8850356789012",name:"KOKA NOODLES",category:"NOODLES",brand:"KOKA",supply_price:0.7,retail_price:1.89,has_gst:true,supplier:"CHINA FOOD",supplier_code:"",variant:"ORIGINAL",stock:0,reorder_point:24},
  {id:"b8c9d0e1",sku:"8888123456789",barcode:"8888123456789",name:"MAMA NOODLES",category:"NOODLES",brand:"MAMA",supply_price:0.45,retail_price:1.29,has_gst:true,supplier:"TA RABBA",supplier_code:"",variant:"PORK",stock:36,reorder_point:24},
  {id:"d0e1f2a3",sku:"6666345678901",barcode:"6666345678901",name:"TIGER SAUCE",category:"SAUCE",brand:"TIGER",supply_price:1.8,retail_price:4.49,has_gst:true,supplier:"Yuen's Market",supplier_code:"D100",variant:"HOT",stock:15,reorder_point:12},
  {id:"a3b4c5d6",sku:"3333678901234",barcode:"3333678901234",name:"JASMINE RICE",category:"RICE GRAIN & SEED",brand:"",supply_price:8.5,retail_price:18.99,has_gst:false,supplier:"KS",supplier_code:"SDMD",variant:"5KG",stock:25,reorder_point:10},
  {id:"b4c5d6e7",sku:"2222789012345",barcode:"2222789012345",name:"JASMINE RICE",category:"RICE GRAIN & SEED",brand:"",supply_price:4.2,retail_price:9.99,has_gst:false,supplier:"KS",supplier_code:"SDMD",variant:"2KG",stock:30,reorder_point:15},
];

const DEMO_BATCHES = [
  {id:"b1",product_id:"59b9da06",location:"A1",quantity:24,date_type:"bb",date:"2025-08-15"},
  {id:"b2",product_id:"59b9da06",location:"A1",quantity:18,date_type:"bb",date:"2026-02-01"},
  {id:"b3",product_id:"59b9da06",location:"B2",quantity:10,date_type:"expiry",date:"2024-12-01"},
  {id:"b4",product_id:"a1b2c3d4",location:"A2",quantity:36,date_type:"bb",date:"2025-08-15"},
  {id:"b5",product_id:"a7b8c9d0",location:"B1",quantity:12,date_type:"expiry",date:"2025-06-01"},
  {id:"b6",product_id:"d4e5f6a7",location:"E1",quantity:24,date_type:"bb",date:"2025-08-22"},
  {id:"b7",product_id:"f6a7b8c9",location:"Cold Room",quantity:18,date_type:"bb",date:"2025-08-28"},
];

const DEMO_STAFF = [
  {id:'staff_demo1',name:'Minh Nguyen',role:'admin',store:'Rockhampton',pin:'1234',hourly_rate:25,daily_rate:0,super_rate:11.5,sat_rate:1.25,sun_rate:1.5,ph_rate:2.0,pay_method:'split',active:true},
  {id:'staff_demo2',name:'Lan Tran',role:'manager',store:'Rockhampton',pin:'2345',hourly_rate:23,daily_rate:0,super_rate:11.5,sat_rate:1.25,sun_rate:1.5,ph_rate:2.0,pay_method:'bank',active:true},
  {id:'staff_demo3',name:'Huy Nguyen',role:'staff',store:'Rockhampton',pin:'3456',hourly_rate:22,daily_rate:0,super_rate:11.5,sat_rate:1.25,sun_rate:1.5,ph_rate:2.0,pay_method:'cash',active:true},
];

function loadDemoDataIfEmpty() {
  if (DB.getProducts().length === 0) {
    DB.setProducts(DEMO_PRODUCTS);
    DB.set(DB_KEYS.BATCHES, DEMO_BATCHES);
  }
  if (getStaffList().length === 0) {
    saveStaffList(DEMO_STAFF);
    seedDemoTimesheet();
  }
}
