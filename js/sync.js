// sync.js — Lightspeed Retail API integration
// Docs: https://x-series-api.lightspeedapp.com/

const LS_BASE = 'https://api.lightspeedapp.com/API/V3/Account';

const SYNC = {

  // ── CONFIG ────────────────────────────────────────────────
  get config() {
    const s = DB.getSettings();
    return {
      accountId: s.ls_account_id,
      apiKey: s.ls_api_key,
    };
  },

  get headers() {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  },

  isConfigured() {
    const { accountId, apiKey } = this.config;
    return accountId && apiKey && accountId.length > 0 && apiKey.length > 0;
  },

  // ── MAIN SYNC ─────────────────────────────────────────────
  async syncAll(onProgress) {
    if (!this.isConfigured()) {
      throw new Error('Lightspeed API not configured. Please add Account ID and API Key in Settings.');
    }

    const steps = [
      { label: 'Fetching products...', fn: () => this.syncProducts(onProgress) },
      { label: 'Fetching inventory...', fn: () => this.syncInventory(onProgress) },
      { label: 'Fetching sales...', fn: () => this.syncSales(onProgress) },
    ];

    const results = { products: 0, inventory: 0, sales: 0, errors: [] };

    for (const step of steps) {
      try {
        onProgress?.(step.label);
        const count = await step.fn();
        if (step.label.includes('products')) results.products = count;
        if (step.label.includes('inventory')) results.inventory = count;
        if (step.label.includes('sales')) results.sales = count;
      } catch (err) {
        results.errors.push(`${step.label} failed: ${err.message}`);
        console.error(step.label, err);
      }
    }

    DB.setSyncMeta({
      last_sync: new Date().toISOString(),
      product_count: results.products,
      status: results.errors.length === 0 ? 'success' : 'partial',
      errors: results.errors,
    });

    return results;
  },

  // ── PRODUCTS ──────────────────────────────────────────────
  async syncProducts(onProgress) {
    const { accountId } = this.config;
    let allItems = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      onProgress?.(`Fetching products (${allItems.length} so far)...`);
      const url = `${LS_BASE}/${accountId}/ItemVariant.json?limit=${limit}&offset=${offset}&load_relations=["Item","ItemMatrix","Prices","Images"]`;
      const res = await this._fetch(url);
      const data = await res.json();

      const items = data.ItemVariant;
      if (!items || items.length === 0) { hasMore = false; break; }

      const formatted = this._formatProducts(Array.isArray(items) ? items : [items]);
      allItems = allItems.concat(formatted);
      offset += limit;

      if (items.length < limit) hasMore = false;
    }

    DB.setProducts(allItems);
    return allItems.length;
  },

  _formatProducts(variants) {
    return variants.map(v => {
      const item = v.Item || {};
      const prices = v.Prices?.ItemPrice || [];
      const price = Array.isArray(prices) ? prices.find(p => p.useType === 'Default') : prices;
      const costPrice = Array.isArray(prices) ? prices.find(p => p.useType === 'MSRP') : null;

      return {
        id: v.itemVariantID,
        item_id: v.itemID,
        sku: v.customSku || v.upc || v.itemVariantID,
        barcode: v.upc || '',
        name: item.description || '',
        variant: v.description || '',
        category: item.Category?.name || '',
        brand: item.Manufacturer?.name || '',
        supplier: item.defaultVendor?.name || '',
        supplier_code: item.defaultVendor?.vendorID || '',
        retail_price: parseFloat(price?.amount || 0),
        supply_price: parseFloat(costPrice?.amount || item.defaultCost || 0),
        has_gst: item.tax ? true : false,
        tax_rate: parseFloat(item.TaxClass?.rate || 0),
        active: item.archived !== 'true',
        stock: 0, // filled by syncInventory
        reorder_point: parseInt(item.reorderPoint || 0),
        restock_level: parseInt(item.restockLevel || 0),
        synced_at: new Date().toISOString(),
      };
    });
  },

  // ── INVENTORY ─────────────────────────────────────────────
  async syncInventory(onProgress) {
    const { accountId } = this.config;
    const settings = DB.getSettings();
    const products = DB.getProducts();
    if (!products.length) return 0;

    // Fetch inventory for Rockhampton shop (shopID configured in settings)
    const shopId = settings.ls_shop_id || '';
    const url = `${LS_BASE}/${accountId}/ItemInventory.json?limit=100&load_relations=all${shopId ? `&shopID=${shopId}` : ''}`;

    const res = await this._fetch(url);
    const data = await res.json();
    const inv = data.ItemInventory;
    if (!inv) return 0;

    const invArray = Array.isArray(inv) ? inv : [inv];

    // Map inventory to products
    const invMap = {};
    invArray.forEach(i => { invMap[i.itemVariantID] = parseInt(i.count || 0); });

    const updated = products.map(p => ({
      ...p,
      stock: invMap[p.id] ?? p.stock,
    }));

    DB.setProducts(updated);
    return invArray.length;
  },

  // ── SALES ─────────────────────────────────────────────────
  async syncSales(onProgress) {
    const { accountId } = this.config;
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    const url = `${LS_BASE}/${accountId}/Sale.json?limit=100&timeStamp=%3E%3D${weekAgo}T00:00:00.000Z&completed=true&load_relations=["SaleLines","SalePayments"]`;

    const res = await this._fetch(url);
    const data = await res.json();
    const sales = data.Sale;
    if (!sales) return 0;

    const saleArray = Array.isArray(sales) ? sales : [sales];

    // Aggregate by day for cashflow
    const byDay = {};
    saleArray.forEach(sale => {
      const date = sale.timeStamp?.split('T')[0] || today;
      if (!byDay[date]) byDay[date] = { cash_sale: 0, card_sale: 0, total: 0 };

      const payments = sale.SalePayments?.SalePayment || [];
      const pmtArray = Array.isArray(payments) ? payments : [payments];

      pmtArray.forEach(pmt => {
        const amt = parseFloat(pmt.amount || 0);
        const type = (pmt.PaymentType?.name || '').toLowerCase();
        if (type.includes('cash')) byDay[date].cash_sale += amt;
        else byDay[date].card_sale += amt;
        byDay[date].total += amt;
      });
    });

    // Store as sync data for EOD reference
    const meta = DB.getSyncMeta();
    DB.setSyncMeta({ ...meta, sales_by_day: byDay });
    return saleArray.length;
  },

  // ── HTTP helper ───────────────────────────────────────────
  async _fetch(url) {
    const res = await fetch(url, {
      headers: this.headers,
      mode: 'cors',
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API ${res.status}: ${err.slice(0, 200)}`);
    }
    return res;
  },

  // ── TEST CONNECTION ───────────────────────────────────────
  async testConnection() {
    const { accountId } = this.config;
    const url = `${LS_BASE}/${accountId}/Account.json`;
    const res = await this._fetch(url);
    const data = await res.json();
    return data.Account?.name || 'Connected';
  },
};

window.SYNC = SYNC;
