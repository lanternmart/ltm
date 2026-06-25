// sheets.js — Google Sheets (Apps Script) API for Lantern Mart
// Calls the Web App URL via GET (no CORS preflight), same as Wrap&Roll.

const SHEETS = {
  user: null,   // { id, name, role, store, allowedMenus }

  get url() { return (DB.getSettings().sheets_url || '').trim(); },
  isConfigured() { return this.url.length > 10; },

  // ── Core call ─────────────────────────────────────────
  async call(action, params) {
    if (!this.isConfigured()) throw new Error('Apps Script URL not set in Settings');
    const u = new URL(this.url);
    u.searchParams.set('action', action);
    if (params) for (const k in params) {
      if (params[k] != null && params[k] !== undefined) u.searchParams.set(k, params[k]);
    }
    // Attach the logged-in user for server-side role checks
    if (this.user) {
      if (!u.searchParams.has('username')) u.searchParams.set('username', this.user.name);
      if (!u.searchParams.has('actingUser')) u.searchParams.set('actingUser', this.user.name);
    }
    const res = await fetch(u.toString(), { method: 'GET', redirect: 'follow' });
    const json = await res.json();
    return json;
  },

  // ── Auth ──────────────────────────────────────────────
  async login(name, pin) {
    const r = await this.call('login', { username: name, password: pin });
    if (!r.ok) throw new Error(r.msg || 'Login failed');
    this.user = { id: r.id, name: r.name, role: r.role, store: r.store, allowedMenus: r.allowedMenus || '' };
    DB.set('lm_sheets_user', this.user);
    return this.user;
  },
  logout() { this.user = null; DB.set('lm_sheets_user', null); },
  restoreSession() { const u = DB.get('lm_sheets_user'); if (u) this.user = u; return this.user; },

  get role() { return this.user?.role || 'staff'; },
  isManager() { return ['manager', 'admin'].includes(this.role); },
  isAdmin() { return this.role === 'admin'; },

  async ping() { return this.call('ping'); },

  // ── Staff ─────────────────────────────────────────────
  async getStaff(store) { const r = await this.call('getStaff', { store }); return r.data || []; },
  async addStaff(rec) { const r = await this.call('addStaff', rec); if (!r.ok) throw new Error(r.msg); return r; },
  async updateStaff(rec) { const r = await this.call('updateStaff', rec); if (!r.ok) throw new Error(r.msg); return r; },
  async deleteStaff(id) { const r = await this.call('deleteStaff', { id }); if (!r.ok) throw new Error(r.msg); return r; },
  async resetPin(id, pin) { const r = await this.call('resetPin', { id, pin }); if (!r.ok) throw new Error(r.msg); return r; },

  // ── Batches ───────────────────────────────────────────
  async getBatches(store) { const r = await this.call('getBatches', { store }); return r.data || []; },
  async addBatch(b) { const r = await this.call('addBatch', b); if (!r.ok) throw new Error(r.msg); return r; },

  // ── Wishlist ──────────────────────────────────────────
  async getWishlist(store) { const r = await this.call('getWishlist', { store }); return r.data || []; },
  async addWishlist(w) { const r = await this.call('addWishlist', w); return r; },
  async removeWishlist(id) { return this.call('removeWishlist', { id }); },

  // ── Orders ────────────────────────────────────────────
  async getOrders(store) { const r = await this.call('getOrders', { store }); return r.data || []; },
  async addOrder(o) { return this.call('addOrder', o); },
  async updateOrderStatus(id, status) { return this.call('updateOrderStatus', { id, status }); },

  // ── Cashflow (manager+) ───────────────────────────────
  async getCashflow(date, store) { const r = await this.call('getCashflow', { date, store }); return r; },
  async getCashflowHistory(store) { const r = await this.call('getCashflowHistory', { store }); return r.data || []; },
  async addCashEntry(e) { return this.call('addCashEntry', e); },
  async saveEOD(e) { return this.call('saveEOD', e); },
  async getEOD(date, store) { const r = await this.call('getEOD', { date, store }); return r.data; },

  // ── Timesheets (manager+) ─────────────────────────────
  async getTimesheets(store, weekStart) { const r = await this.call('getTimesheets', { store, weekStart }); return r.data || []; },
  async checkIn(p) { return this.call('checkIn', p); },
  async checkOut(p) { return this.call('checkOut', p); },
  async approveShift(id) { return this.call('approveShift', { id }); },

  // ── Sync meta ─────────────────────────────────────────
  async getSyncMeta(store) { const r = await this.call('getSyncMeta', { store }); return r.data; },
  async setSyncMeta(p) { return this.call('setSyncMeta', p); },
};

window.SHEETS = SHEETS;
