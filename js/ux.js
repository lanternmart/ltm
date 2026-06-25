// ux.js — Wrap&Roll-style UX patterns for Lantern Mart
// Pull-to-refresh · Swipe menu · Loading % · Version auto-update · Scanner

// ════════════════════════════════════════════════════════════
// VERSION AUTO-UPDATE  (must match version.json + sw.js CACHE_NAME)
// ════════════════════════════════════════════════════════════
var APP_VER = '1.0.2';
var SW_REG = null;
var UPDATE_PENDING = false;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(function (reg) { SW_REG = reg; reg.update(); })
      .catch(function () {});
  });
}

function checkVersion() {
  fetch('version.json?_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.version && data.version !== APP_VER && !UPDATE_PENDING) {
        UPDATE_PENDING = true;
        if (SW_REG) SW_REG.update().catch(function () {});
        showUpdateBanner(data.version);
      }
    }).catch(function () {});
}

function showUpdateBanner(newVer) {
  var b = document.getElementById('update-banner');
  if (b) {
    var sub = document.getElementById('update-banner-sub');
    if (sub) sub.textContent = 'v' + APP_VER + ' → v' + newVer;
    b.style.display = 'flex';
  }
}

function applyUpdate() {
  var done = function () { window.location.reload(); };
  if (SW_REG && SW_REG.waiting) SW_REG.waiting.postMessage({ type: 'SKIP_WAITING' });
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
  }
  // Clear all caches so the reload pulls fresh files (prevents stale-version loops)
  if (window.caches && caches.keys) {
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    }).then(done).catch(done);
  } else {
    setTimeout(done, 400);
  }
}

window.addEventListener('load', function () { setTimeout(checkVersion, 2000); });
setInterval(checkVersion, 30000);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') checkVersion();
});
window.addEventListener('focus', checkVersion);

// Reload once when the new SW takes control
if ('serviceWorker' in navigator) {
  var refreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshed) return;
    refreshed = true;
    window.location.reload();
  });
}

// ════════════════════════════════════════════════════════════
// LOADING %  (circular SVG ring 0→100%)
// ════════════════════════════════════════════════════════════
function g(id) { return document.getElementById(id); }

function ovSpin(t) {
  // Indeterminate spinner — quick actions
  if (g('ot')) g('ot').textContent = t || 'Loading...';
  if (g('ospin-el')) g('ospin-el').style.display = 'block';
  if (g('oprog-el')) g('oprog-el').style.display = 'none';
  if (g('load-overlay')) g('load-overlay').classList.add('on');
}

function ovStart(t) {
  // Percentage loading — app open / refresh / sync
  if (g('ot')) g('ot').textContent = t || 'Loading...';
  if (g('ospin-el')) g('ospin-el').style.display = 'none';
  if (g('oprog-el')) g('oprog-el').style.display = 'block';
  setLoadPct(0);
  if (g('load-overlay')) g('load-overlay').classList.add('on');
}

function setLoadPct(pct) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  var ring = g('oprog-ring'), txt = g('oprog-pct');
  var C = 175.93; // 2π·28
  if (ring) ring.style.strokeDashoffset = String(C * (1 - pct / 100));
  if (txt) txt.textContent = pct + '%';
}

function ovHide() { if (g('load-overlay')) g('load-overlay').classList.remove('on'); }

