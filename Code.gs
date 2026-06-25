// =============================================
// Lantern Mart — Code.gs  (Google Sheets API)
// Same pattern as Wrap&Roll: GET-based REST API,
// server-side role checks, no CORS preflight.
//
// SETUP: paste into Extensions → Apps Script,
// Deploy → Web App → Execute as: Me, Access: Anyone.
// Run initSheets() once (or call ?action=init) to create tabs.
// =============================================

// ---------- ROUTER ----------
function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  var params = {};
  try {
    if (e && e.parameter) params = e.parameter;
    if (e && e.postData && e.postData.contents) {
      try {
        var body = JSON.parse(e.postData.contents);
        for (var k in body) params[k] = body[k];
      } catch (parseErr) {
        var pairs = e.postData.contents.split('&');
        for (var i = 0; i < pairs.length; i++) {
          var pair = pairs[i].split('=');
          if (pair.length === 2) params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1].replace(/\+/g, ' '));
        }
      }
    }
  } catch (err) {
    return jsonResponse({ ok: false, msg: 'Parse error: ' + err.toString() });
  }

  var action = params.action || '';

  // ----- Server-side role enforcement (never trust client role) -----
  // Role tiers for Lantern Mart: staff < manager < admin
  var ADMIN_ONLY    = ['addStaff', 'updateStaff', 'deleteStaff', 'resetPin'];
  var MANAGER_PLUS  = ['getCashflow', 'getCashflowHistory', 'addCashEntry', 'saveEOD', 'getEOD',
                       'getTimesheets', 'approveShift', 'updateOrderStatus', 'setSyncMeta', 'getDashboard'];
  var STAFF_PLUS    = ['addBatch', 'updateBatch', 'addWishlist', 'removeWishlist',
                       'addOrder', 'checkIn', 'checkOut', 'requestShift'];

  if (ADMIN_ONLY.indexOf(action) > -1) {
    var actor = params.actingUser || params.username;
    if (getUserRole(actor) !== 'admin') return jsonResponse({ ok: false, msg: 'Permission denied: admin required' });
  }
  if (MANAGER_PLUS.indexOf(action) > -1) {
    var r = getUserRole(params.actingUser || params.username);
    if (r !== 'admin' && r !== 'manager') return jsonResponse({ ok: false, msg: 'Permission denied: manager required' });
  }
  if (STAFF_PLUS.indexOf(action) > -1) {
    var r2 = getUserRole(params.username);
    if (r2 !== 'admin' && r2 !== 'manager' && r2 !== 'staff') return jsonResponse({ ok: false, msg: 'Permission denied: login required' });
  }

  try {
    switch (action) {
      case 'init':              return jsonResponse(initSheets());
      case 'ping':              return jsonResponse({ ok: true, msg: 'pong', time: new Date().toISOString() });
      case 'login':             return jsonResponse(login(params.username, params.password));

      // Staff
      case 'getStaff':          return jsonResponse({ ok: true, data: getStaff(params.store) });
      case 'addStaff':          return jsonResponse(addStaff(params));
      case 'updateStaff':       return jsonResponse(updateStaff(params));
      case 'deleteStaff':       return jsonResponse(deleteStaff(params.id, params.actingUser));
      case 'resetPin':          return jsonResponse(resetPin(params.id, params.pin));

      // Batches (BB/Expiry)
      case 'getBatches':        return jsonResponse({ ok: true, data: getBatches(params.store) });
      case 'addBatch':          return jsonResponse(addBatch(params));
      case 'updateBatch':       return jsonResponse(updateBatch(params));

      // Wishlist
      case 'getWishlist':       return jsonResponse({ ok: true, data: getWishlist(params.store) });
      case 'addWishlist':       return jsonResponse(addWishlist(params));
      case 'removeWishlist':    return jsonResponse(removeWishlist(params.id));

      // Orders
      case 'getOrders':         return jsonResponse({ ok: true, data: getOrders(params.store) });
      case 'addOrder':          return jsonResponse(addOrder(params));
      case 'updateOrderStatus': return jsonResponse(updateOrderStatus(params.id, params.status, params.actingUser));

      // Cashflow (manager+)
      case 'getCashflow':       return jsonResponse({ ok: true, data: getCashflow(params.date, params.store) });
      case 'getCashflowHistory':return jsonResponse({ ok: true, data: getCashflowHistory(params.store) });
      case 'addCashEntry':      return jsonResponse(addCashEntry(params));
      case 'saveEOD':           return jsonResponse(saveEOD(params));
      case 'getEOD':            return jsonResponse({ ok: true, data: getEOD(params.date, params.store) });

      // Timesheets (manager+)
      case 'getTimesheets':     return jsonResponse({ ok: true, data: getTimesheets(params.store, params.weekStart) });
      case 'checkIn':           return jsonResponse(checkIn(params));
      case 'checkOut':          return jsonResponse(checkOut(params));
      case 'requestShift':      return jsonResponse(requestShift(params));
      case 'approveShift':      return jsonResponse(approveShift(params.id, params.actingUser));

      // Sync meta
      case 'getSyncMeta':       return jsonResponse({ ok: true, data: getSyncMeta(params.store) });
      case 'setSyncMeta':       return jsonResponse(setSyncMeta(params));

      default:                  return jsonResponse({ ok: false, msg: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, msg: 'Server error: ' + err.toString() });
  }
}

