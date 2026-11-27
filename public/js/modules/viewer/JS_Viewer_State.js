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
  const PL01_INDEX_STORE = "pl01_indexes";
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
    isPanelTransitioning: false,
    isDocumentReady: false
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
      const req = indexedDB.open(DB_NAME, 14);
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
        if (!db.objectStoreNames.contains(PL01_INDEX_STORE)) {
          db.createObjectStore(PL01_INDEX_STORE, { keyPath: "year" });
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

  function deleteLocalManifest(fileId) {
    if (!fileId) return Promise.resolve(false);
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(fileId);
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
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
  function startBackgroundKeepAlive(key = "viewer_digitize") {
    if (typeof acquireKeepAlive === "function") acquireKeepAlive(key);
  }

  function stopBackgroundKeepAlive(key = "viewer_digitize") {
    if (typeof releaseKeepAlive === "function") releaseKeepAlive(key);
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

    const syncedPct = isSuccess ? 100 : Math.max(Math.round(S.currentLoaderPct), p);
    updateLoaderProgress(syncedPct);
    if (sub) {
      sub.textContent = isSuccess ? `(${stageText})` : `(${stageText} ${syncedPct}%)`;
    }

    if (isSuccess) {
      setAntiExitGuard(false);
      if (typeof showToast_PL === "function") {
        showToast_PL("✔ Số hóa tài liệu hoàn tất!", "success");
      }
    }
  }

  // =========================================================================
  // PL01 YEARLY SHARDED INDEX CACHE & 3-TIER SEARCH ENGINE
  // =========================================================================
  const PL01_STOP_WORDS = new Set(["va", "cac", "tai", "theo"]);
  const PL01_ADMIN_BIGRAMS = new Set([
    "cung cap", "thi cong", "lap dat", "vat tu", "nhan cong", "may moc", "hang muc"
  ]);

  function filterPl01ActiveEntries(entries) {
    if (!entries || entries.length < 3) return entries;
    const kept = [];
    for (let i = 0; i < entries.length; i++) {
      if (i + 1 < entries.length && PL01_ADMIN_BIGRAMS.has(entries[i].tok + " " + entries[i + 1].tok)) {
        i++;
        continue;
      }
      if (PL01_STOP_WORDS.has(entries[i].tok)) continue;
      kept.push(entries[i]);
    }
    return kept.length >= 2 ? kept : entries;
  }

  const PL01_INDEX_STATE = {
    ready: false,
    syncing: false,
    syncPromise: null,
    lastMetaCheckAt: 0,
    years: {},
    byMaHD: new Map(),
    byFileId: new Map()
  };

  function normalizePl01SearchStr(str) {
    if (!str) return "";
    return String(str)
      .normalize("NFC")
      .replace(/[àáạảãâầấậẩẫăằắặẳẵÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, "a")
      .replace(/[èéẹẻẽêềếệểễÈÉẸẺẼÊỀẾỆỂỄ]/g, "e")
      .replace(/[ìíịỉĩÌÍỊỈĨ]/g, "i")
      .replace(/[òóọỏõôồốộổỗơờớợởỡÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, "o")
      .replace(/[ùúụủũưừứựửữÙÚỤỦŨƯỪỨỰỬỮ]/g, "u")
      .replace(/[ỳýỵỷỹỲÝỴỶỸ]/g, "y")
      .replace(/[đĐ]/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/(\d)[.,](?=\d)/g, "$1")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokenizeRawLineWithOffsets(rawLine) {
    const tokens = [];
    const re = /(?:[A-Za-zÀ-ỹ0-9]|(?<=\d)[.,](?=\d))+/g;
    let m;
    while ((m = re.exec(rawLine)) !== null) {
      const norm = normalizePl01SearchStr(m[0]);
      if (!norm) continue;
      tokens.push({
        norm: norm,
        start: m.index,
        end: m.index + m[0].length
      });
    }
    return tokens;
  }

  function getLocalPl01Index(year) {
    return idbGet(PL01_INDEX_STORE, String(year));
  }

  function getAllLocalPl01Indexes() {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PL01_INDEX_STORE, "readonly");
        const req = tx.objectStore(PL01_INDEX_STORE).getAll();
        req.onsuccess = function() { resolve(Array.isArray(req.result) ? req.result : []); };
        req.onerror = function() { resolve([]); };
      });
    }).catch(function() { return []; });
  }

  function saveLocalPl01Index(year, updatedAt, indexObj) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PL01_INDEX_STORE, "readwrite");
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
        tx.objectStore(PL01_INDEX_STORE).put({
          year: String(year),
          updatedAt: Number(updatedAt) || Date.now(),
          indexObj: indexObj
        });
      });
    }).catch(function() { return false; });
  }

  function clearLocalPl01Indexes() {
    PL01_INDEX_STATE.years = {};
    PL01_INDEX_STATE.byMaHD.clear();
    PL01_INDEX_STATE.byFileId.clear();
    PL01_INDEX_STATE.ready = false;
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PL01_INDEX_STORE, "readwrite");
        tx.objectStore(PL01_INDEX_STORE).clear();
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function deleteLocalPl01IndexYear(year) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(PL01_INDEX_STORE, "readwrite");
        tx.objectStore(PL01_INDEX_STORE).delete(String(year));
        tx.oncomplete = function() { resolve(true); };
        tx.onerror = function() { resolve(false); };
      });
    }).catch(function() { return false; });
  }

  function rebuildPl01MemoryMaps() {
    PL01_INDEX_STATE.byMaHD.clear();
    PL01_INDEX_STATE.byFileId.clear();

    const years = Object.keys(PL01_INDEX_STATE.years).sort((a, b) => Number(b) - Number(a));
    years.forEach(y => {
      const idxObj = PL01_INDEX_STATE.years[y];
      if (!idxObj || !idxObj.files) return;

      Object.keys(idxObj.files).forEach(fileId => {
        const entry = idxObj.files[fileId];
        if (!entry || !entry.maHD || !Array.isArray(entry.pages)) return;

        const compiledPages = entry.pages.map(pTuple => {
          const pageNum = Number(pTuple[0]) || 1;
          const rawLines = Array.isArray(pTuple[1]) ? pTuple[1] : [];
          const compiledLines = [];
          let pagePadNorm = " ";

          for (let i = 0; i < rawLines.length; i++) {
            const raw = String(rawLines[i] || "").trim();
            if (!raw) continue;
            const norm = normalizePl01SearchStr(raw);
            if (!norm) continue;
            const padNorm = " " + norm + " ";
            compiledLines.push({ raw, norm, padNorm });
            pagePadNorm += norm + " ";
          }
          return { pageNum, lines: compiledLines, pagePadNorm };
        });

        const record = {
          fileId: fileId,
          maHD: String(entry.maHD).trim(),
          year: y,
          apStart: Number(entry.apStart) || (compiledPages[0]?.pageNum || 1),
          pages: compiledPages
        };

        PL01_INDEX_STATE.byFileId.set(fileId, record);
        PL01_INDEX_STATE.byMaHD.set(record.maHD.toUpperCase(), record);
      });
    });

    PL01_INDEX_STATE.ready = true;
  }

  async function syncPl01Indexes(forceRefresh = false) {
    if (PL01_INDEX_STATE.syncPromise && !forceRefresh) {
      return PL01_INDEX_STATE.syncPromise;
    }

    const runSync = (async () => {
      PL01_INDEX_STATE.syncing = true;
      try {
        const localRows = await getAllLocalPl01Indexes();
        const localByYear = new Map();
        localRows.forEach(row => {
          if (row && row.year && row.indexObj) {
            localByYear.set(String(row.year), row);
            PL01_INDEX_STATE.years[String(row.year)] = row.indexObj;
          }
        });
        if (localRows.length > 0) rebuildPl01MemoryMaps();

        const metaList = await callBackend("getPl01IndexMeta");
        if (!Array.isArray(metaList)) return false;
        PL01_INDEX_STATE.lastMetaCheckAt = Date.now();

        let anyUpdated = false;
        const remoteYears = new Set(metaList.map(m => String(m.year)));
        const localYearKeys = Object.keys(PL01_INDEX_STATE.years);
        for (let i = 0; i < localYearKeys.length; i++) {
          const ly = localYearKeys[i];
          if (!remoteYears.has(ly)) {
            delete PL01_INDEX_STATE.years[ly];
            await deleteLocalPl01IndexYear(ly);
            anyUpdated = true;
          }
        }

        for (let i = 0; i < metaList.length; i++) {
          const meta = metaList[i];
          const y = String(meta.year);
          const cached = localByYear.get(y);

          const isStale = forceRefresh || !cached ||
            (Number(meta.updatedAt) !== Number(cached.updatedAt));

          if (!isStale) continue;

          const shardRes = await callBackend("getPl01IndexByYear", y);
          if (shardRes && shardRes.found && shardRes.data) {
            const parsedObj = await decompressManifest(shardRes.data);
            if (parsedObj && parsedObj.files) {
              PL01_INDEX_STATE.years[y] = parsedObj;
              await saveLocalPl01Index(y, shardRes.updatedAt || meta.updatedAt, parsedObj);
              anyUpdated = true;
            }
          }
        }

        if (anyUpdated || !PL01_INDEX_STATE.ready) {
          rebuildPl01MemoryMaps();
        }
        if (anyUpdated && typeof activeTabId !== "undefined" && activeTabId === "tab-plhd" && typeof executeFilter_PL === "function") {
          const inp0 = document.getElementById("field0-pl");
          if (inp0 && inp0.value.includes("#")) {
            executeFilter_PL(false, false, true, true);
          }
        }
        return true;
      } catch (err) {
        console.warn("Lỗi đồng bộ Index_PL01:", err);
        return false;
      } finally {
        PL01_INDEX_STATE.syncing = false;
        PL01_INDEX_STATE.syncPromise = null;
      }
    })();

    PL01_INDEX_STATE.syncPromise = runSync;
    return runSync;
  }

  function parsePl01Query(rawQuery) {
    const raw = String(rawQuery || "").trim();
    const quoteMatch = /"([^"]+)"/.exec(raw);
    let hasKey = false;
    let keyTokens = [];
    let orderedTokens = [];
    let extraEntries = [];
    let keyStartIdxInQ = -1;

    if (quoteMatch) {
      keyTokens = normalizePl01SearchStr(quoteMatch[1]).split(" ").filter(Boolean);
      if (keyTokens.length > 0) {
        hasKey = true;
        const beforeTokens = normalizePl01SearchStr(raw.slice(0, quoteMatch.index)).split(" ").filter(Boolean);
        const afterTokens = normalizePl01SearchStr(raw.slice(quoteMatch.index + quoteMatch[0].length)).split(" ").filter(Boolean);
        keyStartIdxInQ = beforeTokens.length;
        orderedTokens = [...beforeTokens, ...keyTokens, ...afterTokens];
        beforeTokens.forEach((tok, idx) => extraEntries.push({ tok, qIdx: idx }));
        const afterOffset = beforeTokens.length + keyTokens.length;
        afterTokens.forEach((tok, idx) => extraEntries.push({ tok, qIdx: afterOffset + idx }));
      }
    }

    if (!hasKey) {
      orderedTokens = normalizePl01SearchStr(raw).split(" ").filter(Boolean);
    }

    return { hasKey, keyTokens, keyStartIdxInQ, extraEntries, qTokens: orderedTokens };
  }

  function matchSinglePl01Record(record, rawQuery) {
    const parsed = parsePl01Query(rawQuery);
    const { hasKey, keyTokens, keyStartIdxInQ, extraEntries, qTokens } = parsed;
    const nQ = qTokens.length;
    if (nQ === 0) return null;
    if (!hasKey && nQ === 1 && qTokens[0].length < 3) return null;

    const lastIdx = nQ - 1;
    const allEntries = qTokens.map((tok, idx) => ({ tok, qIdx: idx }));
    const activeEntries = filterPl01ActiveEntries(allEntries);

    const isLastTokenIdx = (qIdx) => (qIdx === lastIdx);
    const tokenMatchesAt = (lineTok, qTok, qIdx) =>
      isLastTokenIdx(qIdx) ? lineTok.startsWith(qTok) : (lineTok === qTok);
    const keyTokenMatchesAt = (lineTok, kTok, kIdx) => {
      const qIdx = keyStartIdxInQ + kIdx;
      return (isLastTokenIdx(qIdx) && kTok.length >= 3)
        ? lineTok.startsWith(kTok)
        : (lineTok === kTok);
    };
    const tokenMatchesExact = (lineTok, qTok) => lineTok === qTok;
    const padNeedleAt = (qTok, qIdx, requireMinPrefixLen = false) => {
      const usePrefix = isLastTokenIdx(qIdx) && (!requireMinPrefixLen || qTok.length >= 3);
      return usePrefix ? (" " + qTok) : (" " + qTok + " ");
    };

    const activeQ = activeEntries.map(e => e.tok);
    const minLineHits = (nQ <= 2) ? 1 : Math.max(2, Math.ceil(activeQ.length * 0.6));
    const checkEntries = (nQ >= 3) ? activeEntries : allEntries;
    const maxAllowedSpan = 2 * nQ; // Giới hạn mật độ: Span <= 2N từ

    const tokenWeight = (tok) => {
      let w = Math.min(4, tok.length / 3);
      if (/[0-9]/.test(tok)) w += 1.5;
      if (!PL01_STOP_WORDS.has(tok)) w += 1.0;
      return w;
    };

    const rawMatches = [];

    for (let pIdx = 0; pIdx < record.pages.length; pIdx++) {
      const page = record.pages[pIdx];
      if (hasKey) {
        let pageHasKey = true;
        for (let k = 0; k < keyTokens.length; k++) {
          if (!page.pagePadNorm.includes(padNeedleAt(keyTokens[k], keyStartIdxInQ + k, true))) {
            pageHasKey = false;
            break;
          }
        }
        if (!pageHasKey) continue;
      } else {
        let pageHasAny = false;
        for (let qIdx = 0; qIdx < checkEntries.length; qIdx++) {
          const ce = checkEntries[qIdx];
          if (page.pagePadNorm.includes(padNeedleAt(ce.tok, ce.qIdx))) {
            pageHasAny = true;
            break;
          }
        }
        if (!pageHasAny) continue;
      }

      for (let lIdx = 0; lIdx < page.lines.length; lIdx++) {
        const block = page.lines[lIdx];

        if (hasKey) {
          let lineHasKeyTokens = true;
          for (let k = 0; k < keyTokens.length; k++) {
            if (!block.padNorm.includes(padNeedleAt(keyTokens[k], keyStartIdxInQ + k, true))) {
              lineHasKeyTokens = false;
              break;
            }
          }
          if (!lineHasKeyTokens) continue;
        } else {
          let candidateHits = 0;
          for (let qIdx = 0; qIdx < checkEntries.length; qIdx++) {
            const ce = checkEntries[qIdx];
            if (block.padNorm.includes(padNeedleAt(ce.tok, ce.qIdx))) candidateHits++;
          }
          if (candidateHits < minLineHits) continue;
        }

        const bTokens = tokenizeRawLineWithOffsets(block.raw);
        if (bTokens.length === 0) continue;

        let keyRanges = null;
        if (hasKey) {
          keyRanges = [];
          const nKey = keyTokens.length;
          for (let ti = 0; ti <= bTokens.length - nKey; ti++) {
            let seqOk = true;
            for (let k = 0; k < nKey; k++) {
              if (!keyTokenMatchesAt(bTokens[ti + k].norm, keyTokens[k], k)) {
                seqOk = false;
                break;
              }
            }
            if (seqOk) keyRanges.push({ start: ti, end: ti + nKey - 1 });
          }
          if (keyRanges.length === 0) continue; // Chốt chặn bắt buộc phải có key liền mạch
        }

        // TẦNG 100% (1 TỪ HOẶC CHỈ CÓ KEY KHÔNG TỪ PHỤ)
        if (nQ === 1 || (hasKey && extraEntries.length === 0)) {
          if (hasKey) {
            for (let ki = 0; ki < keyRanges.length; ki++) {
              const kr = keyRanges[ki];
              const keyText = block.raw.slice(bTokens[kr.start].start, bTokens[kr.end].end);
              const matchedNorms = bTokens.slice(kr.start, kr.end + 1).map(t => t.norm);
              const isLastExact = tokenMatchesExact(bTokens[kr.end].norm, keyTokens[keyTokens.length - 1]);
              rawMatches.push({
                pct: 100,
                keyText: keyText,
                normKey: normalizePl01SearchStr(keyText),
                pageNum: page.pageNum,
                contextLine: block.raw,
                matchedWords: matchedNorms,
                score: isLastExact ? (101 + keyTokens.length) : (100 + keyTokens.length)
              });
            }
          } else {
            const qt = qTokens[0];
            for (let ti = 0; ti < bTokens.length; ti++) {
              if (tokenMatchesAt(bTokens[ti].norm, qt, 0)) {
                const isExact = tokenMatchesExact(bTokens[ti].norm, qt);
                const keyText = block.raw.slice(bTokens[ti].start, bTokens[ti].end);
                rawMatches.push({
                  pct: 100,
                  keyText: keyText,
                  normKey: bTokens[ti].norm,
                  pageNum: page.pageNum,
                  contextLine: block.raw,
                  matchedWords: [bTokens[ti].norm],
                  score: isExact ? 106 : 105
                });
              }
            }
          }
          continue;
        }

        // TẦNG 100% (CỤM TỪ >= 2 TỪ): Khớp liền mạch đúng thứ tự
        let foundTier1 = false;
        for (let ti = 0; ti <= bTokens.length - nQ; ti++) {
          let seqOk = true;
          for (let k = 0; k < nQ; k++) {
            const inKey = hasKey && k >= keyStartIdxInQ && k < keyStartIdxInQ + keyTokens.length;
            const ok = inKey
              ? keyTokenMatchesAt(bTokens[ti + k].norm, keyTokens[k - keyStartIdxInQ], k - keyStartIdxInQ)
              : tokenMatchesAt(bTokens[ti + k].norm, qTokens[k], k);
            if (!ok) {
              seqOk = false;
              break;
            }
          }
          if (seqOk) {
            const keyText = block.raw.slice(bTokens[ti].start, bTokens[ti + nQ - 1].end);
            const isLastExact = tokenMatchesExact(bTokens[ti + nQ - 1].norm, qTokens[lastIdx]);
            const matchedNorms = bTokens.slice(ti, ti + nQ).map(t => t.norm);
            rawMatches.push({
              pct: 100,
              keyText: keyText,
              normKey: normalizePl01SearchStr(keyText),
              pageNum: page.pageNum,
              contextLine: block.raw,
              matchedWords: matchedNorms,
              score: isLastExact ? (101 + nQ) : (100 + nQ)
            });
            foundTier1 = true;
          }
        }
        if (foundTier1) continue;

        // TẦNG 75%: Đủ 100% số từ trong Ô Hạng mục VÀ thỏa mãn Span <= 2N
        if (hasKey) {
          const extraPosMap = [];
          let allExtrasPresent = true;
          for (let ei = 0; ei < extraEntries.length; ei++) {
            const ee = extraEntries[ei];
            const posArr = [];
            for (let ti = 0; ti < bTokens.length; ti++) {
              if (tokenMatchesAt(bTokens[ti].norm, ee.tok, ee.qIdx)) posArr.push(ti);
            }
            if (posArr.length === 0) allExtrasPresent = false;
            extraPosMap.push(posArr);
          }

          if (allExtrasPresent) {
            let bestIndices = null;
            let bestMatchedNorms = null;
            let minSpan = Infinity;

            for (let ki = 0; ki < keyRanges.length; ki++) {
              const kr = keyRanges[ki];
              const used = new Set();
              for (let p = kr.start; p <= kr.end; p++) used.add(p);

              const picked = [];
              let valid = true;
              const mid = (kr.start + kr.end) / 2;
              for (let ei = 0; ei < extraPosMap.length; ei++) {
                let bestPos = -1;
                let bestDist = Infinity;
                for (let pi = 0; pi < extraPosMap[ei].length; pi++) {
                  const pos = extraPosMap[ei][pi];
                  if (used.has(pos)) continue;
                  const dist = Math.abs(pos - mid);
                  if (dist < bestDist) {
                    bestDist = dist;
                    bestPos = pos;
                  }
                }
                if (bestPos === -1) { valid = false; break; }
                used.add(bestPos);
                picked.push(bestPos);
              }

              if (valid) {
                const lo = Math.min(kr.start, ...picked);
                const hi = Math.max(kr.end, ...picked);
                const span = hi - lo + 1;
                if (span <= maxAllowedSpan && span < minSpan) {
                  minSpan = span;
                  bestIndices = [lo, hi];
                  bestMatchedNorms = [
                    ...bTokens.slice(kr.start, kr.end + 1).map(t => t.norm),
                    ...picked.map(pos => bTokens[pos].norm)
                  ];
                }
              }
            }

            if (bestIndices) {
              const [lo, hi] = bestIndices;
              const keyText = block.raw.slice(bTokens[lo].start, bTokens[hi].end);
              rawMatches.push({
                pct: 75,
                keyText: keyText,
                normKey: normalizePl01SearchStr(keyText),
                pageNum: page.pageNum,
                contextLine: block.raw,
                matchedWords: bestMatchedNorms || qTokens.slice(),
                score: 78 - Math.min(3, minSpan - nQ)
              });
              continue;
            }
          }

          // TẦNG 50% (KHI CÓ KEY): Đã chắc chắn khớp Key, thiếu hoặc xa từ phụ
          const extraHitsAll = [];
          for (let ei = 0; ei < extraEntries.length; ei++) {
            const ee = extraEntries[ei];
            if (ee.tok.length < 2 || PL01_STOP_WORDS.has(ee.tok)) continue;
            const allowPrefix = isLastTokenIdx(ee.qIdx) && ee.tok.length >= 3;
            for (let ti = 0; ti < bTokens.length; ti++) {
              const hit = allowPrefix
                ? bTokens[ti].norm.startsWith(ee.tok)
                : (bTokens[ti].norm === ee.tok);
              if (hit) {
                extraHitsAll.push({ pos: ti, tok: ee.tok, actualNorm: bTokens[ti].norm, weight: tokenWeight(ee.tok) });
              }
            }
          }

          let bestKr = keyRanges[0];
          let bestStart = bestKr.start;
          let bestEnd = bestKr.end;
          let bestScore = -1;
          let bestMatchedSet = new Set(bTokens.slice(bestKr.start, bestKr.end + 1).map(t => t.norm));

          for (let ki = 0; ki < keyRanges.length; ki++) {
            const kr = keyRanges[ki];
            const seenAll = new Set();
            const seenNearby = new Set();
            const actualMatched = new Set(bTokens.slice(kr.start, kr.end + 1).map(t => t.norm));
            let totalExtraW = 0;
            let lo = kr.start;
            let hi = kr.end;

            for (let hiIdx = 0; hiIdx < extraHitsAll.length; hiIdx++) {
              const eh = extraHitsAll[hiIdx];
              if (eh.pos >= kr.start && eh.pos <= kr.end) continue;
              if (!seenAll.has(eh.tok)) {
                seenAll.add(eh.tok);
                totalExtraW += eh.weight;
              }
              actualMatched.add(eh.actualNorm);

              const candLo = Math.min(lo, eh.pos);
              const candHi = Math.max(hi, eh.pos);
              if ((candHi - candLo + 1) <= maxAllowedSpan) {
                lo = candLo;
                hi = candHi;
                seenNearby.add(eh.tok);
              }
            }

            const candScore = seenNearby.size * 10 + seenAll.size * 5 + totalExtraW - (hi - lo);
            if (candScore > bestScore) {
              bestScore = candScore;
              bestStart = lo;
              bestEnd = hi;
              bestMatchedSet = actualMatched;
            }
          }

          const keyText = block.raw.slice(bTokens[bestStart].start, bTokens[bestEnd].end);
          rawMatches.push({
            pct: 50,
            keyText: keyText,
            normKey: normalizePl01SearchStr(keyText),
            pageNum: page.pageNum,
            contextLine: block.raw,
            matchedWords: Array.from(bestMatchedSet),
            score: 50 + Math.min(20, Math.max(0, bestScore))
          });
          continue;
        }

        // TÌM TẤT CẢ VỊ TRÍ XUẤT HIỆN CỦA TỪNG TỪ KHÓA TRONG BLOCK Ô (KHÔNG CÓ KEY)
        const qPosMap = [];
        let allTokensPresent = true;
        for (let k = 0; k < nQ; k++) {
          const posArr = [];
          for (let ti = 0; ti < bTokens.length; ti++) {
            if (tokenMatchesAt(bTokens[ti].norm, qTokens[k], k)) posArr.push(ti);
          }
          if (posArr.length === 0) allTokensPresent = false;
          qPosMap.push(posArr);
        }

        // TẦNG 75%: Đủ 100% số từ trong Ô Hạng mục VÀ thỏa mãn Span <= 2N
        if (allTokensPresent) {
          let bestIndices = null;
          let bestMatchedNorms = null;
          let minSpan = Infinity;

          if (nQ === 2) {
            for (const p0 of qPosMap[0]) {
              for (const p1 of qPosMap[1]) {
                if (p0 === p1) continue;
                const span = Math.abs(p1 - p0) + 1;
                if (span <= maxAllowedSpan && span < minSpan) {
                  minSpan = span;
                  bestIndices = [Math.min(p0, p1), Math.max(p0, p1)];
                  bestMatchedNorms = [bTokens[p0].norm, bTokens[p1].norm];
                }
              }
            }
          } else {
            const picked = [];
            let valid = true;
            const used = new Set();
            for (let k = 0; k < nQ; k++) {
              const avail = qPosMap[k].find(pos => !used.has(pos));
              if (avail === undefined) { valid = false; break; }
              used.add(avail);
              picked.push(avail);
            }
            if (valid) {
              const lo = Math.min(...picked);
              const hi = Math.max(...picked);
              const span = hi - lo + 1;
              if (span <= maxAllowedSpan) {
                minSpan = span;
                bestIndices = [lo, hi];
                bestMatchedNorms = picked.map(pos => bTokens[pos].norm);
              }
            }
          }

          if (bestIndices) {
            const [lo, hi] = bestIndices;
            const keyText = block.raw.slice(bTokens[lo].start, bTokens[hi].end);
            rawMatches.push({
              pct: 75,
              keyText: keyText,
              normKey: normalizePl01SearchStr(keyText),
              pageNum: page.pageNum,
              contextLine: block.raw,
              matchedWords: bestMatchedNorms || qTokens.slice(),
              score: 78 - Math.min(3, minSpan - nQ)
            });
            continue;
          }
        }

        // TẦNG 50%: Khớp 1 phần số từ VÀ thỏa mãn Span <= 2N
        const matchedHits = [];
        for (let k = 0; k < activeEntries.length; k++) {
          const ae = activeEntries[k];
          const qt = ae.tok;
          if (nQ === 2 && (qt.length < 2 || PL01_STOP_WORDS.has(qt))) continue;
          // Chỉ cho phép khớp tiền tố từ cuối ở tầng khớp 1 phần khi từ cuối >= 3 ký tự để tránh nhiễu
          const allowPrefixInPartial = isLastTokenIdx(ae.qIdx) && qt.length >= 3;
          for (let ti = 0; ti < bTokens.length; ti++) {
            const hit = allowPrefixInPartial
              ? bTokens[ti].norm.startsWith(qt)
              : (bTokens[ti].norm === qt);
            if (hit) {
              matchedHits.push({ pos: ti, qt: qt, actualNorm: bTokens[ti].norm, weight: tokenWeight(qt) });
            }
          }
        }

        if (matchedHits.length >= minLineHits) {
          matchedHits.sort((a, b) => a.pos - b.pos);

          // Cửa sổ trượt tìm cụm con đạt minLineHits thỏa mãn Span <= 2N
          let bestSubRun = null;
          let bestSubScore = -1;

          for (let sIdx = 0; sIdx < matchedHits.length; sIdx++) {
            const seenQ = new Set();
            const seenActual = new Set();
            let totalW = 0;
            for (let eIdx = sIdx; eIdx < matchedHits.length; eIdx++) {
              const span = matchedHits[eIdx].pos - matchedHits[sIdx].pos + 1;
              if (span > maxAllowedSpan) break;

              seenActual.add(matchedHits[eIdx].actualNorm);
              if (!seenQ.has(matchedHits[eIdx].qt)) {
                seenQ.add(matchedHits[eIdx].qt);
                totalW += matchedHits[eIdx].weight;
              }

              if (seenQ.size >= minLineHits) {
                const subScore = seenQ.size * 10 + totalW - span;
                if (subScore > bestSubScore) {
                  bestSubScore = subScore;
                  bestSubRun = {
                    startPos: matchedHits[sIdx].pos,
                    endPos: matchedHits[eIdx].pos,
                    distinctQCount: seenQ.size,
                    matchedWords: Array.from(seenActual),
                    totalW: totalW
                  };
                }
              }
            }
          }

          if (bestSubRun) {
            const keyText = block.raw.slice(bTokens[bestSubRun.startPos].start, bTokens[bestSubRun.endPos].end);
            rawMatches.push({
              pct: 50,
              keyText: keyText,
              normKey: normalizePl01SearchStr(keyText),
              pageNum: page.pageNum,
              contextLine: block.raw,
              matchedWords: bestSubRun.matchedWords,
              score: 50 + Math.min(20, bestSubRun.distinctQCount * 3 + bestSubRun.totalW)
            });
          }
        }
      }
    }

    if (rawMatches.length === 0) return null;

    const groupMap = new Map();
    let bestPct = 0;
    let totalScore = 0;

    rawMatches.forEach(m => {
      if (m.pct > bestPct) bestPct = m.pct;
      totalScore += m.score;

      const gKey = `${m.pct}|${m.normKey}`;
      if (!groupMap.has(gKey)) {
        groupMap.set(gKey, {
          pct: m.pct,
          keyText: m.keyText,
          normKey: m.normKey,
          count: 1,
          firstPage: m.pageNum,
          bestContextLine: m.contextLine,
          bestContextScore: m.matchedWords.length * 10 + m.score,
          matchedWords: m.matchedWords,
          distinctContexts: new Set([m.contextLine])
        });
      } else {
        const g = groupMap.get(gKey);
        g.count++;
        if (m.pageNum < g.firstPage) g.firstPage = m.pageNum;
        g.distinctContexts.add(m.contextLine);
        const ctxScore = m.matchedWords.length * 10 + m.score;
        if (ctxScore > g.bestContextScore) {
          g.bestContextScore = ctxScore;
          g.bestContextLine = m.contextLine;
          g.matchedWords = m.matchedWords;
        }
      }
    });

    const groups = Array.from(groupMap.values()).map(g => ({
      pct: g.pct,
      keyText: g.keyText,
      normKey: g.normKey,
      count: g.count,
      firstPage: g.firstPage,
      bestContextLine: g.bestContextLine,
      matchedWords: g.matchedWords,
      extraLocations: Math.max(0, g.distinctContexts.size - 1)
    }));

    groups.sort((a, b) => (b.pct - a.pct) || (b.count - a.count) || (a.firstPage - b.firstPage));

    const bestTierMatches = rawMatches.filter(m => m.pct === bestPct);
    const hasLowerTier = rawMatches.some(m => m.pct < bestPct);

    return {
      fileId: record.fileId,
      maHD: record.maHD,
      apStart: record.apStart,
      rawQuery: rawQuery.trim(),
      bestPct: bestPct,
      bestCount: bestTierMatches.length,
      hasLowerTier: hasLowerTier,
      totalMatches: rawMatches.length,
      totalScore: bestPct * 10000 + totalScore,
      groups: groups
    };
  }

  function findLongestContiguousRun(sortedIndices) {
    if (!sortedIndices || sortedIndices.length === 0) return [0, 0];
    let bestStart = sortedIndices[0], bestEnd = sortedIndices[0];
    let curStart = sortedIndices[0], curEnd = sortedIndices[0];
    for (let i = 1; i < sortedIndices.length; i++) {
      if (sortedIndices[i] - curEnd <= 2) {
        curEnd = sortedIndices[i];
        if ((curEnd - curStart) > (bestEnd - bestStart)) {
          bestStart = curStart;
          bestEnd = curEnd;
        }
      } else {
        curStart = sortedIndices[i];
        curEnd = sortedIndices[i];
      }
    }
    return [bestStart, bestEnd];
  }

  BV.pl01Index = {
    state: PL01_INDEX_STATE,
    sync: syncPl01Indexes,
    clearLocal: clearLocalPl01Indexes,
    matchContract: matchSinglePl01Record,
    normalize: normalizePl01SearchStr
  };

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
    deleteLocalManifest,
    getPageBitmap,
    savePageBitmap,
    clearFilePageBitmaps,
    rememberLocalFile,
    compressManifest,
    decompressManifest
  };
})();