// ════════════════════════════════════════════════════════════
// PULL-TO-REFRESH  (drag down from top → reload)
// ════════════════════════════════════════════════════════════
(function () {
  var sa = null, ind = null;
  var startY = 0, pulling = false, dist = 0;
  var TRIGGER = 70, MAX = 110;

  function activeContent() {
    var panes = document.querySelectorAll('.tab-pane.active .content, .tab-pane[style*="flex"] .content');
    for (var i = 0; i < panes.length; i++) {
      if (panes[i].offsetParent !== null) return panes[i];
    }
    return null;
  }

  document.addEventListener('touchstart', function (e) {
    if (!ind) ind = document.getElementById('ptr-indicator');
    sa = activeContent();
    if (!sa || !ind) { pulling = false; return; }
    if (document.querySelector('.drawer.open')) { pulling = false; return; }
    if (document.getElementById('s-app').style.display === 'none') { pulling = false; return; }
    if (sa.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true; dist = 0;
    } else { pulling = false; }
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!pulling) return;
    dist = e.touches[0].clientY - startY;
    var pctEl = ind.querySelector('.ptr-pct');
    if (dist <= 0) {
      ind.style.opacity = '0';
      ind.style.transform = 'translateX(-50%) translateY(-10px)';
      return;
    }
    var pull = Math.min(dist, MAX);
    var prog = Math.min(pull / TRIGGER, 1);
    ind.style.opacity = prog;
    ind.style.transform = 'translateX(-50%) translateY(' + (pull - 10) + 'px)';
    if (pctEl) pctEl.textContent = Math.round(prog * 100) + '%';
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (!pulling) return;
    pulling = false;
    if (dist >= TRIGGER) {
      var pctEl = ind.querySelector('.ptr-pct');
      if (pctEl) pctEl.textContent = '100%';
      ind.style.opacity = '1';
      ind.style.transform = 'translateX(-50%) translateY(50px)';
      setTimeout(function () { ind.classList.add('spinning'); }, 150);
      setTimeout(function () { window.location.reload(); }, 350);
    } else {
      ind.style.opacity = '0';
      ind.style.transform = 'translateX(-50%) translateY(-10px)';
    }
    dist = 0;
  }, { passive: true });
})();

// ════════════════════════════════════════════════════════════
// SWIPE MENU  (swipe right from left edge → open; swipe left → close)
// ════════════════════════════════════════════════════════════
(function () {
  var startX = 0, startY = 0, tracking = false;
  var EDGE = 40, THRESHOLD = 55;

  document.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    startX = t.clientX; startY = t.clientY;
    var isOpen = document.querySelector('.drawer.open') !== null;
    tracking = (startX <= EDGE && !isOpen) || isOpen;
  }, { passive: true });

  document.addEventListener('touchend', function (e) {
    if (!tracking) return;
    tracking = false;
    var t = e.changedTouches[0];
    var dx = t.clientX - startX, dy = t.clientY - startY;
    if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
    var isOpen = document.querySelector('.drawer.open') !== null;
    if (dx > 0 && startX <= EDGE && !isOpen && typeof openDrawer === 'function') openDrawer();
    else if (dx < 0 && isOpen && typeof closeDrawer === 'function') closeDrawer();
  }, { passive: true });
})();

// ════════════════════════════════════════════════════════════
// SCANNER  — BarcodeDetector first (fast, native, 0KB),
//            ZXing fallback (works on every browser incl. old iOS)
// ════════════════════════════════════════════════════════════
var scanStream = null, scanRAF = null, scanVideo = null, scanLastTime = 0;
var nativeDetector = null;
var zxingLoadPromise = null;
var activeScanContext = null;

function supportsNativeDetector() {
  return 'BarcodeDetector' in window;
}

async function initNativeDetector() {
  if (!supportsNativeDetector()) return null;
  try {
    var formats = await window.BarcodeDetector.getSupportedFormats();
    return new window.BarcodeDetector({
      formats: formats.filter(function (f) {
        return ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code', 'data_matrix', 'codabar'].includes(f);
      })
    });
  } catch (e) { return null; }
}

function loadZXingIfNeeded() {
  if (typeof ZXing !== 'undefined') return Promise.resolve();
  if (zxingLoadPromise) return zxingLoadPromise;
  zxingLoadPromise = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
    s.onload = function () { resolve(); };
    s.onerror = function () { zxingLoadPromise = null; reject(new Error('scanner lib failed')); };
    document.head.appendChild(s);
  });
  return zxingLoadPromise;
}

function buildZXingHints() {
  var hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.DATA_MATRIX,
    ZXing.BarcodeFormat.CODABAR
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return hints;
}

function zxingDecodeFrame(video) {
  var canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  if (canvas.width === 0 || canvas.height === 0) return null;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    var src = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    var bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src));
    var reader = new ZXing.MultiFormatReader();
    reader.setHints(buildZXingHints());
    var res = reader.decode(bmp);
    if (res) return res.getText();
  } catch (e) {}
  try {
    var src2 = new ZXing.HTMLCanvasElementLuminanceSource(canvas).invert();
    var bmp2 = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(src2));
    var reader2 = new ZXing.MultiFormatReader();
    reader2.setHints(buildZXingHints());
    var res2 = reader2.decode(bmp2);
    if (res2) return res2.getText();
  } catch (e2) {}
  return null;
}