// ---------- ROLE LOOKUP (source of truth) ----------
// Staff columns: 0 id | 1 name | 2 pin | 3 role | 4 store | 5 active |
//   6 hourly_rate | 7 daily_rate | 8 super_rate | 9 sat_rate | 10 sun_rate |
//   11 ph_rate | 12 pay_method | 13 allowedMenus
function getUserRole(name) {
  if (!name) return '';
  try {
    var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff').getDataRange().getValues();
    var nLower = String(name).trim().toLowerCase();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim().toLowerCase() === nLower &&
          String(data[i][5]).trim().toUpperCase() === 'TRUE') {
        return String(data[i][3]).trim();
      }
    }
    return '';
  } catch (e) { return ''; }
}

// ---------- JSON ----------
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreate(ss, name) {
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  return s;
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now() + '_' + Math.floor(Math.random() * 9000 + 1000);
}

// ---------- INIT (create tabs + default admin) ----------
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var staff = getOrCreate(ss, 'Staff');
  if (staff.getLastRow() === 0) {
    staff.appendRow(['id','name','pin','role','store','active','hourly_rate','daily_rate','super_rate','sat_rate','sun_rate','ph_rate','pay_method','allowedMenus']);
    // Default admin so you can log in immediately: name "Admin", PIN 1234
    staff.appendRow([uid('staff'),'Admin','1234','admin','Rockhampton','TRUE',0,0,11.5,1.25,1.5,2.0,'bank','']);
  }

  var batches = getOrCreate(ss, 'Batches');
  if (batches.getLastRow() === 0)
    batches.appendRow(['id','store','product_id','location','quantity','date_type','date','created_by','created_at']);

  var wishlist = getOrCreate(ss, 'Wishlist');
  if (wishlist.getLastRow() === 0)
    wishlist.appendRow(['id','store','product_id','name','supplier','supplier_code','stock','added_by','added_at']);

  var orders = getOrCreate(ss, 'Orders');
  if (orders.getLastRow() === 0)
    orders.appendRow(['id','store','supplier','status','items_json','created_by','created_at','updated_at']);

  var cash = getOrCreate(ss, 'Cashflow');
  if (cash.getLastRow() === 0)
    cash.appendRow(['id','store','date','type','amount','note','created_by','timestamp']);

  var eod = getOrCreate(ss, 'EOD');
  if (eod.getLastRow() === 0)
    eod.appendRow(['store','date','ls_cash_sale','ls_card_sale','actual_cash','variance','confirmed_by','confirmed_at']);

  var ts = getOrCreate(ss, 'Timesheets');
  if (ts.getLastRow() === 0)
    ts.appendRow(['id','store','staff_id','staff_name','date','clock_in','clock_out','hours','status','rate_mode','approved_by','note']);

  var meta = getOrCreate(ss, 'SyncMeta');
  if (meta.getLastRow() === 0) {
    meta.appendRow(['store','last_sync','product_count','status']);
  }

  return { ok: true, msg: 'Sheets initialised. Default admin: name "Admin", PIN 1234' };
}

