// db.js — localStorage cache layer
// All data stored here, app reads from here, never directly from API at runtime

const DB_VERSION = 1;
const KEYS = {
  PRODUCTS:    'lm_products',
  INVENTORY:   'lm_inventory',
  BATCHES:     'lm_batches',
  ORDERS:      'lm_orders',
  WISHLIST:    'lm_wishlist',
  CASHFLOW:    'lm_cashflow',
  TIMESHEETS:  'lm_timesheets',
  STAFF:       'lm_staff',
  SETTINGS:    'lm_settings',
  SYNC_META:   'lm_sync_meta',
  WEEKLY:      'lm_weekly',
};

const DB = {

  // ── GET / SET ──────────────────────────────────────────────
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('DB.set failed:', e);
      return false;
    }
  },

  // ── PRODUCTS ──────────────────────────────────────────────
  getProducts() { return this.get(KEYS.PRODUCTS) || []; },
  setProducts(data) { return this.set(KEYS.PRODUCTS, data); },

  searchProducts(q) {
    if (!q || q.length < 1) return [];
    const lq = q.toLowerCase();
    return this.getProducts().filter(p =>
      p.name?.toLowerCase().includes(lq) ||
      p.sku?.includes(q) ||
      p.barcode?.includes(q) ||
      p.supplier?.toLowerCase().includes(lq) ||
      p.supplier_code?.toLowerCase().includes(lq) ||
      p.variant?.toLowerCase().includes(lq)
    ).slice(0, 20);
  },

  getProductBySku(sku) {
    return this.getProducts().find(p => p.sku === sku || p.barcode === sku) || null;
  },

  getProductById(id) {
    return this.getProducts().find(p => p.id === id) || null;
  },

  // ── BATCHES ───────────────────────────────────────────────
  getBatches() { return this.get(KEYS.BATCHES) || []; },

  getBatchesByProduct(productId) {
    return this.getBatches().filter(b => b.product_id === productId);
  },

  addBatch(batch) {
    const batches = this.getBatches();
    batch.id = `batch_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    batch.created_at = new Date().toISOString();
    batches.push(batch);
    this.set(KEYS.BATCHES, batches);
    return batch;
  },

  updateBatch(id, updates) {
    const batches = this.getBatches();
    const idx = batches.findIndex(b => b.id === id);
    if (idx === -1) return false;
    batches[idx] = { ...batches[idx], ...updates, updated_at: new Date().toISOString() };
    return this.set(KEYS.BATCHES, batches);
  },

  getExpiredBatches() {
    const today = new Date(); today.setHours(0,0,0,0);
    return this.getBatches().filter(b => {
      const d = new Date(b.date);
      if (b.date_type === 'expiry') return d < today;
      const diffDays = Math.floor((d - today) / 86400000);
      return diffDays < -180; // BB passed > 6 months
    });
  },

  getExpiringBatches(days = 30) {
    const today = new Date(); today.setHours(0,0,0,0);
    const future = new Date(today); future.setDate(today.getDate() + days);
    return this.getBatches().filter(b => {
      if (b.date_type === 'expiry') return false;
      const d = new Date(b.date);
      const diff = Math.floor((d - today) / 86400000);
      return diff >= 0 && diff <= days;
    });
  },

  getBBPassedBatches() {
    const today = new Date(); today.setHours(0,0,0,0);
    return this.getBatches().filter(b => {
      if (b.date_type === 'expiry') return false;
      const d = new Date(b.date);
      const diffDays = Math.floor((d - today) / 86400000);
      return diffDays < 0 && Math.abs(diffDays) <= 180;
    });
  },

  // ── ORDERS ────────────────────────────────────────────────
  getOrders() { return this.get(KEYS.ORDERS) || []; },

  addOrder(order) {
    const orders = this.getOrders();
    order.id = `ORD-${new Date().getFullYear()}-${String(orders.length + 1).padStart(3,'0')}`;
    order.created_at = new Date().toISOString();
    order.status = 'pending';
    orders.unshift(order);
    this.set(KEYS.ORDERS, orders);
    return order;
  },

  updateOrderStatus(id, status, meta = {}) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx === -1) return false;
    orders[idx] = { ...orders[idx], status, ...meta, updated_at: new Date().toISOString() };
    return this.set(KEYS.ORDERS, orders);
  },

  // ── WISHLIST ──────────────────────────────────────────────
  getWishlist() { return this.get(KEYS.WISHLIST) || []; },

  addToWishlist(product) {
    const list = this.getWishlist();
    if (list.find(w => w.product_id === product.id)) return false; // already in list
    list.unshift({ product_id: product.id, name: product.name, supplier: product.supplier, supplier_code: product.supplier_code, stock: product.stock, added_at: new Date().toISOString() });
    return this.set(KEYS.WISHLIST, list);
  },

  removeFromWishlist(productId) {
    const list = this.getWishlist().filter(w => w.product_id !== productId);
    return this.set(KEYS.WISHLIST, list);
  },

  // ── CASHFLOW ──────────────────────────────────────────────
  getCashflow(date) {
    const all = this.get(KEYS.CASHFLOW) || {};
    return all[date] || { entries: [], eod: null };
  },

  addCashEntry(date, entry) {
    const all = this.get(KEYS.CASHFLOW) || {};
    if (!all[date]) all[date] = { entries: [], eod: null };
    entry.id = `cf_${Date.now()}`;
    entry.timestamp = new Date().toISOString();
    all[date].entries.unshift(entry);
    return this.set(KEYS.CASHFLOW, all);
  },

  saveEOD(date, eodData) {
    const all = this.get(KEYS.CASHFLOW) || {};
    if (!all[date]) all[date] = { entries: [], eod: null };
    all[date].eod = { ...eodData, confirmed_at: new Date().toISOString() };
    return this.set(KEYS.CASHFLOW, all);
  },

  getCashflowHistory() {
    const all = this.get(KEYS.CASHFLOW) || {};
    return Object.entries(all)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, data]) => ({ date, ...data }));
  },

  // ── STAFF & TIMESHEETS ────────────────────────────────────
  getStaff() { return this.get(KEYS.STAFF) || []; },
  setStaff(data) { return this.set(KEYS.STAFF, data); },

  getTimesheets(weekStart) {
    const all = this.get(KEYS.TIMESHEETS) || {};
    return all[weekStart] || {};
  },

  clockIn(staffId, weekStart, date) {
    const all = this.get(KEYS.TIMESHEETS) || {};
    if (!all[weekStart]) all[weekStart] = {};
    if (!all[weekStart][date]) all[weekStart][date] = {};
    all[weekStart][date][staffId] = {
      clock_in: new Date().toISOString(),
      clock_out: null,
      status: 'clocked_in'
    };
    return this.set(KEYS.TIMESHEETS, all);
  },

  clockOut(staffId, weekStart, date) {
    const all = this.get(KEYS.TIMESHEETS) || {};
    if (!all[weekStart]?.[date]?.[staffId]) return false;
    all[weekStart][date][staffId].clock_out = new Date().toISOString();
    all[weekStart][date][staffId].status = 'pending';
    return this.set(KEYS.TIMESHEETS, all);
  },

  // ── SETTINGS ──────────────────────────────────────────────
  getSettings() {
    return this.get(KEYS.SETTINGS) || {
      store: 'Rockhampton',
      user: 'Staff',
      ls_account_id: '',
      ls_api_key: '',
      sync_interval: 30,
      bb_warning_days: 30,
      bb_expired_months: 6,
    };
  },
  saveSettings(s) { return this.set(KEYS.SETTINGS, s); },

  // ── SYNC META ─────────────────────────────────────────────
  getSyncMeta() {
    return this.get(KEYS.SYNC_META) || { last_sync: null, product_count: 0, status: 'never' };
  },
  setSyncMeta(m) { return this.set(KEYS.SYNC_META, m); },

  // ── UTILS ─────────────────────────────────────────────────
  clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  },

  getStorageSize() {
    let total = 0;
    Object.values(KEYS).forEach(k => {
      const item = localStorage.getItem(k);
      if (item) total += item.length;
    });
    return (total / 1024).toFixed(1) + ' KB';
  }
};

window.DB = DB;
window.DB_KEYS = KEYS;
