// =========================================================================
// BCONS DOCUMENT SLICING VIEWER - HỢP NHẤT NGUYÊN BẢN 100% TỪ 4 FILE GỐC
// (js_state_storage.js + js_search_engine.js + js_pdf_pipeline.js + js_ui_events.js)
// =========================================================================

(() => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // =========================================================================
  // CẦU NỐI TỰ ĐỘNG VỀ BACKEND BCONS-VIEWER GỐC (ĐÃ BẬT SẴN CLOUD VISION AI)
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
          fetch(GAS_WEB_APP_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: prop, args: args })
          })
          .then(res => res.json())
          .then(res => {
            if (res.ok) {
              if (onSuccess) onSuccess(res.data);
            } else {
              if (onFailure) onFailure(new Error(res.error || "Lỗi Server GAS"));
            }
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
  // PHẦN 1: STATE & STORAGE (NGUYÊN BẢN js_state_storage.js)
  // =========================================================================
  let currentManifest = null;
  let currentFileId = null;
  let currentScale = 1.0;
  let isDragging = false;
  let startX = 0, startY = 0;
  let scrollLeftStart = 0, scrollTopStart = 0;

  let searchResults = [];
  let currentMatchIndex = -1;
  let pageObserver = null;
  let lastSearchedQuery = "";

  const LARGE_FILE_THRESHOLD_MB = 6.0;
  let currentFileSizeMB = 0;

  const DB_NAME = "Bcons_Prv_Cache_DB";
  const PAGE_STORE = "page_bitmaps";
  const PDF_STORE = "pdf_binaries";
  const MAX_LOCAL_FILES = 3;
  let dbPromise = null;
  let cachedRenderScale = 1;
  const STORE_NAME = "manifests_v13_vision";
  const MAX_RAM_FILES = 5;
  const SESSION_LRU_KEYS = [];
  const SESSION_MANIFEST_CACHE = {};

  let currentSessionEpoch = 0;
  let activeFetchAbortController = null;
  let currentFileName = "";
  let cachedDriveToken = null;
  let driveTokenExpiresAt = 0;
  let currentTargetFolderId = "1qK7-AXau_htyfxhmllXLCp2w0dkb6d40";

  let currentPdfDoc = null;
  let pdfLoadPromise = null;

  let isZooming = false;
  let scrollLock = false;
  let zoomDebounceTimer = null;
  let sharpenToken = 0;
  let jumpToken = 0;
  const activeRenderTasks = new Map();

  let bgAudioCtx = null;
  let bgSourceNode = null;

  function scalesEqual(a, b) {
    return Math.abs(Number(a) - Number(b)) < 0.004;
  }

  function putSessionCache(fileId, manifest) {
    if (!fileId || !manifest) return;
    const idx = SESSION_LRU_KEYS.indexOf(fileId);
    if (idx !== -1) SESSION_LRU_KEYS.splice(idx, 1);
    SESSION_LRU_KEYS.unshift(fileId);
    SESSION_MANIFEST_CACHE[fileId] = manifest;

    while (SESSION_LRU_KEYS.length > MAX_RAM_FILES) {
      const evictedId = SESSION_LRU_KEYS.pop();
      if (evictedId && evictedId !== currentFileId) {
        delete SESSION_MANIFEST_CACHE[evictedId];
        console.log(`%c🧹 [LRU CACHE] Giải phóng RAM file: ${evictedId} (Đã có IndexedDB sao lưu)`, "color: #78909c;");
      }
    }
  }

  function getSessionCache(fileId) {
    if (!SESSION_MANIFEST_CACHE[fileId]) return null;
    const idx = SESSION_LRU_KEYS.indexOf(fileId);
    if (idx !== -1) {
      SESSION_LRU_KEYS.splice(idx, 1);
      SESSION_LRU_KEYS.unshift(fileId);
    }
    return SESSION_MANIFEST_CACHE[fileId];
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
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
      req.onerror = function() { dbPromise = null; reject(req.error); };
      req.onblocked = function() {
        console.warn("IndexedDB blocked: Vui lòng đóng các tab khác đang mở ứng dụng.");
      };
    });
    return dbPromise;
  }

  function bitmapKey(fileId, pdfPage, scale, fitScale) {
    const f = Math.round(Number(fitScale || baseFitScale || 1) * 100);
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
    if (!scalesEqual(scale, cachedRenderScale)) return Promise.resolve(null);
    return idbGet(PAGE_STORE, bitmapKey(fileId, pdfPage, scale));
  }

  function savePageBitmap(fileId, pdfPage, scale, canvas) {
    if (!fileId || String(fileId).indexOf("local_") === 0 || !canvas) return Promise.resolve(false);
    if (!scalesEqual(scale, cachedRenderScale)) return Promise.resolve(false);
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

  function startBackgroundKeepAlive() {
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;

      if (!bgAudioCtx) {
        bgAudioCtx = new AudioCtxClass();
        const buffer = bgAudioCtx.createBuffer(1, bgAudioCtx.sampleRate, bgAudioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
          data[i] = (Math.random() * 2 - 1) * 0.00002;
        }
        bgSourceNode = bgAudioCtx.createBufferSource();
        bgSourceNode.buffer = buffer;
        bgSourceNode.loop = true;
        bgSourceNode.connect(bgAudioCtx.destination);
        bgSourceNode.start();
      }
      
      if (bgAudioCtx.state === "suspended") {
        bgAudioCtx.resume().catch(() => {});
      }
    } catch (e) {}
  }

  function stopBackgroundKeepAlive() {
    try {
      if (bgAudioCtx && bgAudioCtx.state === "running") {
        bgAudioCtx.suspend();
      }
    } catch (e) {}
  }

  let softProgressTimer = null;
  let currentLoaderPct = 0;

  function updateLoaderProgress(percent) {
    const fill = document.getElementById("viewer-progress-fill");
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    currentLoaderPct = p;
    if (fill) fill.style.width = p.toFixed(2) + "%"; // 👈 Dùng số thập phân cho thanh trôi mịn
  }

  function stopSoftProgress() {
    if (softProgressTimer) {
      clearInterval(softProgressTimer);
      softProgressTimer = null;
    }
  }

  // Đường cong tiệm cận: chạy êm lúc đầu, chậm dần về trần capPct nhưng KHÔNG BAO GIỜ đứng chết
  function startSoftProgress(fromPct, capPct = 35, factor = 0.035) {
    stopSoftProgress();
    let cur = Math.max(currentLoaderPct, fromPct);
    updateLoaderProgress(cur);
    softProgressTimer = setInterval(() => {
      cur += (capPct - cur) * factor;
      updateLoaderProgress(cur);
      if (capPct - cur < 0.05) stopSoftProgress();
    }, 60);
  }

  function showLoading(msg, initialPercent = 0) {
    stopSoftProgress();
    const txt = document.getElementById("loading-text");
    const ov = document.getElementById("loading-overlay");
    if (txt) txt.textContent = msg;
    if (initialPercent !== null) updateLoaderProgress(initialPercent);
    if (ov) ov.style.display = "flex";
  }

  function hideLoading() {
    stopSoftProgress();
    const ov = document.getElementById("loading-overlay");
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

  function updateProcessProgress(percent, stageText, isSuccess = false) {
    stopSoftProgress();
    const box = document.getElementById("proc-progress-box");
    const fill = document.getElementById("proc-bar-fill");
    const txtStage = document.getElementById("proc-stage-text");
    const txtPercent = document.getElementById("proc-percent-text");

    if (!box || !fill) return;
    box.style.display = "flex";

    const p = Math.max(0, Math.min(100, Math.round(percent)));
    updateLoaderProgress(Math.max(currentLoaderPct, p));
    fill.style.width = p + "%";
    if (txtPercent) txtPercent.textContent = p + "%";
    if (txtStage) txtStage.textContent = stageText;

    if (isSuccess) {
      fill.classList.add("success");
      if (txtPercent) txtPercent.style.color = "#00e676";
      if (txtStage) txtStage.textContent = "✔ " + stageText;
      setAntiExitGuard(false);
      setTimeout(() => {
        box.style.display = "none";
        fill.classList.remove("success");
        if (txtPercent) txtPercent.style.color = "#FFBA08";
      }, 2500);
    }
  }

  // =========================================================================
  // PHẦN 2: SEARCH ENGINE (NGUYÊN BẢN js_search_engine.js)
  // =========================================================================
  function isSingleTechnicalCode(query) {
    const trimmed = query.trim();
    if (/\s+/.test(trimmed)) return false;
    const q = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const hasLetter = /[A-Z]/.test(q);
    const hasDigit = /[0-9]/.test(q);
    return (hasLetter && hasDigit) || (/^[A-Z]{2,5}$/.test(q) && trimmed === trimmed.toUpperCase());
  }

  function cleanCodeToken(str) {
    if (!str) return "";
    return str.toLowerCase()
              .replace(/\?/g, "7")
              .replace(/0/g, "o")
              .replace(/1/g, "l")
              .replace(/i/g, "l")
              .replace(/5/g, "s")
              .replace(/8/g, "b")
              .replace(/[^a-z0-9]/g, "");
  }

  function cleanNaturalToken(str) {
    if (!str) return "";
    return str
      .normalize("NFC")
      .replace(/[\u201C\u201D\u2018\u2019"']/g, "")
      .replace(/²/g, "2")
      .replace(/³/g, "3")
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
      .replace(/[^a-z0-9]/g, "");
  }

  function cleanSentenceNatural(str) {
    if (!str) return "";
    return str
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
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEditDistanceOne(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;

    if (Math.min(la, lb) === 1) {
      return la !== lb && Math.max(la, lb) === 2 && (a.includes(b) || b.includes(a));
    }

    let i = 0, j = 0, diffs = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) {
        i++; j++;
      } else {
        diffs++;
        if (diffs > 1) return false;
        if (la > lb) i++;
        else if (lb > la) j++;
        else { i++; j++; }
      }
    }
    if (i < la || j < lb) diffs++;
    return diffs <= 1;
  }

  function isSoftOcrTokenMatch(strToken, queryToken) {
    if (!strToken || !queryToken) return false;
    if (strToken === queryToken) return true;

    // 1. BẮT BUỘC chữ cái đầu tiên phải khớp chính xác (chặn công <-> móng, bàn <-> sàn...)
    if (strToken[0] !== queryToken[0]) return false;

    // 2. Không chạy mờ với từ quá ngắn (< 4 ký tự như tru, ga, cot...)
    if (strToken.length < 4 || queryToken.length < 4) return false;

    const digitsA = strToken.replace(/[^0-9]/g, "");
    const digitsB = queryToken.replace(/[^0-9]/g, "");
    if (digitsA !== digitsB) return false;

    return isEditDistanceOne(strToken, queryToken);
  }

  async function executeSearch() {
    const rawQuery = document.getElementById("ai-search-input").value;
    if (!rawQuery || !rawQuery.trim() || !currentFileId || !currentManifest) return;

    lastSearchedQuery = rawQuery.trim();
    clearSearchState();

    const qTokens = rawQuery.split(/\s+/).map(cleanNaturalToken).filter(Boolean);
    const numTokens = qTokens.length;
    if (numTokens === 0) return;

    const isCodeMode = isSingleTechnicalCode(rawQuery);
    const matches = [];

    function isOverlapping(m1, m2) {
      if (m1.page !== m2.page) return false;
      const b1 = m1.boxes ? m1.boxes[0] : m1;
      const b2 = m2.boxes ? m2.boxes[0] : m2;
      const yDiff = Math.abs(b1.y - b2.y);
      const maxHeight = Math.max(b1.h, b2.h);
      if (yDiff > maxHeight * 0.7) return false;

      const xOverlap = Math.min(b1.x + b1.w, b2.x + b2.w) - Math.max(b1.x, b2.x);
      const minWidth = Math.min(b1.w, b2.w);
      return xOverlap > (minWidth * 0.35);
    }

    function addMatch(newMatch) {
      newMatch.isCode = isCodeMode;
      for (let i = 0; i < matches.length; i++) {
        if (isOverlapping(matches[i], newMatch)) return;
      }
      matches.push(newMatch);
    }

    function isStrictTokenMatch(strToken, queryToken) {
      return strToken === queryToken;
    }
    function isPrefixTokenMatch(strToken, queryToken) {
      if (isStrictTokenMatch(strToken, queryToken)) return true;
      return strToken.startsWith(queryToken);
    }
    function isFuzzyTokenMatch(strToken, queryToken) {
      if (strToken === queryToken) return true;
      const qLen = queryToken.length;
      const sLen = strToken.length;
      if (qLen >= 2 && /[0-9]/.test(queryToken) && /[0-9]/.test(strToken)) {
        if (qLen - sLen === 1 && (queryToken.endsWith(strToken) || queryToken.startsWith(strToken))) return true;
      }
      if (qLen >= 4 && sLen === qLen - 1 && queryToken.startsWith(strToken)) return true;
      return false;
    }
    function isFuzzyPrefixMatch(strToken, queryToken) {
      if (isFuzzyTokenMatch(strToken, queryToken)) return true;
      return strToken.startsWith(queryToken);
    }

    const totalPages = currentManifest.numPages || currentManifest.pages.length;
      const fallbackAppendixStart = Math.max(1, totalPages - 6);
      const appendixStart = currentManifest.appendixStartPage || fallbackAppendixStart;

      // HÀM KIỂM TRA RANH GIỚI CỘT BẢNG (CHẶN NỐI TỪ XUYÊN VÁCH NGĂN CỘT)
      function isCrossColumnBoundary(items, leftIt, rightIt, isAppendix) {
        const leftEnd = leftIt[1] + leftIt[3];
        const rightStart = rightIt[1];
        const gap = rightStart - leftEnd;
        const avgH = Math.max(6, (leftIt[4] + rightIt[4]) / 2);

        // 1. Ngưỡng trần cứng: Thu hẹp từ 150 xuống mức hợp lý
        const hardMaxGap = isAppendix ? Math.max(18, avgH * 1.9) : 65;
        if (gap > hardMaxGap) return true;

        // 2. Dấu cách chuẩn siêu hẹp trong cùng câu -> Cho qua ngay
        if (gap <= Math.max(3.5, avgH * 0.42)) return false;

        // 3. Vùng nghi ngờ: Quét Rãnh dọc cục bộ (±120pt theo Y để an toàn nếu giấy scan hơi nghiêng)
        const midX = (leftEnd + rightStart) / 2;
        const yCenter = (leftIt[2] + rightIt[2]) / 2;

        let crossingWords = 0;
        let alignedRightColCount = 0;
        const distinctY = new Set();

        for (let idx = 0; idx < items.length; idx++) {
          const t = items[idx];
          if (!t[0] || !t[0].trim()) continue;

          const yDiff = Math.abs(t[2] - yCenter);
          if (yDiff > 5 && yDiff <= 120) {
            distinctY.add(Math.round(t[2] / 6));

            // Có chữ nào trên dòng lân cận vắt ngang qua khe giữa 2 từ không?
            if (t[1] < midX - 1.5 && (t[1] + t[3]) > midX + 1.5) {
              crossingWords++;
            }
            // Có chữ nào trên dòng lân cận căn thẳng hàng dọc với mép trái của rightIt không?
            if (Math.abs(t[1] - rightStart) <= 3.5) {
              alignedRightColCount++;
            }
          }
        }

        // Văn bản hợp đồng chính (căn đều 2 lề): Chỉ chặn nếu thực sự là bảng biểu thẳng cột rõ ràng
        if (!isAppendix) {
          return (distinctY.size >= 2 && crossingWords === 0 && alignedRightColCount >= 2);
        }

        // Trang Phụ lục (bảng biểu): Có rãnh dọc trống hoặc thẳng hàng mép cột bên phải -> Chặn nối xuyên cột
        if (distinctY.size >= 2) {
          if (crossingWords === 0 && (alignedRightColCount >= 1 || gap > avgH * 0.85)) return true;
          if (crossingWords <= 1 && alignedRightColCount >= 2 && gap > avgH * 0.65) return true;
        }

        // Dự phòng cho bảng chỉ có 1-2 dòng trên Phụ lục
        if (gap > Math.max(12, avgH * 1.25)) return true;

        return false;
      }

      currentManifest.pages.forEach(function(p) {
      if (!p.textItems || p.textItems.length === 0) return;

      const isAppendixPage = (p.pageNum >= appendixStart) || (p.textItems.length > 250);
      const matchedIndicesInA = new Set();

      if (numTokens === 1) {
        const targetWord = qTokens[0];
        p.textItems.forEach(function(it) {
          if (!it[0]) return;
          const pure = cleanNaturalToken(it[0]);
          if (!pure) return;
          const solidPure = pure.replace(/\s+/g, "");

          const isMatched = isAppendixPage 
                          ? isPrefixTokenMatch(solidPure, targetWord) 
                          : isFuzzyPrefixMatch(solidPure, targetWord);

          if (isMatched) {
            let widthRatio = 1;
            if (!isAppendixPage || !/[0-9]/.test(solidPure)) {
              widthRatio = targetWord.length / Math.max(1, solidPure.length);
            }
            const b = { x: it[1], y: it[2], w: Math.max(10, widthRatio * it[3]), h: it[4] };
            addMatch({
              page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
              x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
            });
          } else if (solidPure.length > targetWord.length) {
            let startIdx = 0;
            while ((startIdx = solidPure.indexOf(targetWord, startIdx)) !== -1) {
              const isNumeric = /[0-9]/.test(solidPure);
              const beforeChar = startIdx > 0 ? it[0][startIdx - 1] : " ";
              const isStartOfWord = !(/[a-zA-Z]/.test(beforeChar));

              if (isStartOfWord || isNumeric) {
                const startRatio = startIdx / Math.max(1, solidPure.length);
                let widthRatio = targetWord.length / Math.max(1, solidPure.length);
                if (isAppendixPage && isNumeric && startIdx + targetWord.length === solidPure.length) {
                  widthRatio = 1 - startRatio;
                }
                const b = { 
                  x: it[1] + (startRatio * it[3]), 
                  y: it[2], 
                  w: Math.max(14, widthRatio * it[3]), 
                  h: it[4] 
                };
                addMatch({
                  page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
                  x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
                });
              }
              startIdx += targetWord.length;
            }
          }
        });
      } 
      else {
        const cleanQuery = cleanSentenceNatural(rawQuery);

        p.textItems.forEach(function(it, idx) {
          if (!it[0]) return;
          const itClean = cleanSentenceNatural(it[0]);
          let startPos = 0;
          while ((startPos = itClean.indexOf(cleanQuery, startPos)) !== -1) {
            const beforeChar = startPos > 0 ? itClean[startPos - 1] : " ";
            if (beforeChar === " ") {
              const startRatio = startPos / Math.max(1, itClean.length);
              const widthRatio = cleanQuery.length / Math.max(1, itClean.length);
              const b = { x: it[1] + (startRatio * it[3]), y: it[2], w: Math.max(20, widthRatio * it[3]), h: it[4] };
              addMatch({
                page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
                x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
              });
              matchedIndicesInA.add(idx);
            }
            startPos += cleanQuery.length;
          }
        });

        for (let i = 0; i < p.textItems.length; i++) {
          if (matchedIndicesInA.has(i)) continue;

          const firstIt = p.textItems[i];
          if (!firstIt[0]) continue;
          const firstClean = cleanNaturalToken(firstIt[0]).replace(/\s+/g, "");
          if (!firstClean) continue;

          let isFirstMatch = false;
          let firstIsFuzzy = false;
          let firstStartRatio = 0;

          if (isAppendixPage) {
            if (isStrictTokenMatch(firstClean, qTokens[0])) {
              isFirstMatch = true;
            } else if (firstClean.endsWith(qTokens[0]) && /[0-9]/.test(firstClean)) {
              isFirstMatch = true;
              firstStartRatio = firstClean.indexOf(qTokens[0]) / firstClean.length;
            }
          } else {
            if (isFuzzyTokenMatch(firstClean, qTokens[0])) {
              isFirstMatch = true;
            } else if (isSoftOcrTokenMatch(firstClean, qTokens[0])) {
              isFirstMatch = true;
              firstIsFuzzy = true;
            }
          }

          if (!isFirstMatch) continue;

          let matchedList = [{ it: firstIt, clean: firstClean, sR: firstStartRatio, isWrap: false }];
          let currentItemIdx = i;
          let sequenceValid = true;
          let lineBreakCount = 0;
          let fuzzyUsed = firstIsFuzzy ? 1 : 0;
          let strictCount = firstIsFuzzy ? 0 : 1;
          let maxStrictLen = firstIsFuzzy ? 0 : firstClean.length;
          const maxFuzzy = 1;

          for (let k = 1; k < numTokens; k++) {
            let foundNext = false;
            const isLastSearchToken = (k === numTokens - 1);
            const prevItem = matchedList[matchedList.length - 1].it;

            // 1. Quét tìm trên cùng một dòng ngang (CHỐNG NHẢY XUYÊN CỘT BẢNG)
            let tempIdx = currentItemIdx;
            const maxStep = 3;

            while (++tempIdx < p.textItems.length && tempIdx <= currentItemIdx + maxStep) {
              const it = p.textItems[tempIdx];
              const clean = cleanNaturalToken(it[0]).replace(/\s+/g, "");
              if (!clean) continue;

              let isStrictOrPrefix = false;
              if (isAppendixPage) {
                isStrictOrPrefix = isLastSearchToken ? isPrefixTokenMatch(clean, qTokens[k]) : isStrictTokenMatch(clean, qTokens[k]);
              } else {
                isStrictOrPrefix = isLastSearchToken ? isFuzzyPrefixMatch(clean, qTokens[k]) : isFuzzyTokenMatch(clean, qTokens[k]);
              }

              const isSoft = !isAppendixPage && !isStrictOrPrefix && (fuzzyUsed < maxFuzzy) && isSoftOcrTokenMatch(clean, qTokens[k]);

              if (isStrictOrPrefix || isSoft) {
                const yDiff = Math.abs(it[2] - prevItem[2]);
                const gap = it[1] - (prevItem[1] + prevItem[3]);

                if (gap >= -5 && yDiff <= 6 && !isCrossColumnBoundary(p.textItems, prevItem, it, isAppendixPage)) {
                  foundNext = true;
                  currentItemIdx = tempIdx;
                  matchedList.push({ it: it, clean: clean, sR: 0, isWrap: false });
                  if (!isSoft) {
                    strictCount++;
                    if (clean.length > maxStrictLen) maxStrictLen = clean.length;
                  } else {
                    fuzzyUsed++;
                  }
                  break;
                } else {
                  // Đã chạm vách ngăn cột bên phải -> Dừng tìm ngang để nhường cho logic xuống dòng
                  break;
                }
              } else {
                break;
              }
            }

            // 2. NGOẠI LỆ XUỐNG DÒNG (GIỮ NGUYÊN LOGIC SOFT OCR + CHẶN VÁCH NGĂN CỘT)
            if (!foundNext && lineBreakCount < 2 && isAppendixPage) {
              tempIdx = currentItemIdx;
              const maxLookahead = Math.min(p.textItems.length - 1, currentItemIdx + 35);

              while (++tempIdx <= maxLookahead) {
                const it = p.textItems[tempIdx];
                const clean = cleanNaturalToken(it[0]).replace(/\s+/g, "");
                if (!clean) continue;

                const isStrictOrPrefix = isLastSearchToken ? isPrefixTokenMatch(clean, qTokens[k]) : isStrictTokenMatch(clean, qTokens[k]);
                const isSoft = !isAppendixPage && !isStrictOrPrefix && (fuzzyUsed < maxFuzzy) && isSoftOcrTokenMatch(clean, qTokens[k]);

                if (isStrictOrPrefix || isSoft) {
                  const yDrop = prevItem[2] - it[2];
                  const isWrapLeft = it[1] < (prevItem[1] + prevItem[3] - 10);

                  let isLastWordOfLine1 = true;
                  for (let m = currentItemIdx + 1; m < tempIdx; m++) {
                    const midIt = p.textItems[m];
                    const midClean = cleanNaturalToken(midIt[0]);
                    if (!midClean) continue;

                    const gapRight = midIt[1] - (prevItem[1] + prevItem[3]);
                    if (Math.abs(midIt[2] - prevItem[2]) <= 4 && gapRight >= -3 && gapRight <= 8.5 && !isCrossColumnBoundary(p.textItems, prevItem, midIt, isAppendixPage)) {
                      isLastWordOfLine1 = false;
                      break;
                    }
                  }

                  let isFirstWordOfLine2 = true;
                  for (let prevIdx = tempIdx - 1; prevIdx >= currentItemIdx; prevIdx--) {
                    const pIt = p.textItems[prevIdx];
                    const pClean = cleanNaturalToken(pIt[0]);
                    if (!pClean) continue;

                    const isSttFormat = /^(?:[0-9]{1,4}|[a-z]|[ivx]{1,5})$/i.test(pClean);
                    const isLeftMargin = pIt[1] < (p.width * 0.25);
                    if (isSttFormat && isLeftMargin) continue;

                    const gapLeft = it[1] - (pIt[1] + pIt[3]);
                    if (Math.abs(pIt[2] - it[2]) <= 4 && gapLeft >= -5 && gapLeft <= 15 && !isCrossColumnBoundary(p.textItems, pIt, it, isAppendixPage)) {
                      isFirstWordOfLine2 = false;
                      break;
                    }
                  }

                  // TỐI ƯU 1: Siết chặt khoảng cách nhảy dòng tối đa trong trang Bảng biểu (Phụ lục)
                  const maxYDrop = isAppendixPage ? 22 : 45;

                  if (yDrop >= 3 && yDrop <= maxYDrop && isWrapLeft && isLastWordOfLine1 && isFirstWordOfLine2) {
                    
                    // TỐI ƯU 2: KIỂM TRA CHỐNG NHẢY CÓC (ANTI-SKIPPING)
                    let hasInterveningLine = false;
                    for (let interIdx = currentItemIdx + 1; interIdx < tempIdx; interIdx++) {
                      const interIt = p.textItems[interIdx];
                      if (!interIt[0] || !interIt[0].trim()) continue;
                      
                      // Nếu có một từ nằm chen ngang ở giữa khoảng không của 2 hàng -> Bị nhảy cóc
                      // Trục Y của PDF đi từ dưới lên, nên hàng trên (prevItem) có tọa độ Y LỚN HƠN hàng dưới (it)
                      if (interIt[2] < prevItem[2] - 5 && interIt[2] > it[2] + 5) {
                        hasInterveningLine = true;
                        break;
                      }
                    }

                    if (!hasInterveningLine) {
                      foundNext = true;
                      lineBreakCount++;
                      currentItemIdx = tempIdx;
                      matchedList.push({ it: it, clean: clean, sR: 0, isWrap: true });
                      if (!isSoft) {
                        strictCount++;
                        if (clean.length > maxStrictLen) maxStrictLen = clean.length;
                      } else {
                        fuzzyUsed++;
                      }
                      break;
                    }
                  }
                }
              }
            }

            if (!foundNext) {
              sequenceValid = false;
              break;
            }
          }

          const isPairSafe = (numTokens > 2) || (fuzzyUsed === 0) || (maxStrictLen >= 2);

          if (sequenceValid && matchedList.length === numTokens && strictCount >= 1 && fuzzyUsed <= maxFuzzy && isPairSafe) {
            const lines = [];
            let currentLine = [];
            matchedList.forEach(item => {
              if (item.isWrap && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = [];
              }
              currentLine.push(item);
            });
            if (currentLine.length > 0) lines.push(currentLine);

            const boxes = lines.map((lineTokens, lIdx) => {
              const isLastLine = (lIdx === lines.length - 1);
              const startItem = lineTokens[0];
              const endItem = lineTokens[lineTokens.length - 1];

              const exactX = startItem.it[1] + (startItem.sR * startItem.it[3]);
              let exactEndX = endItem.it[1] + endItem.it[3];

              if (isLastLine) {
                const lastTargetToken = qTokens[numTokens - 1];
                let endRatio = Math.min(1, lastTargetToken.length / Math.max(1, endItem.clean.length));
                if (isAppendixPage && /[0-9]/.test(endItem.clean)) endRatio = 1;
                exactEndX = endItem.it[1] + (endRatio * endItem.it[3]);
              }

              const minY = Math.min(...lineTokens.map(t => t.it[2]));
              const maxH = Math.max(...lineTokens.map(t => t.it[4]));

              return { x: exactX, y: minY, w: Math.max(16, exactEndX - exactX), h: maxH };
            });

            addMatch({
              page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
              x: boxes[0].x, y: boxes[0].y, w: boxes[0].w, h: boxes[0].h, boxes: boxes
            });
          }
        }
      }

      if (isCodeMode) {
          const targetCode = cleanCodeToken(rawQuery);
          for (let i = 0; i < p.textItems.length - 1; i++) {
            const it1 = p.textItems[i];
            const it2 = p.textItems[i + 1];
            const c1 = cleanCodeToken(it1[0]);
            const c2 = cleanCodeToken(it2[0]);

            const gap = it2[1] - (it1[1] + it1[3]);
            const yDiff = Math.abs(it2[2] - it1[2]);

            if (gap >= -3 && gap <= 14 && yDiff <= 5 && (c1 + c2 === targetCode) && !isCrossColumnBoundary(p.textItems, it1, it2, isAppendixPage)) {
            let startX = it1[1];
            if (it1[0].startsWith("(") || it1[0].startsWith("[")) startX += (it1[3] * 0.18);
            let endX = it2[1] + it2[3];
            if (it2[0].endsWith(")") || it2[0].endsWith("]") || it2[0].includes(" ")) {
              endX = it2[1] + (it2[3] * (c2.length / Math.max(c2.length, it2[0].length)));
            }

            const b = { x: startX, y: Math.min(it1[2], it2[2]), w: Math.max(14, endX - startX), h: Math.max(it1[4], it2[4]) };
            addMatch({
              page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
              x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
            });
            i++;
          }
        }
      }
    });

    if (matches.length > 0) {
      searchResults = matches;
      onSearchReady();
    } else {
      document.getElementById("search-counter").textContent = "0/0";
      if (typeof showToast_PL === "function") {
        showToast_PL('Không tìm thấy từ khóa: "' + rawQuery + '"', "error");
      } else {
        alert('Không tìm thấy từ khóa: "' + rawQuery + '"');
      }
    }
  }

  function handleSearchSubmit(isShift = false) {
    const currentInput = document.getElementById("ai-search-input").value.trim();
    if (currentInput === lastSearchedQuery && searchResults.length > 0) {
      navigateMatch(isShift ? -1 : 1);
    } else {
      executeSearch();
    }
  }

  function handleSearchKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit(e.shiftKey);
    }
  }

  function onSearchReady() {
    document.getElementById("btn-prev").disabled = false;
    document.getElementById("btn-next").disabled = false;
    redrawAllHighlights();
    currentMatchIndex = 0;
    updateNavigationUI();
    jumpToMatch(currentMatchIndex);
  }

  function redrawAllHighlights() {
    document.querySelectorAll(".ai-highlight-box").forEach(el => el.remove());

    function docPx(n) {
      return "calc(" + (Math.round(n * 100) / 100) + "px * var(--doc-scale))";
    }

    searchResults.forEach((m, idx) => {
      const pageEl = document.getElementById("page-wrapper-" + m.page);
      if (!pageEl) return;

      const rightPad = m.isCode ? 3 : 2;
      const boxes = (m.boxes && m.boxes.length > 0) ? m.boxes : [m];
      const isMultiLine = boxes.length > 1;

      boxes.forEach((box, bIdx) => {
        const highlight = document.createElement("div");
        highlight.id = "highlight-match-" + idx + "-" + bIdx;

        let wrapClass = "";
        if (isMultiLine) {
          if (bIdx === 0) wrapClass = " wrap-start";
          else if (bIdx === boxes.length - 1) wrapClass = " wrap-end";
        }

        highlight.className = "ai-highlight-box match-group-" + idx + wrapClass + (idx === currentMatchIndex ? " active-match" : "");
        highlight.style.left = docPx(box.x - 2);
        highlight.style.top = docPx((m.pageHeight - box.y - box.h) - 2.5);
        highlight.style.width = docPx(box.w + 2 + rightPad);
        highlight.style.height = docPx(box.h * 1.25 + 2.5);
        pageEl.appendChild(highlight);
      });
    });
  }

  function jumpToMatch(index) {
    document.querySelectorAll(".ai-highlight-box").forEach(el => el.classList.remove("active-match"));
    const match = searchResults[index];
    if (!match) return;

    const pageEl = document.getElementById("page-wrapper-" + match.page);
    if (!pageEl) return;
    document.querySelectorAll(".match-group-" + index).forEach(el => el.classList.add("active-match"));

    buildTextLayerForWrapper(pageEl);
    const targetCanvas = pageEl.querySelector("canvas.page-img");
    const targetPdfPage = parseInt(pageEl.dataset.pdfPage || match.page, 10);
    if (targetCanvas && !scalesEqual(targetCanvas.dataset.renderedScale, currentScale)) {
      renderPageToCanvas(targetCanvas, targetPdfPage);
    }

    const vp = document.getElementById("viewport-container");
    const mark = document.getElementById("highlight-match-" + index + "-0");
    const markTop = (mark && mark.offsetParent === pageEl) ? mark.offsetTop : 0;
    const markH = (mark && mark.offsetParent === pageEl) ? mark.offsetHeight : 0;
    const dest = pageEl.offsetTop + markTop - (vp.clientHeight - markH) / 2;
    const maxTop = Math.max(0, vp.scrollHeight - vp.clientHeight);
    vp.scrollTo({ top: Math.max(0, Math.min(dest, maxTop)), behavior: "smooth" });
    updatePageIndicatorUI(match.page);
  }

  function navigateMatch(direction) {
    if (searchResults.length === 0) return;
    currentMatchIndex += direction;
    if (currentMatchIndex >= searchResults.length) currentMatchIndex = 0;
    if (currentMatchIndex < 0) currentMatchIndex = searchResults.length - 1;
    updateNavigationUI();
    jumpToMatch(currentMatchIndex);
  }

  function updateNavigationUI() {
    const counter = document.getElementById("search-counter");
    if (counter) counter.textContent = searchResults.length > 0 ? `${currentMatchIndex + 1}/${searchResults.length}` : "0/0";
  }

  function clearSearchState() {
    searchResults = [];
    currentMatchIndex = -1;
    document.querySelectorAll(".ai-highlight-box").forEach(el => el.remove());
    const btnP = document.getElementById("btn-prev"), btnN = document.getElementById("btn-next");
    if (btnP) btnP.disabled = true;
    if (btnN) btnN.disabled = true;
    const counter = document.getElementById("search-counter");
    if (counter) counter.textContent = "0/0";
  }

  // =========================================================================
  // PHẦN 3: PDF PIPELINE & CLOUD VISION (NGUYÊN BẢN js_pdf_pipeline.js)
  // =========================================================================
  function getDriveTokenAsync() {
    if (cachedDriveToken && Date.now() < driveTokenExpiresAt) {
      return Promise.resolve(cachedDriveToken);
    }
    return new Promise(function(resolve, reject) {
      googleScriptRun
        .withSuccessHandler(function(token) {
          cachedDriveToken = token;
          driveTokenExpiresAt = Date.now() + (45 * 60 * 1000);
          resolve(token);
        })
        .withFailureHandler(reject)
        .getDriveAccessToken();
    });
  }

  function invalidateDriveToken() {
    cachedDriveToken = null;
    driveTokenExpiresAt = 0;
  }

  async function fetchDriveMedia(fileId, token, onProgress) {
    const slashes = String.fromCharCode(47, 47);
    const mediaUrl = "https:" + slashes + "www.googleapis.com/drive/v3/files/" + fileId + "?alt=media&supportsAllDrives=true";
    const res = await fetch(mediaUrl, {
      method: "GET",
      headers: { "Authorization": "Bearer " + token },
      signal: activeFetchAbortController ? activeFetchAbortController.signal : undefined
    });

    if (!res.ok || !res.body || typeof onProgress !== "function") {
      return res;
    }

    const totalHeader = res.headers.get("Content-Length");
    const totalBytes = totalHeader ? parseInt(totalHeader, 10) : 0;
    if (!totalBytes) return res;

    const reader = res.body.getReader();
    const chunks = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loadedBytes += value.byteLength;
      onProgress(loadedBytes, totalBytes);
    }

    const merged = new Uint8Array(loadedBytes);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      merged.set(chunks[i], offset);
      offset += chunks[i].byteLength;
    }

    return new Response(merged.buffer, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers
    });
  }

  async function fetchPdfByByteRanges(fileId, onProgress) {
    const token = await getDriveTokenAsync();
    const signal = activeFetchAbortController ? activeFetchAbortController.signal : undefined;
    const slashes = String.fromCharCode(47, 47);
    const metaUrl = "https:" + slashes + "www.googleapis.com/drive/v3/files/" + fileId + "?fields=size&supportsAllDrives=true";
    
    const meta = await fetch(metaUrl, {
      headers: { Authorization: "Bearer " + token },
      signal: signal
    });
    if (!meta.ok) throw new Error("META HTTP " + meta.status);
    const info = await meta.json();
    const size = Number(info.size || 0);
    if (!size) throw new Error("Không rõ kích thước PDF");

    const SLICE = 2 * 1024 * 1024;
    const chunks = [];
    for (let start = 0; start < size; start += SLICE) {
      if (signal && signal.aborted) throw new Error("ABORTED_BY_USER");
      const end = Math.min(size, start + SLICE) - 1;
      const res = await fetch("https:" + slashes + "www.googleapis.com/drive/v3/files/" + fileId + "?alt=media&supportsAllDrives=true", {
        headers: {
          Authorization: "Bearer " + token,
          Range: "bytes=" + start + "-" + end
        },
        signal: signal
      });
      if (!(res.status === 206 || res.status === 200)) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      if (res.status === 200 && buf.byteLength > (end - start + 1)) {
        if (typeof onProgress === "function") onProgress(size, size);
        return buf;
      }
      chunks.push(new Uint8Array(buf));
      if (typeof onProgress === "function") onProgress(end + 1, size);
    }

    const out = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out.buffer;
  }

  async function fetchPdfDirectOrFallback(fileId, onProgress) {
    try {
      const localBuf = await getLocalPdfBinary(fileId);
      if (localBuf) {
        if (typeof onProgress === "function") onProgress(1, 1);
        return localBuf;
      }
    } catch (e) {}

    try {
      let token = await getDriveTokenAsync();
      let res = await fetchDriveMedia(fileId, token, onProgress);
      if (res.status === 401 || res.status === 403) {
        invalidateDriveToken();
        token = await getDriveTokenAsync();
        res = await fetchDriveMedia(fileId, token, onProgress);
      }
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      saveLocalPdfBinary(fileId, buf).catch(() => {});
      return buf;
    } catch (err) {
      if (err.name === "AbortError" || err.message === "ABORTED_BY_USER") {
        throw new Error("ABORTED_BY_USER");
      }
      console.warn("CDN lỗi, tải theo dải byte:", err);
      try {
        const ranged = await fetchPdfByByteRanges(fileId, onProgress);
        saveLocalPdfBinary(fileId, ranged).catch(() => {});
        return ranged;
      } catch (rangeErr) {
        if (rangeErr.name === "AbortError" || rangeErr.message === "ABORTED_BY_USER") {
          throw new Error("ABORTED_BY_USER");
        }
        console.warn("Chuyển làn dự phòng Apps Script:", rangeErr);
        const fallbackBuf = await fetchPdfBase64Adaptive(fileId, onProgress);
        saveLocalPdfBinary(fileId, fallbackBuf).catch(() => {});
        return fallbackBuf;
      }
    }
  }

  function fetchPdfBase64Adaptive(fileId, onProgress) {
    if (currentFileSizeMB <= LARGE_FILE_THRESHOLD_MB) {
      return new Promise(function(resolve, reject) {
        googleScriptRun
          .withSuccessHandler(function(b64) {
            if (typeof onProgress === "function") onProgress(1, 1);
            const raw = atob(b64);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            resolve(bytes.buffer);
          })
          .withFailureHandler(reject)
          .getPdfBase64Fast(fileId);
      });
    }
    return new Promise(function(resolve, reject) {
      let fullB64 = "";
      function loadChunk(idx) {
        googleScriptRun
          .withSuccessHandler(function(res) {
            fullB64 += res.chunk;
            if (typeof onProgress === "function") onProgress(idx + 1, res.totalChunks);
            if (idx + 1 < res.totalChunks) {
              loadChunk(idx + 1);
            } else {
              const raw = atob(fullB64);
              const bytes = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
              resolve(bytes.buffer);
            }
          })
          .withFailureHandler(reject)
          .getPdfBase64Chunk(fileId, idx);
      }
      loadChunk(0);
    });
  }

  function fetchDriveCacheAdaptive(fileId, fileName) {
    return new Promise(function(resolve, reject) {
      googleScriptRun
        .withSuccessHandler(function(res) {
          if (res && res.found) {
            resolve(res);
          } else {
            resolve(res || { found: false, isOptimizing: false });
          }
        })
        .withFailureHandler(reject)
        .getDriveCacheFast(fileId, fileName);
    });
  }

  function saveDriveCacheAdaptive(fileId, fileName, jsonString) {
    return new Promise(function(resolve) {
      googleScriptRun
        .withSuccessHandler(function(res) { resolve(res); })
        .withFailureHandler(function(err) { console.error("Lỗi lưu cache tên hợp đồng:", err); resolve(); })
        .saveDriveCacheFast(fileId, fileName, jsonString);
    });
  }

  function callVisionApiBatchAsync(imagesBase64Array) {
    return new Promise(function(resolve, reject) {
      googleScriptRun
        .withSuccessHandler(resolve)
        .withFailureHandler(reject)
        .callCloudVisionApiBatch(imagesBase64Array);
    });
  }

  function isScannedPageBlank(srcCanvas) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    if (w === 0 || h === 0) return true;

    const sw = 120;
    const sh = 160;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = sw;
    sampleCanvas.height = sh;
    const sCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    sCtx.drawImage(srcCanvas, 0, 0, sw, sh);

    const imgData = sCtx.getImageData(0, 0, sw, sh);
    const d = imgData.data;

    const marginX = Math.round(sw * 0.05);
    const marginY = Math.round(sh * 0.05);

    let darkPixels = 0;
    let totalExamined = 0;

    for (let y = marginY; y < sh - marginY; y++) {
      for (let x = marginX; x < sw - marginX; x++) {
        const idx = (y * sw + x) * 4;
        const gray = d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114;
        if (gray < 180) {
          darkPixels++;
        }
        totalExamined++;
      }
    }

    const inkRatio = (darkPixels / Math.max(1, totalExamined)) * 100;
    return inkRatio < 0.12;
  }

  function round1(num) { 
    return Math.round(num * 10) / 10; 
  }

  async function scanAppendixWithVision(pdf, ctx, canvas, skippedBlankPages) {
    const SCAN_AI_SCALE = 2.85;
    const VISION_PAGE_BUDGET = 16;
    let visionApiPages = 0;
    let appendixStartPage = -1;
    const appendixPages = [];

    for (let pTop = pdf.numPages; pTop >= 1; pTop -= 2) {
      if (visionApiPages >= VISION_PAGE_BUDGET) break;

      const candidateNums = [pTop];
      if (pTop - 1 >= 1) candidateNums.push(pTop - 1);

      updateProcessProgress(30, `[2/4] AI SCAN PHỤ LỤC: TRANG ${candidateNums.join(" & ")}/${pdf.numPages}...`);
      const pairData = [];

      for (let i = 0; i < candidateNums.length; i++) {
        const pNum = candidateNums[i];
        const page = await pdf.getPage(pNum);
        const viewport = page.getViewport({ scale: SCAN_AI_SCALE });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport: viewport, intent: 'print' }).promise;
        page.cleanup();

        if (isScannedPageBlank(canvas)) {
          skippedBlankPages.add(pNum);
          continue; 
        }
        if (visionApiPages >= VISION_PAGE_BUDGET) break;

        const aiJpegImg = canvas.toDataURL("image/jpeg", 0.92);
        const pageData = {
          pageNum: pNum,
          pdfPageNum: pNum,
          width: round1(viewport.width / SCAN_AI_SCALE),
          height: round1(viewport.height / SCAN_AI_SCALE),
          textItems: []
        };

        pairData.push({ pNum: pNum, pageData: pageData, jpeg: aiJpegImg });
        visionApiPages++;
      }

      if (pairData.length > 0) {
        const visionResults = await callVisionApiBatchAsync(pairData.map(item => item.jpeg));

        let foundBreak = false;
        for (let i = 0; i < pairData.length; i++) {
          const item = pairData[i];
          const visionRes = visionResults[i];

          if (visionRes) {
            const rot = visionRes.rotation || 0;
            item.pageData.rotation = rot;

            if (rot === 90 || rot === 270) {
              const origW = item.pageData.width;
              item.pageData.width = item.pageData.height;
              item.pageData.height = origW;
            }

            if (visionRes.words && visionRes.words.length > 0) {
              item.pageData.textItems = visionRes.words.map(function(w) {
                return [
                  w.str.trim(),
                  round1(w.x / SCAN_AI_SCALE),
                  round1(item.pageData.height - ((w.y + w.h) / SCAN_AI_SCALE)),
                  round1(w.w / SCAN_AI_SCALE),
                  round1(w.h / SCAN_AI_SCALE)
                ];
              });
            }
          }

          appendixPages.push(item.pageData);
          const aiRawText = item.pageData.textItems.map(it => it[0] || "").join(" ");
          const aiClean = cleanNaturalToken(aiRawText);

          if (aiClean.includes("phuluchopdongso01") || aiClean.includes("phuluchopdongso1")) {
            appendixStartPage = item.pNum;
            foundBreak = true;
            break;
          }
        }
        if (foundBreak) break;
      }
    }

    if (appendixStartPage === -1) {
      appendixStartPage = pdf.numPages + 1;
    }

    return { appendixStartPage, appendixPages };
  }

  function processAndOptimizeFileJIT(fileId, localFileObj = null) {
    const isLocalUpload = (localFileObj !== null);
    const uploadFileName = currentFileName;
    const myEpoch = currentSessionEpoch;
    setAntiExitGuard(true);

    const timeStartTotal = performance.now();
    let timeStageLap = timeStartTotal;

    const getLapTime = () => {
      const now = performance.now();
      const duration = ((now - timeStageLap) / 1000).toFixed(2);
      timeStageLap = now;
      return duration + "s";
    };

    const getTotalTime = () => ((performance.now() - timeStartTotal) / 1000).toFixed(2) + "s";

    console.log(`%c======================================================`, "color: #FFBA08; font-weight: bold;");
    console.log(`%c🚀 BẮT ĐẦU SỐ HÓA: "${uploadFileName}"`, "color: #FFBA08; font-size: 13px; font-weight: bold;");
    console.log(`%c======================================================`, "color: #FFBA08; font-weight: bold;");

    updateProcessProgress(5, "[1/4] KHỞI TẠO TÀI LIỆU...");

    const dataSourcePromise = isLocalUpload
      ? localFileObj.arrayBuffer() 
      : fetchPdfDirectOrFallback(fileId);

    dataSourcePromise
      .then(async function(rawPdfData) {
        let canvas = null;
        let ctx = null;
        try {
          const preservedPdfData = rawPdfData.slice(0);
          const pdf = await pdfjsLib.getDocument({ data: rawPdfData }).promise;
          const sourcePageCount = pdf.numPages;

          console.log(
            `%c[1/4] KHỞI TẠO XONG: Nạp thành công file nhị phân (${sourcePageCount} trang, ${(preservedPdfData.byteLength / 1048576).toFixed(2)} MB) ⏱ Thời gian: ${getLapTime()}`,
            "color: #00e5ff; font-weight: bold;"
          );

          const manifest = { fileId: fileId, numPages: sourcePageCount, pages: [] };
          canvas = document.createElement("canvas");
          ctx = canvas.getContext("2d", { willReadFrequently: true });
          const skippedBlankPages = new Set();

          // GIAI ĐOẠN 2: Quét phụ lục bằng Vision API (Lọc trang trắng, xoay ngang)
          updateProcessProgress(20, "[2/4] AI CLOUD ĐANG QUÉT PHỤ LỤC & BẢNG KHỐI LƯỢNG...");
          const { appendixStartPage, appendixPages } = await scanAppendixWithVision(pdf, ctx, canvas, skippedBlankPages);
          manifest.pages.push(...appendixPages);
          manifest.appendixStartPage = appendixStartPage;
          manifest.sourcePageCount = sourcePageCount;

          const rotatedCount = appendixPages.filter(p => p.rotation && p.rotation !== 0).length;
          console.log(
            `%c[2/4] VISION AI XONG: Tìm thấy Phụ lục từ Trang ${appendixStartPage} (Đã xoay: ${rotatedCount} trang, Bỏ trắng: ${skippedBlankPages.size} trang) ⏱ Thời gian: ${getLapTime()}`,
            "color: #69f0ae; font-weight: bold;"
          );

          // GIAI ĐOẠN 3: Xử lý nhanh Thân Hợp Đồng (Bỏ qua OCR cục bộ)
updateProcessProgress(45, "[3/4] XỬ LÝ NHANH THÂN HỢP ĐỒNG...");
const contractEndPage = appendixStartPage - 1;
const preScannedPages = new Set(appendixPages.map(p => p.pageNum));
const bodyPages = [];

for (let pageNum = 1; pageNum <= contractEndPage; pageNum++) {
  if (preScannedPages.has(pageNum)) continue;

  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.0 });

  // Trích xuất text nhúng sẵn trong file (Rất nhanh, hỗ trợ file PDF xuất từ Word)
  let textItems = [];
  try {
    const tc = await page.getTextContent();
    if (tc && tc.items) {
      textItems = tc.items.map(it => [
        (it.str || "").trim(),
        round1(it.transform[4]),
        round1(it.transform[5]),
        round1(it.width),
        round1(it.height)
      ]).filter(it => it[0].length > 0);
    }
  } catch (tcErr) {}

  bodyPages.push({
    pageNum: pageNum,
    pdfPageNum: pageNum,
    width: round1(viewport.width),
    height: round1(viewport.height),
    rotation: 0,
    textItems: textItems
  });
  
  page.cleanup();
  
  // Cập nhật thanh tiến trình chạy ảo cho mượt
  if (pageNum % 5 === 0) {
    const pct = 45 + Math.round((pageNum / Math.max(1, contractEndPage)) * 40);
    updateProcessProgress(pct, `[3/4] TRÍCH XUẤT NHANH THÂN HỢP ĐỒNG: TRANG ${pageNum}/${contractEndPage}...`);
  }
}

manifest.pages.push(...bodyPages);
manifest.pages.sort((a, b) => a.pageNum - b.pageNum);

console.log(
  `%c[3/4] XỬ LÝ NHANH XONG: Đã trích xuất gốc thân HĐ (${bodyPages.length} trang) ⏱ Thời gian: ${getLapTime()}`,
  "color: #ffd740; font-weight: bold;"
);

          // GIAI ĐOẠN 4: LẬP CHỈ MỤC ĐỐI CHIẾU TRỰC TIẾP FILE PDF GỐC (KHÔNG LỆCH TRANG KHI MẤT CACHE)
          updateProcessProgress(86, "[4/4] ĐANG CHUẨN HÓA DỮ LIỆU TRANG & GÓC XOAY...");

          const cleanPages = [];
          let cleanAppendixPage = -1;

          const foundIdx = manifest.pages.findIndex(p => p.pageNum >= appendixStartPage);
          if (foundIdx !== -1) {
            cleanAppendixPage = foundIdx + 1;
          }

          manifest.pages.forEach((p, idx) => {
            cleanPages.push({
              pageNum: idx + 1,           // Số thứ tự hiển thị liên tục (đã ẩn trang trắng)
              pdfPageNum: p.pageNum,      // 👈 GIỮ NGUYÊN số trang thật trên file PDF gốc ở Drive
              width: p.width,
              height: p.height,
              rotation: p.rotation || 0,  // 👈 GIỮ NGUYÊN góc xoay cần bù trừ cho trang phụ lục
              textItems: p.textItems
            });
          });

          manifest.pages = cleanPages;
          manifest.numPages = cleanPages.length;
          manifest.appendixStartPage = (cleanAppendixPage !== -1) ? cleanAppendixPage : (cleanPages.length + 1);
          manifest.mapsOriginalPdf = true; // Đánh dấu chuẩn mới

          updateProcessProgress(90, "[4/4] ĐẨY BẢN SỐ HÓA LÊN GOOGLE DRIVE...");
          let finalDriveFileId = fileId;
          let finalSizeStr = (preservedPdfData.byteLength / (1024 * 1024)).toFixed(2) + " MB";

          const compressedPayload = await compressManifest(manifest);
          putSessionCache(finalDriveFileId, manifest);

          await Promise.all([
            saveDriveCacheAdaptive(finalDriveFileId, uploadFileName, compressedPayload),
            saveLocalManifest(finalDriveFileId, manifest)
          ]);

          updateProcessProgress(96, "[4/4] KHỞI TẠO BẢN XEM TRƯỚC...");
          if (cleanPages.length >= 1) {
            const firstPdfPageNum = cleanPages[0].pdfPageNum || 1;
            const page1 = await pdf.getPage(firstPdfPageNum);
            const rawDpr = window.devicePixelRatio || 1;
            const sharpFactor = Math.max(rawDpr, 2.0);
            const effectiveScale = Math.min(cachedRenderScale * sharpFactor, 2.0);
            const effectiveRot1 = (page1.rotate + (cleanPages[0].rotation || 0)) % 360;
            const vp = page1.getViewport({ scale: effectiveScale, rotation: effectiveRot1 });

            const bCanvas = document.createElement("canvas");
            bCanvas.width = Math.floor(vp.width);
            bCanvas.height = Math.floor(vp.height);
            const bCtx = bCanvas.getContext("2d");
            bCtx.fillStyle = "#ffffff";
            bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
            await page1.render({ canvasContext: bCtx, viewport: vp, intent: 'display' }).promise;
            page1.cleanup();
            await savePageBitmap(finalDriveFileId, firstPdfPageNum, cachedRenderScale, bCanvas);
            bCanvas.width = 0;
            bCanvas.height = 0;
          }

          if (currentPdfDoc && currentPdfDoc !== pdf) {
            try { currentPdfDoc.destroy(); } catch (e) {}
          }
          currentPdfDoc = pdf;

          console.log(
            `%c[4/4] LƯU DRIVE & CACHE 100% XONG: Dung lượng ${finalSizeStr} ⏱ Thời gian: ${getLapTime()}`,
            "color: #e040fb; font-weight: bold;"
          );

          updateProcessProgress(100, "SỐ HÓA THÀNH CÔNG - SẴN SÀNG TÌM KIẾM!", true);

          if (typeof window.markScanFileDigitized_PL === "function") {
            window.markScanFileDigitized_PL(finalDriveFileId);
          }

          if (myEpoch === currentSessionEpoch) {
            currentManifest = manifest;
            await renderSlicedDocument();
          }

          // =====================================================================
          // BẢNG BÁO CÁO NGHIỆM THU TỔNG KẾT TỰ ĐỘNG IN RA CONSOLE
          // =====================================================================
          const listBlank = Array.from(skippedBlankPages).sort((a,b) => a-b);
          const listRotated = appendixPages.filter(p => p.rotation && p.rotation !== 0).map(p => `Trang ${p.pageNum} (xoay ${p.rotation}°)`);

          console.log(`%c======================================================`, "color: #00e676; font-weight: bold;");
          console.log(`%c✔ TOÀN BỘ TIẾN TRÌNH HOÀN THÀNH XUẤT SẮC TRONG: ${getTotalTime()}`, "color: #00e676; font-size: 14px; font-weight: bold;");
          console.log(`%c======================================================`, "color: #00e676; font-weight: bold;");
          console.table({
            "Tên tài liệu": uploadFileName,
            "Tổng thời gian": getTotalTime(),
            "Tổng số trang gốc": sourcePageCount + " trang",
            "Tổng số trang sạch (sau xử lý)": cleanPages.length + " trang",
            "Các trang trắng đã loại bỏ": listBlank.length > 0 ? listBlank.join(", ") : "Không có",
            "Các trang phụ lục đã xoay ngang": listRotated.length > 0 ? listRotated.join(", ") : "Không có",
            "Dung lượng bản PDF sạch": finalSizeStr,
            "Drive File ID": finalDriveFileId,
            "Trạng thái đệm máy tính (IndexedDB)": "Đã lưu 100% (Mở lại trong 0.01s)"
          });

        } catch (err) {
          setAntiExitGuard(false);
          hideLoading();
          updateProcessProgress(0, "LỖI: " + err.message);
          console.error(`%c❌ LỖI TRONG TIẾN TRÌNH: ${err.message}`, "color: #ff1744; font-size: 13px; font-weight: bold;", err);
          setTimeout(() => {
            const box = document.getElementById("proc-progress-box");
            if (box) box.style.display = "none";
          }, 4000);
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      })
      .catch(function(err) {
      setAntiExitGuard(false);
      hideLoading();
      console.error(`%c❌ LỖI TẢI NHỊ PHÂN: ${err.message}`, "color: #ff1744; font-weight: bold;", err);

      // HIỂN THỊ MÀN HÌNH BÁO LỖI TRỰC QUAN TRONG VIEWPORT (KHÔNG ĐỂ MÀN HÌNH XANH ĐEN RỖNG)
      const vp = document.getElementById("viewport-container");
      if (vp) {
        vp.style.visibility = "visible";
        vp.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; padding: 30px; box-sizing: border-box;">
            <i class="bi bi-file-earmark-x" style="font-size: 55px; color: #ff4d4d; margin-bottom: 15px; opacity: 0.85;"></i>
            <h4 style="color: #ff4d4d; font-size: 15px; font-weight: bold; margin: 0 0 10px 0; text-transform: uppercase;">KHÔNG THỂ MỞ TỆP TIN</h4>
            <p style="color: #95A1AF; font-size: 12px; line-height: 1.6; max-width: 450px; margin: 0 0 20px 0;">
              Tệp có thể đã bị xóa trên Google Drive hoặc tài khoản không có quyền truy cập.<br>
              <span style="color: #FFBA08; font-family: monospace; font-size: 11px;">(${err.message || "Lỗi tải tệp"})</span>
            </p>
            <button type="button" class="prv-btn" onclick="window.BconsViewer.loadFile('${fileId}', '${uploadFileName}')" style="padding: 6px 16px; font-size: 12px;">
              <i class="bi bi-arrow-clockwise" style="margin-right: 6px;"></i> THỬ LẠI
            </button>
          </div>
        `;
      }
      if (typeof showToast_PL === "function") {
        showToast_PL("⚠️ Không thể tải file: " + err.message, "error");
      } else {
        alert("Lỗi tải PDF: " + err.message);
      }
    });
  }

  function checkDriveCacheWithRetry(fileId, fileName, retryCount, busyCount) {
    const myEpoch = currentSessionEpoch;
    busyCount = busyCount || 0;

    fetchDriveCacheAdaptive(fileId, fileName)
      .then(async function(res) {
        if (myEpoch !== currentSessionEpoch) return;

        if (res && res.found) {
          currentManifest = await decompressManifest(res.data);
          if (myEpoch !== currentSessionEpoch) return;

          if (typeof window.markScanFileDigitized_PL === "function") {
            window.markScanFileDigitized_PL(fileId);
          }

          putSessionCache(fileId, currentManifest);
          saveLocalManifest(fileId, currentManifest);

          try {
            await ensurePdfPreloaded(fileId, 95); // 👈 Đổi (fileId, 15, 95) thành (fileId, 95)
            await renderSlicedDocument();
          } catch (e) {
            if (e.message !== "ABORTED" && e.message !== "REPAIR_OLD_MANIFEST") hideLoading();
          }
          return;
        }

        if (res && res.busy) {
          if (busyCount < 8) {
            setTimeout(function() {
              if (myEpoch === currentSessionEpoch) {
                checkDriveCacheWithRetry(fileId, fileName, retryCount, busyCount + 1);
              }
            }, 1500);
            return;
          }
        }

        if (res && res.isOptimizing) {
          if (retryCount <= 60) {
            setTimeout(function() {
              if (myEpoch === currentSessionEpoch) {
                checkDriveCacheWithRetry(fileId, fileName, retryCount + 1, 0);
              }
            }, 10000);
            return;
          }
        }

        processAndOptimizeFileJIT(fileId);
      })
      .catch(function() {
        if (myEpoch === currentSessionEpoch) {
          processAndOptimizeFileJIT(fileId);
        }
      });
  }

  // =========================================================================
  // PHẦN 4: UI EVENTS & VIRTUALIZATION (NGUYÊN BẢN js_ui_events.js)
  // =========================================================================
  function paintBitmapBlob(canvas, blob, targetPdfPage, renderScale) {
    return createImageBitmap(blob).then(function(bmp) {
      if (!canvas.isConnected || isZooming) {
        if (bmp.close) bmp.close();
        return;
      }
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.dataset.renderedScale = String(renderScale);
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
    });
  }

  let jumpScrollTimer = null;

  function jumpToPageNumber(pageNum, isSmooth = true, scrollToBottomEdge = false) {
    if (!currentManifest || !currentManifest.pages.length) return;
    const vp = document.getElementById("viewport-container");
    const total = currentManifest.pages.length;
    const targetIndex = Math.max(0, Math.min(total - 1, (parseInt(pageNum, 10) || 1) - 1));
    const targetPageObj = currentManifest.pages[targetIndex];
    if (!targetPageObj || !vp) return;

    const el = document.getElementById("page-wrapper-" + targetPageObj.pageNum);
    if (!el) return;

    buildTextLayerForWrapper(el);
    const destCanvas = el.querySelector("canvas.page-img");
    const destPdfPage = parseInt(el.dataset.pdfPage || targetPageObj.pageNum, 10);
    if (destCanvas && !scalesEqual(destCanvas.dataset.renderedScale, currentScale)) {
      renderPageToCanvas(destCanvas, destPdfPage);
    }

    let destTop = Math.max(0, el.offsetTop);
    // Chỉ cuộn tới sát đáy cuối trang khi chủ động bấm chế độ Bottom
    if (scrollToBottomEdge && targetIndex === total - 1) {
      destTop = Math.max(destTop, vp.scrollHeight - vp.clientHeight);
    }

    if (isSmooth && Math.abs(vp.scrollTop - destTop) >= 5) {
      scrollLock = true;
      let unlocked = false;

      function onArrive() {
        if (unlocked) return;
        unlocked = true;
        vp.removeEventListener("scrollend", onArrive);
        clearTimeout(jumpScrollTimer);
        scrollLock = false;
        renderVisiblePagesOnly();
        updateCurrentPageOnScroll();
      }

      vp.addEventListener("scrollend", onArrive);
      clearTimeout(jumpScrollTimer);
      jumpScrollTimer = setTimeout(onArrive, 1200);
    }

    vp.scrollTo({ top: destTop, behavior: isSmooth ? "smooth" : "auto" });
    updatePageIndicatorUI(targetIndex + 1);
  }

  function getAppendixOffsetTop() {
    if (!currentManifest || !currentManifest.pages.length) return null;
    const total = currentManifest.pages.length;
    const appendixPage = currentManifest.appendixStartPage || (total + 1);
    if (appendixPage <= 1 || appendixPage > total) return null; // 👈 Đổi >= total thành > total

    const targetObj = currentManifest.pages[appendixPage - 1];
    const el = targetObj ? document.getElementById("page-wrapper-" + targetObj.pageNum) : null;
    return el ? Math.max(0, el.offsetTop) : null;
  }

  function handleSmartScrollUp() {
    if (!currentManifest || !currentManifest.pages.length) return;
    const vp = document.getElementById("viewport-container");
    const total = currentManifest.pages.length;
    const appendixPage = currentManifest.appendixStartPage || (total + 1);
    const appTop = getAppendixOffsetTop();

    if (vp && appTop !== null && vp.scrollTop > appTop + 30) {
      jumpToPageNumber(appendixPage, true);
    } else {
      jumpToPageNumber(1, true);
    }
  }

  function handleSmartScrollDown() {
    if (!currentManifest || !currentManifest.pages.length) return;
    const vp = document.getElementById("viewport-container");
    const total = currentManifest.pages.length;
    const appendixPage = currentManifest.appendixStartPage || (total + 1);
    const appTop = getAppendixOffsetTop();

    if (vp && appTop !== null && vp.scrollTop < appTop - 30) {
      jumpToPageNumber(appendixPage, true, false); // 👈 Nhảy tới ĐẦU trang PL01
    } else {
      jumpToPageNumber(total, true, true);         // 👈 Đã qua PL01 -> cuộn tới ĐÁY cuối cùng
    }
  }

  function updatePageIndicatorUI(pNum) {
    const input = document.getElementById("jump-page-input");
    if (input && document.activeElement !== input) {
      input.value = pNum;
    }
    const num = parseInt(pNum, 10) || 1;
    const total = currentManifest ? currentManifest.pages.length : 1;
    const appendixPage = currentManifest ? (currentManifest.appendixStartPage || (total + 1)) : (total + 1);

    const btnTop = document.getElementById("btn-scroll-top");
    const btnBottom = document.getElementById("btn-scroll-bottom");

    if (btnTop) {
      if (num <= 1) {
        btnTop.classList.add("is-hidden");
      } else {
        btnTop.classList.remove("is-hidden");
        if (appendixPage > 1 && appendixPage <= total && num > appendixPage) { // 👈 Đổi < thành <=
          btnTop.setAttribute("data-tip", "PL01");
        } else {
          btnTop.setAttribute("data-tip", "Top");
        }
      }
    }

    if (btnBottom) {
      if (num >= total) {
        btnBottom.classList.add("is-hidden");
      } else {
        btnBottom.classList.remove("is-hidden");
        if (appendixPage <= total && num < appendixPage) { // 👈 Đổi < thành <=
          btnBottom.setAttribute("data-tip", "PL01");
        } else {
          btnBottom.setAttribute("data-tip", "Bottom");
        }
      }
    }
  }

  let isPanBound = false;
  function setupHandToolPanning() {
    const vp = document.getElementById("viewport-container");
    if (!vp || isPanBound) return;
    isPanBound = true;

    let isPanTicking = false;
    let targetScrollLeft = 0;
    let targetScrollTop = 0;

    vp.addEventListener("pointerdown", function(e) {
      if (e.pointerType === "touch") return; 
      if (e.button !== 0 || e.target.closest(".search-box-wrap") || e.target.closest(".prv-tools")) return;
      if (e.target.classList.contains("text-overlay-item")) return;

      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      scrollLeftStart = vp.scrollLeft;
      scrollTopStart = vp.scrollTop;
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("grabbing");
    });

    vp.addEventListener("pointermove", function(e) {
      if (!isDragging) return;
      e.preventDefault();

      targetScrollLeft = scrollLeftStart - (e.clientX - startX);
      targetScrollTop = scrollTopStart - (e.clientY - startY);

      if (!isPanTicking) {
        isPanTicking = true;
        requestAnimationFrame(function() {
          if (isDragging) {
            vp.scrollLeft = targetScrollLeft;
            vp.scrollTop = targetScrollTop;
          }
          isPanTicking = false;
        });
      }
    });

    const stopDrag = function(e) {
      if (!isDragging) return;
      isDragging = false;
      isPanTicking = false;
      try { vp.releasePointerCapture(e.pointerId); } catch(err) {}
      vp.classList.remove("grabbing");
    };

    vp.addEventListener("pointerup", stopDrag);
    vp.addEventListener("pointercancel", stopDrag);
  }

  function cleanTypographySpacing(str) {
    if (!str) return "";
    return str
      .replace(/\s+([,;.:?!])/g, "$1")
      .replace(/([(\[{“‘])\s+/g, "$1")
      .replace(/\s+([)\]}”’])/g, "$1")
      .replace(/"\s+([^"\n]+?)\s+"/g, '"$1"')
      .replace(/(^|[\s(\[{])"\s+(\S)/g, '$1"$2')
      .replace(/(\S)\s+"(?=[\s)\]},;.:?!]|$)/g, '$1"')
      .replace(/[^\S\r\n]+/g, " ")
      .trim();
  }

  let isCopyBound = false;
  function setupSmartClipboardCopy() {
    if (isCopyBound) return;
    isCopyBound = true;

    document.addEventListener("copy", function(e) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

      const container = document.getElementById("viewport-container");
      if (!container) return;

      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer) && container !== range.commonAncestorContainer) return;

      const fragment = range.cloneContents();
      const spans = Array.from(fragment.querySelectorAll(".text-overlay-item"));

      if (spans.length > 1) {
        e.preventDefault();

        let resultText = "";
        let prevTop = null;
        let prevText = "";

        spans.forEach((span, idx) => {
          const text = span.textContent.trim();
          if (!text) return;

          const currentTop = parseFloat(span.style.top) || 0;

          if (idx === 0) {
            resultText += text;
          } else {
            const isNewLine = Math.abs(currentTop - prevTop) > 0.8;
            if (isNewLine) {
              resultText += "\n" + text;
            } else {
              const noSpaceBefore = /^[,;.:?!)}\]”’]/.test(text);
              const noSpaceAfterPrev = /[(\[{“‘"]$/.test(prevText);

              if (noSpaceBefore || noSpaceAfterPrev) {
                resultText += text;
              } else {
                resultText += " " + text;
              }
            }
          }
          prevTop = currentTop;
          prevText = text;
        });

        resultText = cleanTypographySpacing(resultText);

        if (e.clipboardData) {
          e.clipboardData.setData("text/plain", resultText);
        }
      }
    });
  }

  let isPinchBound = false;
  function setupTouchPinchZoom() {
    const vp = document.getElementById("viewport-container");
    if (!vp || isPinchBound) return;
    isPinchBound = true;

    let initialDist = 0;
    let initialScale = 1.0;

    vp.addEventListener("touchstart", function(e) {
      if (e.touches.length === 2) {
        initialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = currentScale;
      }
    }, { passive: true });

    vp.addEventListener("touchmove", function(e) {
      if (e.touches.length === 2 && initialDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / initialDist;
        const targetScale = Math.min(3.0, Math.max(0.5, initialScale * factor));
        const delta = targetScale - currentScale;
        if (Math.abs(delta) >= 0.05) {
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          zoomChange(delta, midX, midY);
        }
      }
    }, { passive: false });

    vp.addEventListener("touchend", function(e) {
      if (e.touches.length < 2) initialDist = 0;
    }, { passive: true });
  }

  let isWheelBound = false;
  function setupCtrlWheelZoom() {
    const vp = document.getElementById("viewport-container");
    if (!vp || isWheelBound) return;
    isWheelBound = true;

    vp.addEventListener("wheel", function(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    // BỔ SUNG: Truyền trực tiếp tọa độ con trỏ chuột e.clientX, e.clientY vào zoomChange
    zoomChange(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY);
  }, { passive: false });
  }

  async function ensurePdfPreloaded(fileId, endPct = 95) {
    if (currentPdfDoc) {
      stopSoftProgress();
      updateLoaderProgress(98);
      return currentPdfDoc;
    }
    const epoch = currentSessionEpoch;

    const localBuf = await getLocalPdfBinary(fileId);
    let pdfData = localBuf;

    if (!pdfData) {
      let streamStartPct = null;
      pdfData = await fetchPdfDirectOrFallback(fileId, (loaded, total) => {
        if (epoch !== currentSessionEpoch) return;
        stopSoftProgress(); // Ngắt chạy mềm đúng mili-giây byte thật đầu tiên về
        if (streamStartPct === null) {
          streamStartPct = currentLoaderPct; // Chốt làm điểm nối tiếp mượt mà
        }
        const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
        const pct = streamStartPct + ratio * (endPct - streamStartPct);
        if (pct > currentLoaderPct) {
          updateLoaderProgress(pct);
        }
      });
    }

    stopSoftProgress();
    if (epoch !== currentSessionEpoch) throw new Error("ABORTED");

    updateLoaderProgress(96);
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    if (epoch !== currentSessionEpoch) {
      try { pdf.destroy(); } catch (e) {}
      throw new Error("ABORTED");
    }

    if (currentManifest && !currentManifest.mapsOriginalPdf && !currentManifest._repairing && pdf.numPages !== currentManifest.numPages) {
      currentManifest._repairing = true;
      delete SESSION_MANIFEST_CACHE[fileId];
      try { pdf.destroy(); } catch (e) {}
      setTimeout(() => {
        if (epoch === currentSessionEpoch) processAndOptimizeFileJIT(fileId);
      }, 50);
      throw new Error("REPAIR_OLD_MANIFEST");
    }

    currentPdfDoc = pdf;
    return pdf;
  }

  async function loadFile(fileId, fileName, sizeMB, isProcessed, jsonId) {
    if (currentFileId === fileId && currentManifest) return;

    setupHandToolPanning();
    setupCtrlWheelZoom();
    setupTouchPinchZoom();
    setupSmartClipboardCopy();

    currentSessionEpoch++;
    const myEpoch = currentSessionEpoch;

    if (activeFetchAbortController) {
      activeFetchAbortController.abort();
      activeFetchAbortController = null;
    }
    activeFetchAbortController = new AbortController();

    if (currentPdfDoc) {
      currentPdfDoc.destroy();
      currentPdfDoc = null;
    }

    currentManifest = null;
    currentFileId = fileId;
    currentFileName = fileName || "Document.pdf";
    currentFileSizeMB = (sizeMB !== undefined) ? sizeMB : 0;
    currentScale = 1.0; // Luôn mở ở mức 100% vừa khít khung

    const fnEl = document.getElementById("preview-file-name") || document.getElementById("prv-file-name");
    if (fnEl) fnEl.textContent = currentFileName;

    clearSearchState();
    const inp = document.getElementById("jump-page-input");
    if (inp) inp.value = "1";

    // Xóa sạch khung giấy cũ và ẩn viewport trong suốt quá trình nạp (tránh lộ trang trắng bên dưới)
    const vp = document.getElementById("viewport-container");
    if (vp) {
      vp.style.visibility = "hidden";
      vp.innerHTML = "";
    }
    const pageInd = document.getElementById("page-indicator");
    if (pageInd) pageInd.style.display = "none";

    const isDirectDoc = isPlOrPdgFile(currentFileName);

    // 1. Kiểm tra cache Manifest (RAM -> IndexedDB)
    let cachedManifest = getSessionCache(fileId);
    if (!cachedManifest) {
      cachedManifest = await getLocalManifest(fileId);
      if (myEpoch !== currentSessionEpoch) return;
      if (cachedManifest) putSessionCache(fileId, cachedManifest);
    }

    if (cachedManifest) {
      currentManifest = cachedManifest;
      if (!isDirectDoc && typeof window.markScanFileDigitized_PL === "function") {
        window.markScanFileDigitized_PL(fileId);
      }

      const hasBin = await getLocalPdfBinary(fileId);
      if (myEpoch !== currentSessionEpoch) return;

      if (!hasBin) {
        showLoading("LOADING DOCUMENT", 5);
      }

      try {
        await ensurePdfPreloaded(fileId, 95);
        await renderSlicedDocument();
      } catch (e) {
        if (e.message !== "ABORTED" && e.message !== "REPAIR_OLD_MANIFEST") {
          hideLoading();
          if (vp) {
            vp.style.visibility = "visible";
            vp.innerHTML = `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; padding: 30px; box-sizing: border-box;">
                <i class="bi bi-file-earmark-x" style="font-size: 55px; color: #ff4d4d; margin-bottom: 15px;"></i>
                <h4 style="color: #ff4d4d; font-size: 15px; font-weight: bold; margin: 0 0 10px 0;">KHÔNG THỂ MỞ TỆP TIN</h4>
                <p style="color: #95A1AF; font-size: 12px; margin: 0;">${e.message || "Lỗi tải tệp"}</p>
              </div>
            `;
          }
        }
      }
      return;
    }

    // 2. Chưa có cache Manifest ở máy -> bật Loading với thanh tiến độ %
    showLoading("LOADING DOCUMENT", 0);

    // 🚀 TẠM THỜI VÔ HIỆU HÓA SỐ HÓA ĐỐI VỚI FILE PL VÀ PDG (CHỈ MỞ XEM TRỰC TIẾP)
    if (isDirectDoc) {
      await loadPdfDirectWithoutOcr(fileId);
      return;
    }

    // Các file HĐ gốc chưa có cache máy -> kiểm tra cache JSON trên Drive (hoặc số hóa mới)
    startSoftProgress(0, 35, 0.035);
    checkDriveCacheWithRetry(fileId, currentFileName, 1);
  }

  // 1. Nhận diện file Phụ lục (PL) hoặc Phê duyệt giá (PDG)
  function isPlOrPdgFile(fileName) {
    if (!fileName) return false;
    const clean = fileName.toLowerCase();

    // 1. Nhận diện Phê duyệt giá (bắt cả _PDG_, PDG, phê duyệt giá,...)
    const isPdg = /pdg|pđg|phe\s*duyet\s*gia|phê\s*duyệt\s*giá|(\b|_)gia(\b|_)|(\b|_)giá(\b|_)/i.test(clean);

    // 2. Nhận diện Phụ lục (Bắt chuẩn xác _PL06_, _PL_, PL01, Phụ lục,...)
    const isPl = /(^|[^a-z0-9])pl(\d+)?([^a-z0-9]|$)|phu\s*luc|phụ\s*lục/i.test(clean);

    return isPdg || isPl;
  }

  // 2. Mở file PDF trực tiếp siêu nhanh (0.5s - 1s), bỏ qua toàn bộ tiến trình số hóa AI/OCR
  async function loadPdfDirectWithoutOcr(fileId, localFileObj = null) {
    const myEpoch = currentSessionEpoch;
    try {
      // Kiểm tra cache RAM hoặc IndexedDB nếu đã từng mở trước đó
      const ramCached = getSessionCache(fileId);
      if (ramCached) {
        currentManifest = ramCached;
        await renderSlicedDocument();
        hideLoading();
        return;
      }
      const localCached = await getLocalManifest(fileId);
      if (localCached) {
        putSessionCache(fileId, localCached);
        currentManifest = localCached;
        await renderSlicedDocument();
        hideLoading();
        return;
      }

      startSoftProgress(0, 25, 0.035);
      let streamStartPct = null;
      const rawPdfData = localFileObj 
        ? await localFileObj.arrayBuffer()
        : await fetchPdfDirectOrFallback(fileId, (loaded, total) => {
            if (myEpoch !== currentSessionEpoch) return;
            stopSoftProgress();
            if (streamStartPct === null) streamStartPct = currentLoaderPct;
            const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
            const pct = streamStartPct + ratio * (95 - streamStartPct);
            if (pct > currentLoaderPct) updateLoaderProgress(pct);
          });
      stopSoftProgress();
      updateLoaderProgress(96);

      if (myEpoch !== currentSessionEpoch) return;

      const preservedPdfData = rawPdfData.slice(0);
      const pdf = await pdfjsLib.getDocument({ data: rawPdfData }).promise;
      currentPdfDoc = pdf;

      // Khởi tạo manifest trực tiếp từ PDF.js (không dùng Cloud Vision / Tesseract)
      const manifest = {
        fileId: fileId,
        numPages: pdf.numPages,
        appendixStartPage: pdf.numPages + 1,
        pages: []
      };

      for (let pNum = 1; pNum <= pdf.numPages; pNum++) {
        const page = await pdf.getPage(pNum);
        const vp = page.getViewport({ scale: 1.0 });

        let textItems = [];
        try {
          const tc = await page.getTextContent();
          if (tc && tc.items) {
            textItems = tc.items.map(it => [
              (it.str || "").trim(),
              round1(it.transform[4]),
              round1(it.transform[5]),
              round1(it.width),
              round1(it.height)
            ]).filter(it => it[0].length > 0);
          }
        } catch (tcErr) {}

        manifest.pages.push({
          pageNum: pNum,
          pdfPageNum: pNum,
          width: round1(vp.width),
          height: round1(vp.height),
          rotation: 0, // 👈 Đặt là 0 để PDF.js tự hiển thị đúng góc quay gốc của file
          textItems: textItems
        });
        page.cleanup();
      }

      if (myEpoch !== currentSessionEpoch) return;

      putSessionCache(fileId, manifest);
      saveLocalManifest(fileId, manifest);
      saveLocalPdfBinary(fileId, preservedPdfData);

      currentManifest = manifest;
      await renderSlicedDocument();
      hideLoading();

      console.log(`%c⚡ [DIRECT VIEW] Đã mở trực tiếp (không số hóa): "${currentFileName}" (${pdf.numPages} trang)`, "color: #00BCD4; font-weight: bold;");

    } catch (err) {
      hideLoading();
      console.error("Lỗi mở trực tiếp PDF:", err);
      if (myEpoch === currentSessionEpoch) {
        const vp = document.getElementById("viewport-container");
        if (vp) {
          vp.style.visibility = "visible";
          vp.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; padding: 30px; box-sizing: border-box;">
              <i class="bi bi-file-earmark-x" style="font-size: 55px; color: #ff4d4d; margin-bottom: 15px;"></i>
              <h4 style="color: #ff4d4d; font-size: 15px; font-weight: bold; margin: 0 0 10px 0;">KHÔNG THỂ MỞ TỆP TIN</h4>
              <p style="color: #95A1AF; font-size: 12px; margin: 0 0 20px 0;">${err.message || "Lỗi tải tệp"}</p>
            </div>
          `;
        }
      }
    }
  }

  function handlePageJumpKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      jumpToPageNumber(e.target.value);
      e.target.blur();
    }
  }

  let isScrollTicking = false;

  function updateCurrentPageOnScroll() {
    if (isScrollTicking || scrollLock || !currentManifest || !currentManifest.pages.length) return;
    isScrollTicking = true;

    requestAnimationFrame(function() {
      isScrollTicking = false;
      const container = document.getElementById("viewport-container");
      if (!container) return;

      const total = currentManifest.pages.length;

      if (container.scrollTop <= 20) {
        updatePageIndicatorUI(1);
        return;
      }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 20) {
        updatePageIndicatorUI(total);
        return;
      }

      const focusLine = container.scrollTop + Math.min(200, container.clientHeight * 0.25);
      const wrappers = container.children;

      for (let i = 0; i < wrappers.length; i++) {
        const el = wrappers[i];
        if (!el.classList.contains("page-wrapper")) continue;

        const top = el.offsetTop;
        const bottom = top + el.clientHeight + 35;
        if (focusLine >= top && focusLine <= bottom) {
          updatePageIndicatorUI(i + 1);
          break;
        }
      }
    });
  }

  function buildTextLayerForWrapper(wrapper) {
    if (!wrapper || !currentManifest || !currentManifest.pages) return;
    if (wrapper.querySelector(".text-layer")) return;

    const idx = parseInt(wrapper.dataset.idx, 10);
    const p = !isNaN(idx)
      ? currentManifest.pages[idx]
      : currentManifest.pages.find(item => String(item.pageNum) === String(wrapper.dataset.page));

    if (!p || !p.textItems || p.textItems.length === 0) return;

    const txtLayer = document.createElement("div");
    txtLayer.className = "text-layer";
    let txtHtml = "";
    const items = p.textItems;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const str = Array.isArray(it) ? it[0] : (it.str || "");
      if (!str) continue;

      const x = Array.isArray(it) ? it[1] : it.x;
      const y = Array.isArray(it) ? it[2] : it.y;
      const w = Array.isArray(it) ? it[3] : it.w;
      const h = Array.isArray(it) ? it[4] : it.h;

      const leftPct = (x / p.width) * 100;
      const topPct = ((p.height - y - h) / p.height) * 100;
      const widthPct = (w / p.width) * 100;
      const heightPct = (h / p.height) * 100;
      const fontSize = Math.max(8, Math.round(h * 0.88 * 10) / 10);

      const safeText = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      txtHtml += `<span class="text-overlay-item" style="left:${leftPct}%; top:${topPct}%; width:${widthPct}%; height:${heightPct}%; font-size:calc(${fontSize}px * var(--doc-scale));">${safeText}</span>`;
    }

    txtLayer.innerHTML = txtHtml;
    wrapper.appendChild(txtLayer);
  }

  function removeTextLayerFromWrapper(wrapper) {
    if (!wrapper) return;
    const txtLayer = wrapper.querySelector(".text-layer");
    if (txtLayer) txtLayer.remove();
  }

  let baseFitScale = 1.0;

  function getContainerFitWidth(container) {
    const panelEl = document.getElementById("pl-dock-preview-panel");
    const rawW = (container && container.clientWidth > 100)
      ? container.clientWidth
      : ((panelEl && parseFloat(panelEl.style.width) > 100) ? parseFloat(panelEl.style.width) : 1000);
    // Bỏ trừ 6px để trang giấy khít 100% không còn khe hở viền
    return Math.max(300, rawW);
  }

  function createPageWrapperElement(p, idx, fitWidth) {
    const pageWrapper = document.createElement("div");
    pageWrapper.id = "page-wrapper-" + p.pageNum;
    pageWrapper.className = "page-wrapper";
    pageWrapper.dataset.page = p.pageNum;
    pageWrapper.dataset.pdfPage = p.pdfPageNum || p.pageNum;
    pageWrapper.dataset.rotation = p.rotation || 0;
    if (idx !== undefined) pageWrapper.dataset.idx = idx;

    const pageFit = (fitWidth || 940) / Math.max(1, p.width);
    pageWrapper.dataset.baseFit = String(pageFit);
    pageWrapper.style.setProperty("--doc-scale", String(currentScale * pageFit));

    pageWrapper.style.width = "calc(" + p.width + "px * var(--doc-scale))";
    pageWrapper.style.height = "calc(" + p.height + "px * var(--doc-scale))";

    const canvas = document.createElement("canvas");
    canvas.className = "page-img";
    canvas.dataset.page = p.pageNum;
    canvas.dataset.pdfPage = p.pdfPageNum || p.pageNum;
    pageWrapper.appendChild(canvas);

    return pageWrapper;
  }

  async function renderSlicedDocument(targetPage = null) {
    if (!currentManifest) return;
    const container = document.getElementById("viewport-container");
    if (!container) return;

    if (pageObserver) pageObserver.disconnect();

    const fitWidth = getContainerFitWidth(container);
    const firstPageW = (currentManifest.pages && currentManifest.pages[0]) ? currentManifest.pages[0].width : 595;
    baseFitScale = fitWidth / Math.max(1, firstPageW);

    document.getElementById("zoom-text").textContent = Math.round(currentScale * 100) + "%";
    container.style.setProperty("--doc-scale", String(currentScale * baseFitScale));
    cachedRenderScale = currentScale;
    rememberLocalFile(currentFileId);

    const totalPages = currentManifest.pages.length;
    document.getElementById("total-pages-text").textContent = "/ " + totalPages;
    document.getElementById("page-indicator").style.display = totalPages > 0 ? "flex" : "none";

    const fragment = document.createDocumentFragment();
    for (let idx = 0; idx < totalPages; idx++) {
      fragment.appendChild(createPageWrapperElement(currentManifest.pages[idx], idx, fitWidth));
    }

    const jumpInp = document.getElementById("jump-page-input");
    const initialPage = targetPage !== null ? targetPage : ((jumpInp ? parseInt(jumpInp.value, 10) : 1) || 1);
    const firstWrapper = fragment.querySelector("#page-wrapper-" + initialPage) || fragment.children[0];

    if (firstWrapper) {
      const firstCanvas = firstWrapper.querySelector("canvas.page-img");
      const firstPdfPage = parseInt(firstWrapper.dataset.pdfPage || firstWrapper.dataset.page, 10);
      const cachedBlob = await getPageBitmap(currentFileId, firstPdfPage, cachedRenderScale);
      if (cachedBlob && firstCanvas) {
        const bmp = await createImageBitmap(cachedBlob);
        firstCanvas.width = bmp.width;
        firstCanvas.height = bmp.height;
        firstCanvas.dataset.renderedScale = String(cachedRenderScale);
        firstCanvas.getContext("2d").drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
      }
      buildTextLayerForWrapper(firstWrapper);
    }

    if (container.replaceChildren) {
      container.replaceChildren(fragment);
    } else {
      container.innerHTML = "";
      container.appendChild(fragment);
    }

    // Sau khi chèn vào DOM, cập nhật lại chính xác fitWidth thực tế (trừ thanh cuộn dọc)
    const exactFitW = getContainerFitWidth(container);
    baseFitScale = exactFitW / Math.max(1, firstPageW);
    container.style.setProperty("--doc-scale", String(currentScale * baseFitScale));
    container.querySelectorAll(".page-wrapper").forEach((w, idx) => {
      const pObj = currentManifest.pages[idx];
      if (pObj) {
        const pf = exactFitW / Math.max(1, pObj.width);
        w.dataset.baseFit = String(pf);
        w.style.setProperty("--doc-scale", String(currentScale * pf));
      }
    });

    if (firstWrapper) {
      const firstCanvas = firstWrapper.querySelector("canvas.page-img");
      const firstPdfPage = parseInt(firstWrapper.dataset.pdfPage || firstWrapper.dataset.page, 10);
      if (firstCanvas && !firstCanvas.dataset.renderedScale) {
        await renderPageToCanvas(firstCanvas, firstPdfPage);
      }
    }

    // Vẽ sẵn luôn trang kế tiếp nếu lộ trong màn hình
    const nextWrapper = firstWrapper ? firstWrapper.nextElementSibling : null;
    if (nextWrapper && nextWrapper.classList.contains("page-wrapper")) {
      const nextCanvas = nextWrapper.querySelector("canvas.page-img");
      const nextPdfPage = parseInt(nextWrapper.dataset.pdfPage || nextWrapper.dataset.page, 10);
      if (nextCanvas && !nextCanvas.dataset.renderedScale) {
        await renderPageToCanvas(nextCanvas, nextPdfPage);
      }
    }

    updateLoaderProgress(100);
    container.style.visibility = "visible"; // 👈 BẮT BUỘC PHẢI CÓ DÒNG NÀY
    hideLoading();
    jumpToPageNumber(initialPage, false);

    const wrappers = Array.from(container.querySelectorAll(".page-wrapper"));
    pageObserver = new IntersectionObserver((entries) => {
      if (isZooming) return;
      entries.forEach(entry => {
        const wrapper = entry.target;
        const canvas = wrapper.querySelector("canvas.page-img");
        if (!canvas) return;
        const targetPdfPage = parseInt(wrapper.dataset.pdfPage || wrapper.dataset.page, 10);

        if (entry.isIntersecting) {
          buildTextLayerForWrapper(wrapper);
          if (!scalesEqual(canvas.dataset.renderedScale, currentScale)) {
            renderPageToCanvas(canvas, targetPdfPage);
          }
        } else {
          if (!scrollLock && wrapper.dataset.page !== "1") {
            removeTextLayerFromWrapper(wrapper);
            if (canvas.dataset.renderedScale) {
              canvas.width = 1;
              canvas.height = 1;
              delete canvas.dataset.renderedScale;
            }
          }
        }
      });
    }, { root: container, rootMargin: "1600px 0px" });

    wrappers.forEach(el => pageObserver.observe(el));
    container.removeEventListener("scroll", updateCurrentPageOnScroll);
    container.addEventListener("scroll", updateCurrentPageOnScroll, { passive: true });
  }

  function zoomChange(delta, pointerX, pointerY) {
    if (!currentManifest) return;
    const vp = document.getElementById("viewport-container");
    if (!vp) return;

    const vpRect = vp.getBoundingClientRect();
    // Tự động nhận diện hệ số zoom của panel cha (0.8) để quy đổi tọa độ chuẩn 100%
    const panelZoom = parseFloat(window.getComputedStyle(vp.closest("#pl-dock-preview-panel") || vp).zoom) || 1.0;

    const px = (pointerX !== undefined) ? pointerX : (vpRect.left + vpRect.width / 2);
    const py = (pointerY !== undefined) ? pointerY : (vpRect.top + vpRect.height / 2);

    const prevScale = currentScale;
    const nextScale = Math.min(2.5, Math.max(0.4, Math.round((prevScale + delta) * 1000) / 1000));
    if (Math.abs(nextScale - prevScale) < 0.001) return;

    // 1. Chốt điểm neo thị giác tại vị trí mắt người dùng đang nhìn
    const anchor = findZoomAnchor(vp, px, py);

    cancelAllPageRenders();
    isZooming = true;
    currentScale = nextScale;

    // 2. Cập nhật scale mới
    vp.style.setProperty("--doc-scale", String(currentScale * baseFitScale));
    vp.querySelectorAll(".page-wrapper").forEach(w => {
      const pf = parseFloat(w.dataset.baseFit) || baseFitScale;
      w.style.setProperty("--doc-scale", String(currentScale * pf));
    });

    const zt = document.getElementById("zoom-text");
    if (zt) zt.textContent = Math.round(currentScale * 100) + "%";

    // 3. Ép reflow và bù trừ cuộn chính xác theo hệ số zoom 0.8 (Giữ nguyên điểm trỏ chuột)
    if (anchor && anchor.el) {
      anchor.el.offsetHeight; // Force reflow
      const newRect = anchor.el.getBoundingClientRect();
      const newScreenX = newRect.left + anchor.ratioX * newRect.width;
      const newScreenY = newRect.top + anchor.ratioY * newRect.height;

      // Chia cho panelZoom để chuyển từ Screen Pixels sang Scroll Pixels của Viewport
      vp.scrollLeft += (newScreenX - px) / panelZoom;
      vp.scrollTop += (newScreenY - py) / panelZoom;
    }

    clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(function() {
      isZooming = false;
      renderVisiblePagesOnly();
    }, 220);
  }

  function cancelAllPageRenders() {
    sharpenToken++;
    if (typeof activeRenderTasks === "undefined") return;
    activeRenderTasks.forEach(function(entry) {
      try { if (entry && entry.task) entry.task.cancel(); } catch (e) {}
    });
    activeRenderTasks.clear();
  }

  function findZoomAnchor(vp, px, py) {
    const nodes = vp.querySelectorAll(".page-wrapper");
    if (!nodes || nodes.length === 0) return null;
    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      let dx = 0;
      if (px < r.left) dx = r.left - px;
      else if (px > r.right) dx = px - r.right;

      let dy = 0;
      if (py < r.top) dy = r.top - py;
      else if (py > r.bottom) dy = py - r.bottom;

      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { el: nodes[i], rect: r };
        if (dist === 0) break; // Con trỏ chuột nằm chính xác bên trong trang này
      }
    }

    if (!best || !best.el) return null;
    const r = best.rect;
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    return {
      el: best.el,
      // Tỉ lệ tương đối trên trang (từ 0.0 đến 1.0), bất biến trước mọi khoảng cách lề
      ratioX: Math.min(1, Math.max(0, (px - r.left) / w)),
      ratioY: Math.min(1, Math.max(0, (py - r.top) / h))
    };
  }


  function renderVisiblePagesOnly() {
    if (!currentManifest || isZooming || scrollLock) return;
    const vp = document.getElementById("viewport-container");
    if (!vp) return;

    const vpRect = vp.getBoundingClientRect();
    const jobs = [];

    document.querySelectorAll(".page-wrapper").forEach(wrapper => {
      const r = wrapper.getBoundingClientRect();
      const isNearView = (r.bottom >= vpRect.top - 1200 && r.top <= vpRect.bottom + 1200);
      const canvas = wrapper.querySelector("canvas.page-img");
      if (!canvas) return;
      const targetPdfPage = parseInt(wrapper.dataset.pdfPage || wrapper.dataset.page, 10);

      if (isNearView) {
        buildTextLayerForWrapper(wrapper);
        if (!scalesEqual(canvas.dataset.renderedScale, currentScale)) {
          const mid = (r.top + r.bottom) / 2;
          const viewMid = (vpRect.top + vpRect.bottom) / 2;
          jobs.push({ canvas: canvas, targetPdfPage: targetPdfPage, dist: Math.abs(mid - viewMid) });
        }
      } else if (r.bottom < vpRect.top - 1800 || r.top > vpRect.bottom + 1800) {
        if (wrapper.dataset.page !== "1") {
          removeTextLayerFromWrapper(wrapper);
          if (canvas.dataset.renderedScale) {
            canvas.width = 1;
            canvas.height = 1;
            delete canvas.dataset.renderedScale;
          }
        }
      }
    });

    jobs.sort((a, b) => a.dist - b.dist);
    const myToken = ++sharpenToken;
    const scaleAtStart = currentScale;

    (async function() {
      for (let i = 0; i < jobs.length; i++) {
        if (myToken !== sharpenToken || isZooming || !scalesEqual(scaleAtStart, currentScale)) return;
        let live = jobs[i].canvas;
        if (!live.isConnected) {
          const wrap = document.getElementById("page-wrapper-" + live.dataset.page);
          live = wrap ? wrap.querySelector("canvas.page-img") : null;
        }
        if (!live || scalesEqual(live.dataset.renderedScale, currentScale)) continue;
        await renderPageToCanvas(live, jobs[i].targetPdfPage, scaleAtStart);
      }
    })();
  }


  function resetZoom() {
    if (!currentManifest) return;
    const vp = document.getElementById("viewport-container");
    const rect = vp.getBoundingClientRect();
    zoomChange(1.0 - currentScale, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  async function downloadPdfFromJson() {
    if (!currentFileId) {
      alert("Vui lòng mở một tài liệu trước khi tải về!");
      return;
    }

    showLoading("EXPORTING DOCUMENT", 0);
    try {
      const pdfData = await fetchPdfDirectOrFallback(currentFileId, (loaded, total) => {
        if (total > 0) updateLoaderProgress((loaded / total) * 100);
      });
      updateLoaderProgress(100);
      if (!pdfData || pdfData.byteLength === 0) {
        throw new Error("Không thể trích xuất dữ liệu nhị phân của file gốc.");
      }

      const blob = new Blob([pdfData], { type: "application/pdf" });
      const downloadUrl = URL.createObjectURL(blob);

      let downloadName = currentFileName || "TaiLieu_Drive.pdf";
      if (!downloadName.toLowerCase().endsWith(".pdf")) {
        downloadName += ".pdf";
      }

      const a = document.createElement("a");
      a.style.display = "none";
      a.href = downloadUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 2000);

      hideLoading();
    } catch (err) {
      hideLoading();
      console.error("Lỗi xuất file PDF:", err);
      if (currentFileId && !currentFileId.startsWith("local_")) {
        const slashes = String.fromCharCode(47, 47);
        window.open("https:" + slashes + "drive.google.com/uc?export=download&id=" + currentFileId, "_blank");
      } else {
        alert("Không thể tải file PDF: " + (err.message || err));
      }
    }
  }

  function renderPageToCanvas(canvas, targetPdfPage, lockedScale) {
    if (!canvas || isZooming) return Promise.resolve();
    const myEpoch = currentSessionEpoch;
    const renderScale = (lockedScale == null) ? currentScale : lockedScale;

    const prev = activeRenderTasks.get(targetPdfPage);
    if (prev) {
      if (scalesEqual(prev.scale, renderScale)) return prev.promise;
      try { if (prev.task) prev.task.cancel(); } catch (e) {}
      activeRenderTasks.delete(targetPdfPage);
    }

    let resolveJob;
    const promise = new Promise(function(resolve) { resolveJob = resolve; });
    const job = { task: null, scale: renderScale, promise: promise };
    activeRenderTasks.set(targetPdfPage, job);

    function finishJob() {
      if (activeRenderTasks.get(targetPdfPage) === job) activeRenderTasks.delete(targetPdfPage);
      resolveJob();
    }

    function ensurePdf() {
      if (currentPdfDoc) return Promise.resolve(currentPdfDoc);
      const pending = renderPageToCanvas._pdfPromise;
      if (pending && pending.epoch === currentSessionEpoch) return pending;
      const epoch = currentSessionEpoch;
      const fileId = currentFileId;
      const p = fetchPdfDirectOrFallback(fileId).then(function(data) {
        return pdfjsLib.getDocument({ data: data }).promise;
      }).then(function(pdf) {
        if (epoch !== currentSessionEpoch) {
          try { pdf.destroy(); } catch (e) {}
          throw new Error("ABORTED");
        }
        // Tự động phát hiện & sửa các file JSON số hóa cũ bị lệch trang trắng so với PDF gốc
        if (currentManifest && !currentManifest.mapsOriginalPdf && !currentManifest._repairing && pdf.numPages !== currentManifest.numPages) {
          currentManifest._repairing = true;
          delete SESSION_MANIFEST_CACHE[fileId];
          try { pdf.destroy(); } catch (e) {}
          setTimeout(() => {
            if (epoch === currentSessionEpoch) processAndOptimizeFileJIT(fileId);
          }, 50);
          throw new Error("REPAIR_OLD_MANIFEST");
        }
        currentPdfDoc = pdf;
        return pdf;
      }).catch(function(err) {
        if (renderPageToCanvas._pdfPromise === p) renderPageToCanvas._pdfPromise = null;
        throw err;
      });
      p.epoch = epoch;
      renderPageToCanvas._pdfPromise = p;
      return p;
    }

    function drawPdfPage() {
      ensurePdf().then(function(pdf) {
        return pdf.getPage(targetPdfPage);
      }).then(function(page) {
        if (activeRenderTasks.get(targetPdfPage) !== job || myEpoch !== currentSessionEpoch || isZooming || !scalesEqual(renderScale, currentScale) || !canvas.isConnected) {
          page.cleanup();
          finishJob();
          return;
        }

        const wrapperEl = canvas.closest(".page-wrapper");
        const extraRot = parseInt((wrapperEl ? wrapperEl.dataset.rotation : "0") || "0", 10);
        const effectiveRot = (page.rotate + extraRot) % 360;

        const pageFit = parseFloat(wrapperEl?.dataset.baseFit) || baseFitScale || 1.0;
        const panelEl = document.getElementById("pl-dock-preview-panel");
        const panelZoom = parseFloat(window.getComputedStyle(panelEl || canvas).zoom) || 1.0;
        const rawDpr = window.devicePixelRatio || 1;

        // Tính đúng tỷ lệ hiển thị thực trên màn hình rồi nhân siêu lấy mẫu để luôn sắc nét
        const displayScale = renderScale * pageFit * panelZoom;
        const sharpBoost = Math.max(rawDpr * 1.35, 1.85);
        let effectiveScale = displayScale * sharpBoost;

        // Chặn trần an toàn theo pixel tối đa của GPU (4800px cạnh dài) thay vì kẹp cứng 3.0
        const vp1 = page.getViewport({ scale: 1.0, rotation: effectiveRot });
        const maxPageDim = Math.max(vp1.width, vp1.height) || 842;
        const MAX_CANVAS_PX = 4800;
        if (maxPageDim * effectiveScale > MAX_CANVAS_PX) {
          effectiveScale = MAX_CANVAS_PX / maxPageDim;
        }

        const viewport = page.getViewport({ scale: effectiveScale, rotation: effectiveRot });
        const newW = Math.max(1, Math.floor(viewport.width));
        const newH = Math.max(1, Math.floor(viewport.height));

        const offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = newW;
        offscreenCanvas.height = newH;
        const offCtx = offscreenCanvas.getContext("2d");
        offCtx.fillStyle = "#ffffff";
        offCtx.fillRect(0, 0, newW, newH);

        const renderTask = page.render({
          canvasContext: offCtx,
          viewport: viewport,
          intent: "display"
        });
        job.task = renderTask;

        renderTask.promise.then(function() {
          page.cleanup();
          if (activeRenderTasks.get(targetPdfPage) !== job || myEpoch !== currentSessionEpoch || isZooming || !scalesEqual(renderScale, currentScale) || !canvas.isConnected) {
            offscreenCanvas.width = 0;
            offscreenCanvas.height = 0;
            finishJob();
            return;
          }

          canvas.width = newW;
          canvas.height = newH;
          canvas.dataset.renderedScale = String(renderScale);
          canvas.getContext("2d").drawImage(offscreenCanvas, 0, 0);
          savePageBitmap(currentFileId, targetPdfPage, renderScale, canvas);

          offscreenCanvas.width = 0;
          offscreenCanvas.height = 0;
          finishJob();
        }).catch(function() {
          try { page.cleanup(); } catch (e) {}
          offscreenCanvas.width = 0;
          offscreenCanvas.height = 0;
          finishJob();
        });
      }).catch(function() {
        finishJob();
      });
    }

    getPageBitmap(currentFileId, targetPdfPage, renderScale).then(function(blob) {
      if (blob && canvas.isConnected && !isZooming && myEpoch === currentSessionEpoch && scalesEqual(renderScale, currentScale)) {
        paintBitmapBlob(canvas, blob, targetPdfPage, renderScale).then(finishJob).catch(finishJob);
        return;
      }
      drawPdfPage();
    }).catch(function() {
      drawPdfPage();
    });

    return promise;
  }

  function toggleFullScreen() {
    const panel = document.getElementById("pl-dock-preview-panel") || document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (panel.requestFullscreen) {
        panel.requestFullscreen().catch(() => {});
      } else if (panel.webkitRequestFullscreen) {
        panel.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  function updateFullscreenIconState() {
    const btn = document.getElementById("btn-fullscreen");
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (btn) {
      const icon = btn.querySelector("i");
      if (icon) icon.className = isFull ? "bi bi-fullscreen-exit" : "bi bi-fullscreen";
      btn.setAttribute("data-tip", isFull ? "Exit full screen (Esc)" : "Full screen");
    }

    // Chờ 1 nhịp layout ổn định rồi vẽ lại nét căng theo kích thước mới
    setTimeout(() => {
      if (!isFull && typeof syncPrvSplitLayout_PL === "function") {
        syncPrvSplitLayout_PL();
      } else if (window.BconsViewer && typeof window.BconsViewer.refreshFitWidth === "function") {
        window.BconsViewer.refreshFitWidth();
      }
    }, 60);
  }

  document.addEventListener("fullscreenchange", updateFullscreenIconState);
  document.addEventListener("webkitfullscreenchange", updateFullscreenIconState);

  function copyShareLink() {
    if (!currentFileId || currentFileId.startsWith("local_")) {
      alert("Vui lòng đợi tài liệu đồng bộ xong lên Google Drive trước khi lấy link!");
      return;
    }

    const slashes = String.fromCharCode(47, 47);
    const driveUrl = "https:" + slashes + "drive.google.com/file/d/" + currentFileId + "/preview";
    const shareBtn = document.getElementById("btn-share-link");

    navigator.clipboard.writeText(driveUrl).then(() => {
      if (shareBtn) {
        const oldHtml = shareBtn.innerHTML;
        const oldTip = shareBtn.getAttribute("data-tip");

        shareBtn.innerHTML = '<i class="bi bi-check2" style="font-size: 13px; color: #00e676;"></i>';
        shareBtn.setAttribute("data-tip", "Copied Drive Link!");

        setTimeout(() => { 
          shareBtn.innerHTML = oldHtml;
          shareBtn.setAttribute("data-tip", oldTip);
        }, 1500);
      }
    }).catch(() => {
      prompt("Copy link Google Drive:", driveUrl);
    });

    googleScriptRun.makeFilePublicAndGetLink(currentFileId);
  }

  // =========================================================================
  // PHẦN 5: GẮN SỰ KIỆN VÀO WINDOW & PUBLIC FACADE CHO COCAINE
  // =========================================================================
  window.handleSmartScrollUp = handleSmartScrollUp;
  window.handleSmartScrollDown = handleSmartScrollDown;
  window.handleSearchKey = handleSearchKey;
  window.handleSearchSubmit = handleSearchSubmit;
  window.navigateMatch = navigateMatch;
  window.zoomChange = zoomChange;
  window.resetZoom = resetZoom;
  window.handlePageJumpKey = handlePageJumpKey;
  window.toggleFullScreen = toggleFullScreen;
  window.downloadPdfFromJson = downloadPdfFromJson;
  window.copyShareLink = copyShareLink;

  // THỰC THI SỐ HÓA LẠI NGAY LẬP TỨC (KHÔNG CẦN HỎI)
  window.forceRedigitizeCurrentFile = function() {
    if (!currentFileId) return;

    // Chặn số hóa lại nếu đây là file Phụ lục/Phê duyệt giá
    if (isPlOrPdgFile(currentFileName)) {
      if (typeof showToast_PL === "function") {
        showToast_PL("⚠️ Tài liệu này đang mở ở chế độ Xem trực tiếp, không áp dụng số hóa lại.", "error");
      }
      return;
    }

    if (typeof showToast_PL === "function") {
      showToast_PL("🚀 Đang số hóa lại tài liệu bằng AI...", "success");
    }

    // Tăng Epoch để hủy ngay lập tức các tiến trình vẽ Canvas đang dang dở
    currentSessionEpoch++;
    
    // Xóa sạch Cache bản số hóa cũ của file này trên RAM
    delete SESSION_MANIFEST_CACHE[currentFileId];
    
    // Bật Loading Mờ đen và chạy lại quét AI từ đầu
    processAndOptimizeFileJIT(currentFileId);
  };

window.BconsViewer = {
    warmToken: function() {
      if (!cachedDriveToken || Date.now() >= driveTokenExpiresAt) {
        getDriveTokenAsync().catch(() => {});
      }
    },
    loadFile: function(fileId, fileName, sizeMB) {
      loadFile(fileId, fileName, sizeMB);
    },
    search: function(keyword) {
      const input = document.getElementById("ai-search-input");
      if (input) {
        input.value = keyword;
        executeSearch();
      }
    },
    jumpToPage: function(p) {
      jumpToPageNumber(p, true);
    },
    refreshFitWidth: function() {
      if (!currentManifest || !currentManifest.pages.length) return;
      const container = document.getElementById("viewport-container");
      if (!container) return;
      const oldFit = baseFitScale;
      const exactFitW = getContainerFitWidth(container);
      const firstPageW = currentManifest.pages[0].width || 595;
      baseFitScale = exactFitW / Math.max(1, firstPageW);
      container.style.setProperty("--doc-scale", String(currentScale * baseFitScale));
      container.querySelectorAll(".page-wrapper").forEach((w, idx) => {
        const pObj = currentManifest.pages[idx];
        if (pObj) {
          const pf = exactFitW / Math.max(1, pObj.width);
          w.dataset.baseFit = String(pf);
          w.style.setProperty("--doc-scale", String(currentScale * pf));
        }
      });

      // Nếu kích thước khung hoặc tỷ lệ zoom (0.8 <-> 1.0) thay đổi, hủy render cũ và vẽ lại siêu nét
      const panelEl = document.getElementById("pl-dock-preview-panel");
      const curZoom = parseFloat(window.getComputedStyle(panelEl || container).zoom) || 1.0;
      const zoomChanged = (window.BconsViewer._lastZoom !== undefined && window.BconsViewer._lastZoom !== curZoom);
      window.BconsViewer._lastZoom = curZoom;

      if (Math.abs(baseFitScale - oldFit) > 0.02 || zoomChanged) {
        cancelAllPageRenders();
        container.querySelectorAll("canvas.page-img").forEach(c => {
          delete c.dataset.renderedScale;
        });
        renderVisiblePagesOnly();
      }
    },
    close: function() {
      currentSessionEpoch++;
      if (activeFetchAbortController) {
        activeFetchAbortController.abort();
        activeFetchAbortController = null;
      }
      hideLoading();
      setAntiExitGuard(false);
      cancelAllPageRenders();
      if (pageObserver) {
        pageObserver.disconnect();
        pageObserver = null;
      }
      if (currentPdfDoc) {
        try { currentPdfDoc.destroy(); } catch (e) {}
        currentPdfDoc = null;
      }
      currentManifest = null;
      currentFileId = null;
      const vp = document.getElementById("viewport-container");
      if (vp) {
        vp.innerHTML = "";
        vp.style.visibility = "visible";
      }
      const pageInd = document.getElementById("page-indicator");
      if (pageInd) pageInd.style.display = "none";
      clearSearchState();
      stopBackgroundKeepAlive();
    }
  };
})();