// ---------- LOGIN ----------
function login(name, pin) {
  try {
    var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff').getDataRange().getValues();
    var nLower = String(name).trim().toLowerCase();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim().toLowerCase() === nLower &&
          String(data[i][2]).trim() === String(pin).trim() &&
          String(data[i][5]).trim().toUpperCase() === 'TRUE') {
        return {
          ok: true,
          id: String(data[i][0]),
          name: String(data[i][1]),
          role: String(data[i][3]),
          store: String(data[i][4]),
          allowedMenus: String(data[i][13] || ''),
        };
      }
    }
    return { ok: false, msg: 'Wrong name or PIN' };
  } catch (e) { return { ok: false, msg: 'Server error: ' + e.toString() }; }
}

// ---------- STAFF ----------
function getStaff(store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff').getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][4]).trim() !== String(store).trim()) continue;
    rows.push({
      id: String(data[i][0]), name: String(data[i][1]), pin: String(data[i][2]),
      role: String(data[i][3]), store: String(data[i][4]),
      active: String(data[i][5]).trim().toUpperCase() === 'TRUE',
      hourly_rate: parseFloat(data[i][6]) || 0, daily_rate: parseFloat(data[i][7]) || 0,
      super_rate: parseFloat(data[i][8]) || 0, sat_rate: parseFloat(data[i][9]) || 1,
      sun_rate: parseFloat(data[i][10]) || 1, ph_rate: parseFloat(data[i][11]) || 1,
      pay_method: String(data[i][12] || 'bank'), allowedMenus: String(data[i][13] || ''),
    });
  }
  return rows;
}

function addStaff(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff');
  var data = sheet.getDataRange().getValues();
  var nLower = String(p.name).trim().toLowerCase();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][1]).trim().toLowerCase() === nLower) return { ok: false, msg: 'A staff member with this name already exists' };
  var id = uid('staff');
  sheet.appendRow([id, p.name, p.pin || '0000', p.role || 'staff', p.store || 'Rockhampton', 'TRUE',
    parseFloat(p.hourly_rate) || 0, parseFloat(p.daily_rate) || 0, parseFloat(p.super_rate) || 11.5,
    parseFloat(p.sat_rate) || 1.25, parseFloat(p.sun_rate) || 1.5, parseFloat(p.ph_rate) || 2.0,
    p.pay_method || 'bank', p.allowedMenus || '']);
  return { ok: true, id: id };
}

function updateStaff(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.id)) {
      var row = i + 1;
      sheet.getRange(row, 2).setValue(p.name);
      if (p.pin) sheet.getRange(row, 3).setValue(p.pin);
      sheet.getRange(row, 4).setValue(p.role);
      sheet.getRange(row, 5).setValue(p.store);
      sheet.getRange(row, 7).setValue(parseFloat(p.hourly_rate) || 0);
      sheet.getRange(row, 8).setValue(parseFloat(p.daily_rate) || 0);
      sheet.getRange(row, 9).setValue(parseFloat(p.super_rate) || 11.5);
      sheet.getRange(row, 10).setValue(parseFloat(p.sat_rate) || 1.25);
      sheet.getRange(row, 11).setValue(parseFloat(p.sun_rate) || 1.5);
      sheet.getRange(row, 12).setValue(parseFloat(p.ph_rate) || 2.0);
      sheet.getRange(row, 13).setValue(p.pay_method || 'bank');
      if (p.allowedMenus != null) sheet.getRange(row, 14).setValue(p.allowedMenus);
      return { ok: true };
    }
  }
  return { ok: false, msg: 'Staff not found' };
}

function deleteStaff(id, actingUser) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) {
      // Prevent deleting the last admin
      if (String(data[i][3]).trim() === 'admin') {
        var admins = 0;
        for (var j = 1; j < data.length; j++)
          if (String(data[j][3]).trim() === 'admin' && String(data[j][5]).trim().toUpperCase() === 'TRUE') admins++;
        if (admins <= 1) return { ok: false, msg: "Can't delete the last admin" };
      }
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, msg: 'Staff not found' };
}

function resetPin(id, pin) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Staff');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]) === String(id)) { sheet.getRange(i + 1, 3).setValue(pin); return { ok: true }; }
  return { ok: false, msg: 'Staff not found' };
}

// ---------- BATCHES ----------
function getBatches(store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Batches').getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][1]).trim() !== String(store).trim()) continue;
    rows.push({
      id: String(data[i][0]), store: String(data[i][1]), product_id: String(data[i][2]),
      location: String(data[i][3]), quantity: parseInt(data[i][4]) || 0,
      date_type: String(data[i][5]), date: formatDate(data[i][6]), created_at: String(data[i][8]),
    });
  }
  return rows;
}