async function openScanner(ctx) {
  activeScanContext = ctx || 'scan';
  g('scan-fullscreen').classList.add('on');
  if (g('scan-fs-input')) g('scan-fs-input').value = '';
  document.body.style.overflow = 'hidden';

  // Try native first
  nativeDetector = await initNativeDetector();
  if (nativeDetector) {
    g('scan-fs-hint').textContent = 'Starting camera...';
    startCameraStream();
    return;
  }
  // Fallback to ZXing
  var loaded = typeof ZXing !== 'undefined';
  g('scan-fs-hint').textContent = loaded ? 'Starting camera...' : 'Preparing scanner (first time)...';
  loadZXingIfNeeded().then(function () {
    g('scan-fs-hint').textContent = 'Starting camera...';
    startCameraStream();
  }).catch(function () {
    g('scan-fs-hint').textContent = '⚠️ Scanner failed to load. Type SKU below.';
  });
}

function startCameraStream() {
  var video = g('scan-video');
  scanVideo = video;
  var constraints = {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920, min: 640 }, height: { ideal: 1080, min: 480 } },
    audio: false
  };
  navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
    startScanLoop(stream, video);
  }).catch(function (err) {
    if (err.name === 'OverconstrainedError') {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        .then(function (stream) { startScanLoop(stream, video); })
        .catch(showScanError);
    } else showScanError(err);
  });
}

function showScanError(err) {
  var name = err && err.name ? err.name : 'Error';
  if (name === 'NotAllowedError') g('scan-fs-hint').textContent = '⚠️ Camera permission denied. Type SKU below.';
  else if (name === 'NotFoundError') g('scan-fs-hint').textContent = '⚠️ No camera found.';
  else g('scan-fs-hint').textContent = '⚠️ Camera error: ' + name + '. Type SKU below.';
}

function startScanLoop(stream, video) {
  scanStream = stream;
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.play().catch(function () {});
  g('scan-fs-hint').textContent = nativeDetector ? '⚡ Point camera at barcode' : 'Point camera at barcode';

  async function loop() {
    if (!scanStream) return;
    var now = Date.now();
    // Native: ~15fps (fast). ZXing: ~5fps (throttled).
    var throttle = nativeDetector ? 66 : 180;
    if (now - scanLastTime > throttle && video.readyState >= 2) {
      scanLastTime = now;
      var text = null;
      if (nativeDetector) {
        try {
          var codes = await nativeDetector.detect(video);
          if (codes && codes.length) text = codes[0].rawValue;
        } catch (e) {}
      } else {
        text = zxingDecodeFrame(video);
      }
      if (text) { handleScanResult(text); return; }
    }
    scanRAF = requestAnimationFrame(loop);
  }
  scanRAF = requestAnimationFrame(loop);
}

function captureAndDecode() {
  if (!scanVideo || scanVideo.readyState < 2) {
    g('scan-fs-hint').textContent = '⚠️ Camera not ready.';
    return;
  }
  g('scan-fs-hint').textContent = 'Decoding...';
  if (nativeDetector) {
    nativeDetector.detect(scanVideo).then(function (codes) {
      if (codes && codes.length) handleScanResult(codes[0].rawValue);
      else g('scan-fs-hint').textContent = '⚠️ No code. Hold steady, fill frame.';
    });
  } else {
    var text = zxingDecodeFrame(scanVideo);
    if (text) handleScanResult(text);
    else g('scan-fs-hint').textContent = '⚠️ No code. Hold steady, fill frame.';
  }
}

function manualScanSubmit() {
  var v = g('scan-fs-input').value.trim();
  if (v) handleScanResult(v);
}

function closeScanner() {
  if (scanRAF) { cancelAnimationFrame(scanRAF); scanRAF = null; }
  if (scanStream) { scanStream.getTracks().forEach(function (t) { t.stop(); }); scanStream = null; }
  scanVideo = null;
  nativeDetector = null;
  g('scan-fullscreen').classList.remove('on');
  document.body.style.overflow = '';
  activeScanContext = null;
}

// Called when a barcode is decoded — looks up product, shows it
function handleScanResult(code) {
  closeScanner();
  var ctx = activeScanContext || 'scan';
  // route to the right search box
  if (typeof onScanComplete === 'function') onScanComplete(code, ctx);
}
