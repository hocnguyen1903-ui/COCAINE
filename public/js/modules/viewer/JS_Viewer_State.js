// =========================================================================
// BCONS DOCUMENT VIEWER - MODULE 1/4: STATE, STORAGE, GZIP & PROGRESS UI
// =========================================================================

(() => {
  if (typeof pdfjsLib !== "undefined" && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  const BV = (window.__BconsViewer = window.__BconsViewer || {});

  // =========================================================================
  // CẤU HÌNH & CẦU NỐI BACKEND BCONS-VIEWER (CLOUD VISION AI)
  // =========================================================================
  const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwlhByeOZIdDs4dIpioMo4e-2On3ad317kjoFMobpPiNUjtYi3o8Aa_jCXuoUWRucVJ/exec";

  function createGasBridge(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function(_, prop) {
        if (prop === "withSuccessHandler") {
          return function(fn) { return createGasBridge(fn, onFailure); };
        }
        if (prop === "withFailureHandler") {
          return function(fn) { return createGasBridge(onSuccess, fn); };
        }
        return function(...args) {
          const payload = args.length === 1 ? args[0] : args;
          callBackend(prop, payload)
            .then(data => {
              if (onSuccess) onSuccess(data);
            })
            .catch(err => {
              if (onFailure) onFailure(err);
            });
        };
      }
    });
  }

  const googleScriptRun = (typeof window.google !== "undefined" && window.google.script && window.google.script.run)
    ? window.google.script.run
    : createGasBridge(null, null);

  // =========================================================================
  // HẰNG SỐ & STATE DÙNG CHUNG CHO TOÀN BỘ VIEWER
  // =========================================================================
  const DB_NAME = "Bcons_Prv_Cache_DB";
  const PAGE_STORE = "page_bitmaps";
  const PDF_STORE = "pdf_binaries";
  const STORE_NAME = "manifests_v13_vision";
  const MAX_LOCAL_FILES = 3;
  const MAX_RAM_FILES = 5;

  const S = (BV.state = {
    LARGE_FILE_THRESHOLD_MB: 6.0,
    currentManifest: null,
    currentFileId: null,
    currentScale: 1.0,
    baseFitScale: 1.0,
    isDragging: false,
    startX: 0,
    startY: 0,
    scrollLeftStart: 0,
    scrollTopStart: 0,

    searchResults: [],
    currentMatchIndex: -1,
    pageObserver: null,
    lastSearchedQuery: "",
    currentFileSizeMB: 0,

    dbPromise: null,
    cachedRenderScale: 1,
    SESSION_LRU_KEYS: [],
    SESSION_MANIFEST_CACHE: {},

    currentSessionEpoch: 0,
    activeFetchAbortController: null,
    currentFileName: "",
    cachedDriveToken: null,
    driveTokenExpiresAt: 0,
    currentTargetFolderId: "1qK7-AXau_htyfxhmllXLCp2w0dkb6d40",

    currentPdfDoc: null,
    pdfLoadPromise: null,

    isZooming: false,
    scrollLock: false,
    zoomDebounceTimer: null,
    sharpenToken: 0,
    jumpToken: 0,
    activeRenderTasks: new Map(),

    bgAudioCtx: null,
    bgSourceNode: null,
    softProgressTimer: null,
    currentLoaderPct: 0,
    AUTO_REPAIR_ATTEMPTED: new Set(),
    transitionWaitPromise: Promise.resolve(),
    isPanelTransitioning: false
  });

  BV.googleScriptRun = googleScriptRun;

  // =========================================================================
  // TIỆN ÍCH CƠ BẢN & RAM LRU CACHE
  // =========================================================================
  function scalesEqual(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.004;
  }

  function round1(num) {
    return Math.round(num * 10) / 10;
  }

  function putSessionCache(fileId, manifest) {
    if (!fileId || !manifest) return;
    const idx = S.SESSION_LRU_KEYS.indexOf(fileId);
    if (idx !== -1) S.SESSION_LRU_KEYS.splice(idx, 1);
    S.SESSION_LRU_KEYS.unshift(fileId);
    S.SESSION_MANIFEST_CACHE[fileId] = manifest;

    while (S.SESSION_LRU_KEYS.length > MAX_RAM_FILES) {
      const evictedId = S.SESSION_LRU_KEYS.pop();
      if (evictedId && evictedId !== S.currentFileId) {
        delete S.SESSION_MANIFEST_CACHE[evictedId];
        console.log(`%c🧹 [LRU CACHE] Giải phóng RAM file: ${evictedId} (Đã có IndexedDB sao lưu)`, "color: #78909c;");
      }
    }
  }

  function getSessionCache(fileId) {
    if (!S.SESSION_MANIFEST_CACHE[fileId]) return null;
    const idx = S.SESSION_LRU_KEYS.indexOf(fileId);
    if (idx !== -1) {
      S.SESSION_LRU_KEYS.splice(idx, 1);
      S.SESSION_LRU_KEYS.unshift(fileId);
    }
    return S.SESSION_MANIFEST_CACHE[fileId];
  }

  // =========================================================================
  // INDEXEDDB STORAGE (MANIFEST + PDF BINARY + PAGE BITMAPS)
  // =========================================================================
  function openDB() {
    if (S.dbPromise) return S.dbPromise;
    S.dbPromise = new Promise(function(resolve, reject) {
      const req = indexedDB.open(DB_NAME, 13);
      req.onupgradeneeded = function(e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "fileId" });
        }
        if (!db.objectStoreNames.contains(PDF_STORE)) {
          db.createObjectStore(PDF_STORE);
        }
        if (!db.objectStoreNames.contains(PAGE_STORE)) {
          db.createObjectStore(PAGE_STORE);
        }
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { S.dbPromise = null; reject(req.error); };
      req.onblocked = function() {
        console.warn("IndexedDB blocked: Vui lòng đóng các tab khác đang mở ứng dụng.");
      };
    });
    return S.dbPromise;
  }

  function bitmapKey(fileId, pdfPage, scale, fitScale) {
    const f = Math.round(Number(fitScale || S.baseFitScale || 1) * 100);
    return fileId + "|" + pdfPage + "|" + Math.round(Number(scale) * 100) + "|" + f;
  }

  function idbGet(storeName, key) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = function() { resolve(req.result == null ? null : req.result); };
        req.onerror = function() { resolve(null); };
      });
    }).catch(function() { return null; });
  }

  function getLocalPdfBinary(fileId) {
    if (!fileId) return Promise.resolve(null);
    return idbGet(PDF_STORE, fileId);
  }

  function saveLocalPdfBinary(fileId, buffer) {
    if (!fileId || String(fileId).indexOf("local_") === 0 || !buffer) return Promise.resolve(false);
    if (buffer.byteLength === 0) return Promise.resolve(false);

    let copyBuf;
    try {
      copyBuf = buffer.slice(0);
    } catch (e) {
      return Promise.resolve(false);
    }

    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PDF_STORE, "readwrite");
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
        tx.objectStore(PDF_STORE).put(copyBuf, fileId);
      });
    }).then(function(ok) {
      rememberLocalFile(fileId);
      return ok;
    }).catch(function() { return false; });
  }

  function deleteLocalPdfBinary(fileId) {
    if (!fileId) return Promise.resolve(false);
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PDF_STORE, "readwrite");
        tx.objectStore(PDF_STORE).delete(fileId);
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function getLocalManifest(fileId) {
    return idbGet(STORE_NAME, fileId).then(function(row) {
      return row && row.manifest ? row.manifest : null;
    });
  }

  function saveLocalManifest(fileId, manifest) {
    if (!fileId) return Promise.resolve(false);
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
        tx.objectStore(STORE_NAME).put({ fileId: fileId, manifest: manifest });
      });
    }).catch(function() { return false; });
  }

  function getPageBitmap(fileId, pdfPage, scale) {
    if (!fileId || String(fileId).indexOf("local_") === 0) return Promise.resolve(null);
    if (!scalesEqual(scale, S.cachedRenderScale)) return Promise.resolve(null);
    return idbGet(PAGE_STORE, bitmapKey(fileId, pdfPage, scale));
  }

  function savePageBitmap(fileId, pdfPage, scale, canvas) {
    if (!fileId || String(fileId).indexOf("local_") === 0 || !canvas) return Promise.resolve(false);
    if (!scalesEqual(scale, S.cachedRenderScale)) return Promise.resolve(false);
    return new Promise(function(resolve) {
      canvas.toBlob(function(blob) {
        if (!blob) { resolve(false); return; }
        openDB().then(function(db) {
          const tx = db.transaction(PAGE_STORE, "readwrite");
          tx.oncomplete = function() { resolve(true); };
          tx.onerror = function() { resolve(false); };
          tx.objectStore(PAGE_STORE).put(blob, bitmapKey(fileId, pdfPage, scale));
        }).catch(function() { resolve(false); });
      }, "image/jpeg", 0.88);
    });
  }

  function clearFilePageBitmaps(fileId) {
    if (!fileId) return Promise.resolve(false);
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PAGE_STORE, "readwrite");
        const cursorReq = tx.objectStore(PAGE_STORE).openCursor();
        cursorReq.onsuccess = function() {
          const cursor = cursorReq.result;
          if (!cursor) return;
          if (String(cursor.key).indexOf(fileId + "|") === 0) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function rememberLocalFile(fileId) {
    if (!fileId || String(fileId).indexOf("local_") === 0) return Promise.resolve(false);
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction([PAGE_STORE, PDF_STORE], "readwrite");
        const pages = tx.objectStore(PAGE_STORE);
        const pdfs = tx.objectStore(PDF_STORE);
        const getLru = pages.get("__lru__");
        getLru.onsuccess = function() {
          let list = Array.isArray(getLru.result) ? getLru.result.filter(function(id) { return id !== fileId; }) : [];
          list.unshift(fileId);
          const removed = list.slice(MAX_LOCAL_FILES);
          list = list.slice(0, MAX_LOCAL_FILES);
          pages.put(list, "__lru__");
          removed.forEach(function(id) { pdfs.delete(id); });
          if (!removed.length) return;
          const cursorReq = pages.openCursor();
          cursorReq.onsuccess = function() {
            const cursor = cursorReq.result;
            if (!cursor) return;
            const key = String(cursor.key);
            for (let i = 0; i < removed.length; i++) {
              if (key.indexOf(removed[i] + "|") === 0) {
                cursor.delete();
                break;
              }
            }
            cursor.continue();
          };
        };
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
      });
    }).catch(function() { return false; });
  }

  // =========================================================================
  // NÉN & GIẢI NÉN GZIP CHO MANIFEST
  // =========================================================================
  async function compressManifest(manifest) {
    try {
      const jsonStr = JSON.stringify(manifest);
      const stream = new Blob([jsonStr]).stream().pipeThrough(new CompressionStream("gzip"));
      const buffer = await new Response(stream).arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const CHUNK_SZ = 0x8000;
      const chunks = [];
      for (let i = 0; i < bytes.length; i += CHUNK_SZ) {
        chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SZ)));
      }
      return "GZ:" + btoa(chunks.join(""));
    } catch (e) {
      console.warn("Lỗi nén Gzip, fallback sang JSON thô:", e);
      return JSON.stringify(manifest);
    }
  }

  async function decompressManifest(dataString) {
    if (!dataString || typeof dataString !== "string") return dataString;
    const trimmed = dataString.trim();

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.parse(trimmed);
    }

    try {
      const rawB64 = trimmed.startsWith("GZ:") ? trimmed.slice(3) : trimmed;
      const binaryStr = atob(rawB64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
      const jsonText = await new Response(stream).text();
      return JSON.parse(jsonText);
    } catch (e) {
      console.error("Lỗi giải nén Gzip:", e);
      return JSON.parse(dataString);
    }
  }

  // =========================================================================
  // KEEP-ALIVE AUDIO & LOADING / PROGRESS UI
  // =========================================================================
  function startBackgroundKeepAlive() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!S.bgAudioCtx) {
        S.bgAudioCtx = new AudioCtxClass();
        const buffer = S.bgAudioCtx.createBuffer(1, S.bgAudioCtx.sampleRate, S.bgAudioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.00002;
        }
        S.bgSourceNode = S.bgAudioCtx.createBufferSource();
        S.bgSourceNode.buffer = buffer;
        S.bgSourceNode.loop = true;
        S.bgSourceNode.connect(S.bgAudioCtx.destination);
        S.bgSourceNode.start();
      }

      if (S.bgAudioCtx.state === "suspended") {
        S.bgAudioCtx.resume().catch(() => {});
      }
    } catch (e) {}
  }

  function stopBackgroundKeepAlive() {
    try {
      if (S.bgAudioCtx && S.bgAudioCtx.state === "running") {
        S.bgAudioCtx.suspend();
      }
    } catch (e) {}
  }

  function updateLoaderProgress(percent) {
    const fill = document.getElementById("viewer-progress-fill");
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    S.currentLoaderPct = p;
    if (fill) fill.style.width = p.toFixed(2) + "%";
  }

  function stopSoftProgress() {
    if (S.softProgressTimer) {
      clearInterval(S.softProgressTimer);
      S.softProgressTimer = null;
    }
  }

  function startSoftProgress(fromPct, capPct = 35, factor = 0.035) {
    stopSoftProgress();
    let cur = Math.max(S.currentLoaderPct, fromPct);
    updateLoaderProgress(cur);
    S.softProgressTimer = setInterval(() => {
      cur += (capPct - cur) * factor;
      updateLoaderProgress(cur);
      if (capPct - cur < 0.05) stopSoftProgress();
    }, 60);
  }

  function showLoading(msg, initialPercent = 0) {
    stopSoftProgress();
    const txt = document.getElementById("loading-text");
    const sub = document.getElementById("loading-subtext");
    const ov = document.getElementById("loading-overlay");
    if (txt) txt.textContent = msg;
    if (sub) sub.textContent = "";
    if (initialPercent !== null) updateLoaderProgress(initialPercent);
    if (ov) ov.style.display = "flex";
  }

  function hideLoading() {
    stopSoftProgress();
    const sub = document.getElementById("loading-subtext");
    const ov = document.getElementById("loading-overlay");
    if (sub) sub.textContent = "";
    if (ov) ov.style.display = "none";
    stopBackgroundKeepAlive();
  }

  function setAntiExitGuard(enable) {
    if (enable) {
      window.onbeforeunload = function(e) {
        e.preventDefault();
        return (e.returnValue = "Hệ thống đang số hóa tài liệu. Bạn có chắc muốn rời đi?");
      };
    } else {
      window.onbeforeunload = null;
    }
  }

  function updateProcessProgress(percent, stageText, isSuccess = false, isError = false) {
    stopSoftProgress();
    const ov = document.getElementById("loading-overlay");
    const txt = document.getElementById("loading-text");
    const sub = document.getElementById("loading-subtext");

    if (isError) {
      setAntiExitGuard(false);
      hideLoading();
      if (typeof showToast_PL === "function") {
        showToast_PL("⚠️ " + (stageText || "Số hóa thất bại"), "error");
      }
      return;
    }

    const p = Math.max(0, Math.min(100, Math.round(percent)));

    if (ov && ov.style.display !== "flex") {
      S.currentLoaderPct = 0;
      if (txt && !txt.textContent) txt.textContent = "LOADING DOCUMENT";
      ov.style.display = "flex";
    }

    updateLoaderProgress(Math.max(S.currentLoaderPct, p));
    if (sub) {
      sub.textContent = isSuccess ? `(${stageText})` : `(${stageText} ${p}%)`;
    }

    if (isSuccess) {
      setAntiExitGuard(false);
      if (typeof showToast_PL === "function") {
        showToast_PL("✔ Số hóa tài liệu hoàn tất!", "success");
      }
    }
  }

  BV.utils = {
    scalesEqual,
    round1,
    startBackgroundKeepAlive,
    stopBackgroundKeepAlive,
    updateLoaderProgress,
    stopSoftProgress,
    startSoftProgress,
    showLoading,
    hideLoading,
    setAntiExitGuard,
    updateProcessProgress
  };

  BV.storage = {
    putSessionCache,
    getSessionCache,
    openDB,
    bitmapKey,
    getLocalPdfBinary,
    saveLocalPdfBinary,
    deleteLocalPdfBinary,
    getLocalManifest,
    saveLocalManifest,
    getPageBitmap,
    savePageBitmap,
    clearFilePageBitmaps,
    rememberLocalFile,
    compressManifest,
    decompressManifest
  };
})();