function addBatch(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Batches');
  var id = uid('batch');
  sheet.appendRow([id, p.store || 'Rockhampton', p.product_id, p.location, parseInt(p.quantity) || 0,
    p.date_type || 'bb', p.date, p.username || '', new Date().toISOString()]);
  return { ok: true, id: id };
}

function updateBatch(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Batches');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(p.id)) {
      if (p.quantity != null) sheet.getRange(i + 1, 5).setValue(parseInt(p.quantity) || 0);
      if (p.location) sheet.getRange(i + 1, 4).setValue(p.location);
      return { ok: true };
    }
  }
  return { ok: false, msg: 'Batch not found' };
}

// ---------- WISHLIST ----------
function getWishlist(store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Wishlist').getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][1]).trim() !== String(store).trim()) continue;
    rows.push({
      id: String(data[i][0]), product_id: String(data[i][2]), name: String(data[i][3]),
      supplier: String(data[i][4]), supplier_code: String(data[i][5]), stock: parseInt(data[i][6]) || 0,
    });
  }
  return rows;
}

function addWishlist(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Wishlist');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][2]) === String(p.product_id) && String(data[i][1]).trim() === String(p.store || 'Rockhampton').trim())
      return { ok: false, msg: 'Already in wishlist' };
  var id = uid('wish');
  sheet.appendRow([id, p.store || 'Rockhampton', p.product_id, p.name, p.supplier || '', p.supplier_code || '',
    parseInt(p.stock) || 0, p.username || '', new Date().toISOString()]);
  return { ok: true, id: id };
}

function removeWishlist(id) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Wishlist');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]) === String(id)) { sheet.deleteRow(i + 1); return { ok: true }; }
  return { ok: false, msg: 'Not found' };
}

// ---------- ORDERS ----------
function getOrders(store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Orders').getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][1]).trim() !== String(store).trim()) continue;
    var items = [];
    try { items = JSON.parse(data[i][4] || '[]'); } catch (e) {}
    rows.push({
      id: String(data[i][0]), store: String(data[i][1]), supplier: String(data[i][2]),
      status: String(data[i][3]), items: items, created_at: String(data[i][6]),
    });
  }
  return rows;
}

function addOrder(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Orders');
  var year = new Date().getFullYear();
  var id = 'ORD-' + year + '-' + ('000' + (sheet.getLastRow())).slice(-3);
  sheet.appendRow([id, p.store || 'Rockhampton', p.supplier || '', 'pending', p.items_json || '[]',
    p.username || '', new Date().toISOString(), '']);
  return { ok: true, id: id };
}

function updateOrderStatus(id, status, actingUser) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Orders');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 4).setValue(status);
      sheet.getRange(i + 1, 8).setValue(new Date().toISOString());
      return { ok: true };
    }
  return { ok: false, msg: 'Order not found' };
}

// ---------- CASHFLOW (manager+) ----------
function getCashflow(date, store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Cashflow').getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][1]).trim() !== String(store).trim()) continue;
    if (date && formatDate(data[i][2]) !== date) continue;
    rows.push({
      id: String(data[i][0]), date: formatDate(data[i][2]), type: String(data[i][3]),
      amount: parseFloat(data[i][4]) || 0, note: String(data[i][5]), timestamp: String(data[i][7]),
    });
  }
  return rows;
}

function getCashflowHistory(store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Cashflow').getDataRange().getValues();
  var byDate = {};
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][1]).trim() !== String(store).trim()) continue;
    var d = formatDate(data[i][2]);
    if (!byDate[d]) byDate[d] = { date: d, cash_in: 0, cash_out: 0, entries: 0 };
    var amt = parseFloat(data[i][4]) || 0;
    if (String(data[i][3]) === 'in') byDate[d].cash_in += amt; else byDate[d].cash_out += amt;
    byDate[d].entries++;
  }
  return Object.keys(byDate).sort().reverse().map(function (k) { return byDate[k]; });
}

function addCashEntry(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Cashflow');
  var id = uid('cf');
  sheet.appendRow([id, p.store || 'Rockhampton', p.date, p.type, parseFloat(p.amount) || 0,
    p.note || '', p.actingUser || '', new Date().toISOString()]);
  return { ok: true, id: id };
}

