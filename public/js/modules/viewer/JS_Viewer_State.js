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
  // PL01 YEARLY SHARDED INDEX CACHE & 4-TIER SEARCH ENGINE
  // =========================================================================
  const PL01_STOP_WORDS = new Set(["va", "cac", "tai", "theo"]);
  const PL01_ADMIN_BIGRAMS = new Set([
    "cung cap", "thi cong", "lap dat", "vat tu", "nhan cong", "may moc", "hang muc"
  ]);

  function filterPl01ActiveTokens(qTokens) {
    if (!qTokens || qTokens.length < 3) return qTokens;
    const kept = [];
    for (let i = 0; i < qTokens.length; i++) {
      if (i + 1 < qTokens.length && PL01_ADMIN_BIGRAMS.has(qTokens[i] + " " + qTokens[i + 1])) {
        i++;
        continue;
      }
      if (PL01_STOP_WORDS.has(qTokens[i])) continue;
      kept.push(qTokens[i]);
    }
    return kept.length >= 2 ? kept : qTokens;
  }

  const PL01_INDEX_STATE = {
    ready: false,
    syncing: false,
    syncPromise: null,
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
        if (!Array.isArray(metaList) || metaList.length === 0) return true;

        const currentYear = String(new Date().getFullYear());
        let anyUpdated = false;

        for (let i = 0; i < metaList.length; i++) {
          const meta = metaList[i];
          const y = String(meta.year);
          const cached = localByYear.get(y);

          const isStale = !cached ||
            (Number(meta.updatedAt) !== Number(cached.updatedAt)) ||
            (forceRefresh && y === currentYear);

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

  function matchSinglePl01Record(record, rawQuery) {
    const cleanQ = normalizePl01SearchStr(rawQuery);
    if (!cleanQ) return null;

    const qTokens = cleanQ.split(" ").filter(Boolean);
    const nQ = qTokens.length;
    if (nQ === 0) return null;
    if (nQ === 1 && qTokens[0].length < 3) return null;

    const isSingleWord = (nQ === 1);
    const tokenMatches = (lineTok, qTok) => isSingleWord ? lineTok.startsWith(qTok) : (lineTok === qTok);
    const tokenMatchesExact = (lineTok, qTok) => lineTok === qTok;
    const padNeedle = (qTok) => isSingleWord ? (" " + qTok) : (" " + qTok + " ");

    const activeQ = filterPl01ActiveTokens(qTokens);
    const minLineHits = (nQ === 2) ? 1 : Math.max(2, Math.ceil(activeQ.length * 0.6));
    const checkTokens = (nQ >= 3) ? activeQ : qTokens;
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
      let pageHasAny = false;
      for (let qIdx = 0; qIdx < checkTokens.length; qIdx++) {
        if (page.pagePadNorm.includes(padNeedle(checkTokens[qIdx]))) {
          pageHasAny = true;
          break;
        }
      }
      if (!pageHasAny) continue;

      for (let lIdx = 0; lIdx < page.lines.length; lIdx++) {
        const block = page.lines[lIdx];

        let candidateHits = 0;
        for (let qIdx = 0; qIdx < checkTokens.length; qIdx++) {
          if (block.padNorm.includes(padNeedle(checkTokens[qIdx]))) candidateHits++;
        }
        if (candidateHits < minLineHits) continue;

        const bTokens = tokenizeRawLineWithOffsets(block.raw);
        if (bTokens.length === 0) continue;

        // TẦNG 100% (1 TỪ >= 3 ký tự, Prefix Match)
        if (nQ === 1) {
          const qt = qTokens[0];
          for (let ti = 0; ti < bTokens.length; ti++) {
            if (tokenMatches(bTokens[ti].norm, qt)) {
              const isExact = tokenMatchesExact(bTokens[ti].norm, qt);
              const keyText = block.raw.slice(bTokens[ti].start, bTokens[ti].end);
              rawMatches.push({
                pct: 100,
                keyText: keyText,
                normKey: bTokens[ti].norm,
                pageNum: page.pageNum,
                contextLine: block.raw,
                matchedWords: [bTokens[ti].norm],
                score: isExact ? 105 : 100
              });
            }
          }
          continue;
        }

        // TẦNG 100% (CỤM TỪ >= 2 TỪ): Khớp liền mạch đúng thứ tự (Span = N <= 2N)
        let foundTier1 = false;
        for (let ti = 0; ti <= bTokens.length - nQ; ti++) {
          let seqOk = true;
          for (let k = 0; k < nQ; k++) {
            if (!tokenMatches(bTokens[ti + k].norm, qTokens[k])) {
              seqOk = false;
              break;
            }
          }
          if (seqOk) {
            const keyText = block.raw.slice(bTokens[ti].start, bTokens[ti + nQ - 1].end);
            rawMatches.push({
              pct: 100,
              keyText: keyText,
              normKey: normalizePl01SearchStr(keyText),
              pageNum: page.pageNum,
              contextLine: block.raw,
              matchedWords: qTokens.slice(),
              score: 100 + nQ
            });
            foundTier1 = true;
          }
        }
        if (foundTier1) continue;

        // TÌM TẤT CẢ VỊ TRÍ XUẤT HIỆN CỦA TỪNG TỪ KHÓA TRONG BLOCK Ô
        const qPosMap = [];
        let allTokensPresent = true;
        for (let k = 0; k < nQ; k++) {
          const posArr = [];
          for (let ti = 0; ti < bTokens.length; ti++) {
            if (tokenMatches(bTokens[ti].norm, qTokens[k])) posArr.push(ti);
          }
          if (posArr.length === 0) allTokensPresent = false;
          qPosMap.push(posArr);
        }

        // TẦNG 75%: Đủ 100% số từ trong Ô Hạng mục VÀ thỏa mãn Span <= 2N
        if (allTokensPresent) {
          let bestIndices = null;
          let minSpan = Infinity;

          if (nQ === 2) {
            for (const p0 of qPosMap[0]) {
              for (const p1 of qPosMap[1]) {
                if (p0 === p1) continue;
                const span = Math.abs(p1 - p0) + 1;
                if (span <= maxAllowedSpan && span < minSpan) {
                  minSpan = span;
                  bestIndices = [Math.min(p0, p1), Math.max(p0, p1)];
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
              matchedWords: qTokens.slice(),
              score: 78 - Math.min(3, minSpan - nQ)
            });
            continue;
          }
        }

        // TẦNG 60% (>= 3 TỪ) HOẶC TẦNG 50% (2 TỪ): Khớp 1 phần số từ VÀ thỏa mãn Span <= 2N
        const matchedHits = [];
        for (let k = 0; k < activeQ.length; k++) {
          const qt = activeQ[k];
          if (nQ === 2 && (qt.length < 2 || PL01_STOP_WORDS.has(qt))) continue;
          for (let ti = 0; ti < bTokens.length; ti++) {
            if (tokenMatches(bTokens[ti].norm, qt)) {
              matchedHits.push({ pos: ti, qt: qt, weight: tokenWeight(qt) });
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
            let totalW = 0;
            for (let eIdx = sIdx; eIdx < matchedHits.length; eIdx++) {
              const span = matchedHits[eIdx].pos - matchedHits[sIdx].pos + 1;
              if (span > maxAllowedSpan) break;

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
                    matchedWords: Array.from(seenQ),
                    totalW: totalW
                  };
                }
              }
            }
          }

          if (bestSubRun) {
            const keyText = block.raw.slice(bTokens[bestSubRun.startPos].start, bTokens[bestSubRun.endPos].end);
            const isHalf = (nQ === 2 && bestSubRun.matchedWords.length === 1);
            const tierPct = isHalf ? 50 : 60;
            const baseScore = isHalf ? 50 : 60;

            rawMatches.push({
              pct: tierPct,
              keyText: keyText,
              normKey: normalizePl01SearchStr(keyText),
              pageNum: page.pageNum,
              contextLine: block.raw,
              matchedWords: bestSubRun.matchedWords,
              score: baseScore + Math.min(14, bestSubRun.totalW)
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
    getPageBitmap,
    savePageBitmap,
    clearFilePageBitmaps,
    rememberLocalFile,
    compressManifest,
    decompressManifest
  };
})();