function saveEOD(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'EOD');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (formatDate(data[i][1]) === p.date && String(data[i][0]).trim() === String(p.store || 'Rockhampton').trim()) {
      var row = i + 1;
      sheet.getRange(row, 3, 1, 6).setValues([[parseFloat(p.ls_cash_sale) || 0, parseFloat(p.ls_card_sale) || 0,
        parseFloat(p.actual_cash) || 0, parseFloat(p.variance) || 0, p.actingUser || '', new Date().toISOString()]]);
      return { ok: true };
    }
  }
  sheet.appendRow([p.store || 'Rockhampton', p.date, parseFloat(p.ls_cash_sale) || 0, parseFloat(p.ls_card_sale) || 0,
    parseFloat(p.actual_cash) || 0, parseFloat(p.variance) || 0, p.actingUser || '', new Date().toISOString()]);
  return { ok: true };
}

function getEOD(date, store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'EOD').getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (formatDate(data[i][1]) === date && String(data[i][0]).trim() === String(store || 'Rockhampton').trim())
      return { ls_cash_sale: parseFloat(data[i][2]) || 0, ls_card_sale: parseFloat(data[i][3]) || 0,
               actual_cash: parseFloat(data[i][4]) || 0, variance: parseFloat(data[i][5]) || 0 };
  return null;
}

// ---------- TIMESHEETS (manager+) ----------
function getTimesheets(store, weekStart) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Timesheets').getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    if (store && String(data[i][1]).trim() !== String(store).trim()) continue;
    rows.push({
      id: String(data[i][0]), staff_id: String(data[i][2]), staff_name: String(data[i][3]),
      date: formatDate(data[i][4]), clock_in: String(data[i][5]), clock_out: String(data[i][6]),
      hours: parseFloat(data[i][7]) || 0, status: String(data[i][8]), rate_mode: String(data[i][9] || ''),
    });
  }
  return rows;
}

function requestShift(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Timesheets');
  var id = uid('ts');
  sheet.appendRow([id, p.store || 'Rockhampton', p.staff_id, p.staff_name || '', p.date,
    p.clock_in || '', p.clock_out || '', parseFloat(p.hours) || 0, 'pending', p.rate_mode || '', '', p.note || '']);
  return { ok: true, id: id };
}

function checkIn(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Timesheets');
  var id = uid('ts');
  sheet.appendRow([id, p.store || 'Rockhampton', p.staff_id, p.staff_name || '', p.date,
    p.time || new Date().toISOString(), '', 0, 'clocked_in', '', '', '']);
  return { ok: true, id: id };
}

function checkOut(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Timesheets');
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][2]) === String(p.staff_id) && String(data[i][8]) === 'clocked_in') {
      sheet.getRange(i + 1, 7).setValue(p.time || new Date().toISOString());
      sheet.getRange(i + 1, 9).setValue('pending');
      return { ok: true };
    }
  }
  return { ok: false, msg: 'No open shift found' };
}

function approveShift(id, actingUser) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'Timesheets');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]) === String(id)) {
      sheet.getRange(i + 1, 9).setValue('approved');
      sheet.getRange(i + 1, 11).setValue(actingUser || '');
      return { ok: true };
    }
  return { ok: false, msg: 'Shift not found' };
}

// ---------- SYNC META ----------
function getSyncMeta(store) {
  var data = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'SyncMeta').getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]).trim() === String(store || 'Rockhampton').trim())
      return { last_sync: String(data[i][1]), product_count: parseInt(data[i][2]) || 0, status: String(data[i][3]) };
  return { last_sync: '', product_count: 0, status: 'never' };
}

function setSyncMeta(p) {
  var sheet = getOrCreate(SpreadsheetApp.getActiveSpreadsheet(), 'SyncMeta');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++)
    if (String(data[i][0]).trim() === String(p.store || 'Rockhampton').trim()) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[p.last_sync, parseInt(p.product_count) || 0, p.status]]);
      return { ok: true };
    }
  sheet.appendRow([p.store || 'Rockhampton', p.last_sync, parseInt(p.product_count) || 0, p.status]);
  return { ok: true };
}

// ---------- UTIL ----------
function formatDate(v) {
  if (!v) return '';
  if (v instanceof Date) {
    var y = v.getFullYear(), m = ('0' + (v.getMonth() + 1)).slice(-2), d = ('0' + v.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return String(v).split('T')[0];
}
