// =========================================================================
// BCONS DOCUMENT VIEWER - MODULE 1/4: STATE, STORAGE, GZIP & PROGRESS UI
// =========================================================================

(() => {
    if (typeof pdfjsLib !== "undefined" && pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    const BV = (window.__BconsViewer = window.__BconsViewer || {});

    // =========================================================================
    // CẤU HÌNH & CẦU NỐI BACKEND BCONS-VIEWER (CLOUD VISION AI)
    // =========================================================================
    const GAS_WEB_APP_URL =
        "https://script.google.com/macros/s/AKfycbwlhByeOZIdDs4dIpioMo4e-2On3ad317kjoFMobpPiNUjtYi3o8Aa_jCXuoUWRucVJ/exec";

    function createGasBridge(onSuccess, onFailure) {
        return new Proxy(
            {},
            {
                get: function (_, prop) {
                    if (prop === "withSuccessHandler") {
                        return function (fn) {
                            return createGasBridge(fn, onFailure);
                        };
                    }
                    if (prop === "withFailureHandler") {
                        return function (fn) {
                            return createGasBridge(onSuccess, fn);
                        };
                    }
                    return function (...args) {
                        const payload = args.length === 1 ? args[0] : args;
                        callBackend(prop, payload)
                            .then((data) => {
                                if (onSuccess) onSuccess(data);
                            })
                            .catch((err) => {
                                if (onFailure) onFailure(err);
                            });
                    };
                }
            }
        );
    }

    const googleScriptRun =
        typeof window.google !== "undefined" && window.google.script && window.google.script.run
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
                console.log(
                    `%c🧹 [LRU CACHE] Giải phóng RAM file: ${evictedId} (Đã có IndexedDB sao lưu)`,
                    "color: #78909c;"
                );
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
        S.dbPromise = new Promise(function (resolve, reject) {
            const req = indexedDB.open(DB_NAME, 14);
            req.onupgradeneeded = function (e) {
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
            req.onsuccess = function () {
                resolve(req.result);
            };
            req.onerror = function () {
                S.dbPromise = null;
                reject(req.error);
            };
            req.onblocked = function () {
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
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(storeName, "readonly");
                    const req = tx.objectStore(storeName).get(key);
                    req.onsuccess = function () {
                        resolve(req.result == null ? null : req.result);
                    };
                    req.onerror = function () {
                        resolve(null);
                    };
                });
            })
            .catch(function () {
                return null;
            });
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

        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PDF_STORE, "readwrite");
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                    tx.objectStore(PDF_STORE).put(copyBuf, fileId);
                });
            })
            .then(function (ok) {
                rememberLocalFile(fileId);
                return ok;
            })
            .catch(function () {
                return false;
            });
    }

    function deleteLocalPdfBinary(fileId) {
        if (!fileId) return Promise.resolve(false);
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PDF_STORE, "readwrite");
                    tx.objectStore(PDF_STORE).delete(fileId);
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                });
            })
            .catch(function () {
                return false;
            });
    }

    function getLocalManifest(fileId) {
        return idbGet(STORE_NAME, fileId).then(function (row) {
            return row && row.manifest ? row.manifest : null;
        });
    }

    function saveLocalManifest(fileId, manifest) {
        if (!fileId) return Promise.resolve(false);
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(STORE_NAME, "readwrite");
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                    tx.objectStore(STORE_NAME).put({ fileId: fileId, manifest: manifest });
                });
            })
            .catch(function () {
                return false;
            });
    }

    function deleteLocalManifest(fileId) {
        if (!fileId) return Promise.resolve(false);
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(STORE_NAME, "readwrite");
                    tx.objectStore(STORE_NAME).delete(fileId);
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                });
            })
            .catch(function () {
                return false;
            });
    }

    function getPageBitmap(fileId, pdfPage, scale) {
        if (!fileId || String(fileId).indexOf("local_") === 0) return Promise.resolve(null);
        if (!scalesEqual(scale, S.cachedRenderScale)) return Promise.resolve(null);
        return idbGet(PAGE_STORE, bitmapKey(fileId, pdfPage, scale));
    }

    function savePageBitmap(fileId, pdfPage, scale, canvas) {
        if (!fileId || String(fileId).indexOf("local_") === 0 || !canvas) return Promise.resolve(false);
        if (!scalesEqual(scale, S.cachedRenderScale)) return Promise.resolve(false);
        return new Promise(function (resolve) {
            canvas.toBlob(
                function (blob) {
                    if (!blob) {
                        resolve(false);
                        return;
                    }
                    openDB()
                        .then(function (db) {
                            const tx = db.transaction(PAGE_STORE, "readwrite");
                            tx.oncomplete = function () {
                                resolve(true);
                            };
                            tx.onerror = function () {
                                resolve(false);
                            };
                            tx.objectStore(PAGE_STORE).put(blob, bitmapKey(fileId, pdfPage, scale));
                        })
                        .catch(function () {
                            resolve(false);
                        });
                },
                "image/jpeg",
                0.88
            );
        });
    }

    function clearFilePageBitmaps(fileId) {
        if (!fileId) return Promise.resolve(false);
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PAGE_STORE, "readwrite");
                    const cursorReq = tx.objectStore(PAGE_STORE).openCursor();
                    cursorReq.onsuccess = function () {
                        const cursor = cursorReq.result;
                        if (!cursor) return;
                        if (String(cursor.key).indexOf(fileId + "|") === 0) cursor.delete();
                        cursor.continue();
                    };
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                });
            })
            .catch(function () {
                return false;
            });
    }

    function rememberLocalFile(fileId) {
        if (!fileId || String(fileId).indexOf("local_") === 0) return Promise.resolve(false);
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction([PAGE_STORE, PDF_STORE], "readwrite");
                    const pages = tx.objectStore(PAGE_STORE);
                    const pdfs = tx.objectStore(PDF_STORE);
                    const getLru = pages.get("__lru__");
                    getLru.onsuccess = function () {
                        let list = Array.isArray(getLru.result)
                            ? getLru.result.filter(function (id) {
                                  return id !== fileId;
                              })
                            : [];
                        list.unshift(fileId);
                        const removed = list.slice(MAX_LOCAL_FILES);
                        list = list.slice(0, MAX_LOCAL_FILES);
                        pages.put(list, "__lru__");
                        removed.forEach(function (id) {
                            pdfs.delete(id);
                        });
                        if (!removed.length) return;
                        const cursorReq = pages.openCursor();
                        cursorReq.onsuccess = function () {
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
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                });
            })
            .catch(function () {
                return false;
            });
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
            window.onbeforeunload = function (e) {
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
    // PL01 YEARLY SHARDED INDEX CACHE, DICTIONARY & WEIGHTED SEARCH ENGINE
    // =========================================================================
    const PL01_DICT_STORAGE_KEY = "bcons_pl01_dictionary_v1";
    const PL01_DEFAULT_SCORING = {
        weights: { structures: 40, materials: 40, actions: 20, specs: 20 },
        multi_structure_primary_ratio: 0.7,
        tiers: { exact: 100, high: 65, medium: 50 }
    };

    const PL01_DICT_STATE = {
        ready: false,
        version: 0,
        lastUpdated: "",
        loadPromise: null,
        scoring: {
            weights: { ...PL01_DEFAULT_SCORING.weights },
            multi_structure_primary_ratio: PL01_DEFAULT_SCORING.multi_structure_primary_ratio,
            tiers: { ...PL01_DEFAULT_SCORING.tiers }
        },
        synByLenAcc: new Map(),
        synByLenUnacc: new Map(),
        maxSynLen: 1,
        protectedMultiWordsAcc: new Set(),
        dictByLenAcc: new Map(),
        dictByLenUnacc: new Map(),
        maxDictLen: 1
    };

    const PL01_INDEX_STATE = {
        ready: false,
        syncing: false,
        syncPromise: null,
        lastMetaCheckAt: 0,
        years: {},
        byMaHD: new Map(),
        byFileId: new Map()
    };

    function stripPl01Accents(str) {
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
            .toLowerCase();
    }

    function hasVietnameseDiacritics(str) {
        if (!str) return false;
        return String(str).normalize("NFC").toLowerCase() !== stripPl01Accents(str);
    }

    function normalizePl01SearchStr(str) {
        if (!str) return "";
        return stripPl01Accents(str)
            .replace(/(\d)[.,](?=\d)/g, "$1")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    function normalizePl01AccentedStr(str) {
        if (!str) return "";
        return String(str)
            .normalize("NFC")
            .toLowerCase()
            .replace(/(\d)[.,](?=\d)/g, "$1\uE001")
            .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\uE001]+/g, " ")
            .replace(/\uE001/g, ".")
            .replace(/\s+/g, " ")
            .trim();
    }

    function tokenizeRawLineWithOffsets(rawLine) {
        const tokens = [];
        const re = /(?:[A-Za-z0-9\u00C0-\u024F\u1E00-\u1EFF]|(?<=\d)[.,](?=\d))+/g;
        let m;
        while ((m = re.exec(rawLine)) !== null) {
            const normAcc = normalizePl01AccentedStr(m[0]);
            const normUnacc = normalizePl01SearchStr(m[0]);
            if (!normUnacc) continue;
            tokens.push({
                normAcc: normAcc || normUnacc,
                norm: normUnacc,
                normUnacc: normUnacc,
                start: m.index,
                end: m.index + m[0].length
            });
        }
        return tokens;
    }

    function applyPl01SynonymsToTokenObjs(tokenObjs) {
        if (!tokenObjs || tokenObjs.length === 0) return [];
        const maxLen = PL01_DICT_STATE.maxSynLen || 1;
        const out = [];
        let i = 0;

        while (i < tokenObjs.length) {
            const firstAcc = tokenObjs[i].normAcc;
            let skipOneWordSyn = false;

            // Bảo vệ các cụm đa từ chuẩn (vd: "sản xuất") khỏi bị từ đơn vá lỗi OCR ("sản": "sàn") thay nhầm
            if (PL01_DICT_STATE.protectedMultiWordsAcc.size > 0 && i + 1 < tokenObjs.length) {
                for (let pLen = Math.min(4, tokenObjs.length - i); pLen >= 2; pLen--) {
                    const phraseAcc = tokenObjs
                        .slice(i, i + pLen)
                        .map((t) => t.normAcc)
                        .join(" ");
                    if (PL01_DICT_STATE.protectedMultiWordsAcc.has(phraseAcc)) {
                        skipOneWordSyn = true;
                        break;
                    }
                }
            }

            let matchedSyn = null;
            let matchedLen = 0;
            const tryMax = Math.min(maxLen, tokenObjs.length - i);

            for (let len = tryMax; len >= 1; len--) {
                if (len === 1 && skipOneWordSyn) continue;
                const slice = tokenObjs.slice(i, i + len);
                const keyAcc = slice.map((t) => t.normAcc).join(" ");
                const mapAcc = PL01_DICT_STATE.synByLenAcc.get(len);
                if (mapAcc && mapAcc.has(keyAcc)) {
                    matchedSyn = mapAcc.get(keyAcc);
                    matchedLen = len;
                    break;
                }
                const sliceHasAcc = slice.some((t) => hasVietnameseDiacritics(t.normAcc));
                if (!sliceHasAcc) {
                    const keyUnacc = slice.map((t) => t.normUnacc).join(" ");
                    const mapUnacc = PL01_DICT_STATE.synByLenUnacc.get(len);
                    if (mapUnacc && mapUnacc.has(keyUnacc)) {
                        matchedSyn = mapUnacc.get(keyUnacc);
                        matchedLen = len;
                        break;
                    }
                }
            }

            if (matchedSyn) {
                const origStart = tokenObjs[i].start;
                const origEnd = tokenObjs[i + matchedLen - 1].end;
                const origIndices = [];
                for (let k = i; k < i + matchedLen; k++) origIndices.push(k);
                for (let r = 0; r < matchedSyn.length; r++) {
                    out.push({
                        normAcc: matchedSyn[r].normAcc,
                        normUnacc: matchedSyn[r].normUnacc,
                        hasAcc: hasVietnameseDiacritics(matchedSyn[r].normAcc),
                        origIndices: origIndices,
                        start: origStart,
                        end: origEnd
                    });
                }
                i += matchedLen;
            } else {
                const t = tokenObjs[i];
                out.push({
                    normAcc: t.normAcc,
                    normUnacc: t.normUnacc,
                    hasAcc: hasVietnameseDiacritics(t.normAcc),
                    origIndices: [i],
                    start: t.start,
                    end: t.end
                });
                i += 1;
            }
        }
        return out;
    }

    function normalizeTextThroughSynonyms(rawText) {
        const toks = tokenizeRawLineWithOffsets(String(rawText || ""));
        return applyPl01SynonymsToTokenObjs(toks);
    }

    function compilePl01Dictionary(dictJson) {
        if (!dictJson || typeof dictJson !== "object") return false;

        const sc = dictJson.scoring_config || {};
        const w = sc.weights || {};
        const t = sc.tiers || {};
        PL01_DICT_STATE.scoring = {
            weights: {
                structures: Number(w.structures) > 0 ? Number(w.structures) : PL01_DEFAULT_SCORING.weights.structures,
                materials: Number(w.materials) > 0 ? Number(w.materials) : PL01_DEFAULT_SCORING.weights.materials,
                actions: Number(w.actions) > 0 ? Number(w.actions) : PL01_DEFAULT_SCORING.weights.actions,
                specs: Number(w.specs) > 0 ? Number(w.specs) : PL01_DEFAULT_SCORING.weights.specs
            },
            multi_structure_primary_ratio:
                Number(sc.multi_structure_primary_ratio) > 0 && Number(sc.multi_structure_primary_ratio) < 1
                    ? Number(sc.multi_structure_primary_ratio)
                    : PL01_DEFAULT_SCORING.multi_structure_primary_ratio,
            tiers: {
                exact: Number(t.exact) > 0 ? Number(t.exact) : PL01_DEFAULT_SCORING.tiers.exact,
                high: Number(t.high) > 0 ? Number(t.high) : PL01_DEFAULT_SCORING.tiers.high,
                medium: Number(t.medium) > 0 ? Number(t.medium) : PL01_DEFAULT_SCORING.tiers.medium
            }
        };

        const synByLenAcc = new Map();
        const synByLenUnacc = new Map();
        let maxSynLen = 1;
        const rawSyns = dictJson.manual_synonyms || {};
        Object.keys(rawSyns).forEach((rawKey) => {
            const normKeyAcc = normalizePl01AccentedStr(rawKey);
            const normKeyUnacc = normalizePl01SearchStr(rawKey);
            const valAcc = normalizePl01AccentedStr(rawSyns[rawKey]);
            if (!normKeyAcc || !valAcc) return;
            const keyWordsAcc = normKeyAcc.split(" ").filter(Boolean);
            const keyWordsUnacc = normKeyUnacc.split(" ").filter(Boolean);
            const valWords = valAcc
                .split(" ")
                .filter(Boolean)
                .map((wAcc) => ({
                    normAcc: wAcc,
                    normUnacc: normalizePl01SearchStr(wAcc)
                }))
                .filter((x) => x.normUnacc);
            if (keyWordsAcc.length === 0 || valWords.length === 0) return;

            const kLen = keyWordsAcc.length;
            if (kLen > maxSynLen) maxSynLen = kLen;
            if (!synByLenAcc.has(kLen)) synByLenAcc.set(kLen, new Map());
            synByLenAcc.get(kLen).set(keyWordsAcc.join(" "), valWords);

            if (keyWordsUnacc.length === kLen && !hasVietnameseDiacritics(normKeyAcc)) {
                if (!synByLenUnacc.has(kLen)) synByLenUnacc.set(kLen, new Map());
                synByLenUnacc.get(kLen).set(keyWordsUnacc.join(" "), valWords);
            }
        });

        PL01_DICT_STATE.synByLenAcc = synByLenAcc;
        PL01_DICT_STATE.synByLenUnacc = synByLenUnacc;
        PL01_DICT_STATE.maxSynLen = maxSynLen;

        // Thu thập các cụm đa từ dễ bị từ đơn vá lỗi OCR làm hỏng (vd: "sản": "sàn" làm hỏng "sản xuất")
        const protectedMulti = new Set(["sản xuất", "sản xuất lắp dựng", "cảnh quan", "cảnh báo"]);
        const ae = dictJson.auto_extracted || {};
        const allRawLists = [
            ...(Array.isArray(ae.structures) ? ae.structures : []),
            ...(Array.isArray(ae.materials) ? ae.materials : []),
            ...(Array.isArray(ae.actions) ? ae.actions : [])
        ];
        const ocrConfusedPrefixes = new Set(["sản", "cảnh", "tưởng", "phỏng"]);
        allRawLists.forEach((phrase) => {
            const norm = normalizePl01AccentedStr(phrase);
            if (!norm) return;
            const parts = norm.split(" ").filter(Boolean);
            if (parts.length >= 2 && ocrConfusedPrefixes.has(parts[0])) {
                protectedMulti.add(parts.join(" "));
            }
        });
        PL01_DICT_STATE.protectedMultiWordsAcc = protectedMulti;

        const dictByLenAcc = new Map();
        const dictByLenUnacc = new Map();
        let maxDictLen = 1;
        const categoryOrder = ["structures", "materials", "actions"];
        categoryOrder.forEach((cat) => {
            const list = Array.isArray(ae[cat]) ? ae[cat] : [];
            list.forEach((rawPhrase) => {
                const synToks = normalizeTextThroughSynonyms(rawPhrase);
                if (synToks.length === 0) return;
                const len = synToks.length;
                if (len > maxDictLen) maxDictLen = len;
                const accPhrase = synToks.map((t) => t.normAcc).join(" ");
                const unaccPhrase = synToks.map((t) => t.normUnacc).join(" ");
                const entry = {
                    category: cat,
                    raw: String(rawPhrase).trim(),
                    accPhrase: accPhrase,
                    unaccPhrase: unaccPhrase,
                    words: synToks.map((t) => ({ acc: t.normAcc, unacc: t.normUnacc }))
                };

                if (!dictByLenAcc.has(len)) dictByLenAcc.set(len, new Map());
                if (!dictByLenAcc.get(len).has(accPhrase)) {
                    dictByLenAcc.get(len).set(accPhrase, entry);
                }

                if (!dictByLenUnacc.has(len)) dictByLenUnacc.set(len, new Map());
                if (!dictByLenUnacc.get(len).has(unaccPhrase)) {
                    dictByLenUnacc.get(len).set(unaccPhrase, entry);
                }
            });
        });

        PL01_DICT_STATE.dictByLenAcc = dictByLenAcc;
        PL01_DICT_STATE.dictByLenUnacc = dictByLenUnacc;
        PL01_DICT_STATE.maxDictLen = maxDictLen;
        PL01_DICT_STATE.lastUpdated = String(dictJson.last_updated || "");
        PL01_DICT_STATE.version += 1;
        PL01_DICT_STATE.ready = true;
        return true;
    }

    function hydratePl01DictionaryFromCache() {
        try {
            const raw = localStorage.getItem(PL01_DICT_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            return compilePl01Dictionary(parsed);
        } catch (_) {
            return false;
        }
    }

    async function loadPl01Dictionary(forceRefresh = false) {
        if (PL01_DICT_STATE.loadPromise && !forceRefresh) {
            return PL01_DICT_STATE.loadPromise;
        }
        const run = (async () => {
            if (!PL01_DICT_STATE.ready) {
                hydratePl01DictionaryFromCache();
            }
            try {
                const res = await fetch("./Dictionary.json", { cache: "no-cache" });
                if (!res.ok) return PL01_DICT_STATE.ready;
                const dictJson = await res.json();
                const remoteVer = String(dictJson.last_updated || "");
                if (forceRefresh || !PL01_DICT_STATE.ready || remoteVer !== PL01_DICT_STATE.lastUpdated) {
                    compilePl01Dictionary(dictJson);
                    try {
                        localStorage.setItem(PL01_DICT_STORAGE_KEY, JSON.stringify(dictJson));
                    } catch (_) {}
                    if (
                        typeof activeTabId !== "undefined" &&
                        activeTabId === "tab-plhd" &&
                        typeof executeFilter_PL === "function"
                    ) {
                        const inp0 = document.getElementById("field0-pl");
                        if (inp0 && inp0.value.includes("#")) {
                            executeFilter_PL(false, false, true, true);
                        }
                    }
                }
                return true;
            } catch (err) {
                console.warn("Không thể tải Dictionary.json mới, dùng bản cache localStorage:", err);
                return PL01_DICT_STATE.ready;
            } finally {
                PL01_DICT_STATE.loadPromise = null;
            }
        })();
        PL01_DICT_STATE.loadPromise = run;
        return run;
    }

    hydratePl01DictionaryFromCache();
    loadPl01Dictionary(false);

    function getLocalPl01Index(year) {
        return idbGet(PL01_INDEX_STORE, String(year));
    }

    function getAllLocalPl01Indexes() {
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PL01_INDEX_STORE, "readonly");
                    const req = tx.objectStore(PL01_INDEX_STORE).getAll();
                    req.onsuccess = function () {
                        resolve(Array.isArray(req.result) ? req.result : []);
                    };
                    req.onerror = function () {
                        resolve([]);
                    };
                });
            })
            .catch(function () {
                return [];
            });
    }

    function saveLocalPl01Index(year, updatedAt, indexObj) {
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PL01_INDEX_STORE, "readwrite");
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                    tx.objectStore(PL01_INDEX_STORE).put({
                        year: String(year),
                        updatedAt: Number(updatedAt) || Date.now(),
                        indexObj: indexObj
                    });
                });
            })
            .catch(function () {
                return false;
            });
    }

    function clearLocalPl01Indexes() {
        PL01_INDEX_STATE.years = {};
        PL01_INDEX_STATE.byMaHD.clear();
        PL01_INDEX_STATE.byFileId.clear();
        PL01_INDEX_STATE.ready = false;
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PL01_INDEX_STORE, "readwrite");
                    tx.objectStore(PL01_INDEX_STORE).clear();
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                });
            })
            .catch(function () {
                return false;
            });
    }

    function deleteLocalPl01IndexYear(year) {
        return openDB()
            .then(function (db) {
                return new Promise(function (resolve) {
                    const tx = db.transaction(PL01_INDEX_STORE, "readwrite");
                    tx.objectStore(PL01_INDEX_STORE).delete(String(year));
                    tx.oncomplete = function () {
                        resolve(true);
                    };
                    tx.onerror = function () {
                        resolve(false);
                    };
                });
            })
            .catch(function () {
                return false;
            });
    }

    function rebuildPl01MemoryMaps() {
        PL01_INDEX_STATE.byMaHD.clear();
        PL01_INDEX_STATE.byFileId.clear();

        const years = Object.keys(PL01_INDEX_STATE.years).sort((a, b) => Number(b) - Number(a));
        years.forEach((y) => {
            const idxObj = PL01_INDEX_STATE.years[y];
            if (!idxObj || !idxObj.files) return;

            Object.keys(idxObj.files).forEach((fileId) => {
                const entry = idxObj.files[fileId];
                if (!entry || !entry.maHD || !Array.isArray(entry.pages)) return;

                const compiledPages = entry.pages.map((pTuple) => {
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
                    apStart: Number(entry.apStart) || compiledPages[0]?.pageNum || 1,
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
                localRows.forEach((row) => {
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
                const remoteYears = new Set(metaList.map((m) => String(m.year)));
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

                    const isStale = forceRefresh || !cached || Number(meta.updatedAt) !== Number(cached.updatedAt);

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
                if (
                    anyUpdated &&
                    typeof activeTabId !== "undefined" &&
                    activeTabId === "tab-plhd" &&
                    typeof executeFilter_PL === "function"
                ) {
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

    function getCompiledBoqLine(block) {
        const curVer = PL01_DICT_STATE.version;
        if (block._compiledDictVer === curVer && block._compiledBoq) {
            return block._compiledBoq;
        }
        const origTokens = tokenizeRawLineWithOffsets(block.raw);
        const synTokens = applyPl01SynonymsToTokenObjs(origTokens);
        const accSet = new Set();
        const unaccSet = new Set();
        let accPad = " ";
        let unaccPad = " ";

        for (let i = 0; i < synTokens.length; i++) {
            const st = synTokens[i];
            accSet.add(st.normAcc);
            unaccSet.add(st.normUnacc);
            accPad += st.normAcc + " ";
            unaccPad += st.normUnacc + " ";
        }

        const compiled = {
            origTokens: origTokens,
            synTokens: synTokens,
            accSet: accSet,
            unaccSet: unaccSet,
            accPad: accPad,
            unaccPad: unaccPad
        };
        block._compiledDictVer = curVer;
        block._compiledBoq = compiled;
        return compiled;
    }

    function getCompiledBoqPage(page) {
        const curVer = PL01_DICT_STATE.version;
        if (page._compiledDictVer === curVer && page._compiledPageUnaccPad) {
            return page._compiledPageUnaccPad;
        }
        let pad = " ";
        for (let i = 0; i < page.lines.length; i++) {
            const cl = getCompiledBoqLine(page.lines[i]);
            if (cl.unaccPad.length > 2) {
                pad += cl.unaccPad.slice(1);
            }
        }
        page._compiledDictVer = curVer;
        page._compiledPageUnaccPad = pad;
        return pad;
    }

    function parsePl01Query(rawQuery) {
        const raw = String(rawQuery || "").trim();
        const quotedPhrases = [];
        const quoteRe = /"([^"]+)"/g;
        let qm;
        while ((qm = quoteRe.exec(raw)) !== null) {
            const qSyn = normalizeTextThroughSynonyms(qm[1]);
            if (qSyn.length > 0) {
                quotedPhrases.push({
                    words: qSyn.map((t) => ({ acc: t.normAcc, unacc: t.normUnacc })),
                    unaccPadNeedle: " " + qSyn.map((t) => t.normUnacc).join(" ") + " "
                });
            }
        }

        const plainQuery = raw.replace(/"/g, " ").trim();
        const cleanTokens = normalizeTextThroughSynonyms(plainQuery);

        const structures = [];
        const materials = [];
        const actions = [];
        const specs = [];
        const seenStruct = new Set();
        const seenMat = new Set();
        const seenAct = new Set();
        const seenSpec = new Set();

        const maxDictLen = PL01_DICT_STATE.maxDictLen || 1;
        const nC = cleanTokens.length;
        const lastCleanIdx = nC - 1;

        // Quy hoạch động phân tách cụm từ: tối đa hóa số từ thuộc từ điển -> ưu tiên cụm dài (len^2) -> ưu tiên khớp có dấu
        const dp = new Array(nC + 1).fill(null);
        dp[nC] = { covered: 0, lenSq: 0, accCount: 0, prioScore: 0, steps: [] };

        const catPrio = { structures: 3, materials: 2, actions: 1 };
        const isBetterDP = (a, b) => {
            if (!b) return true;
            if (a.covered !== b.covered) return a.covered > b.covered;
            if (a.lenSq !== b.lenSq) return a.lenSq > b.lenSq;
            if (a.accCount !== b.accCount) return a.accCount > b.accCount;
            return a.prioScore > b.prioScore;
        };

        for (let i = nC - 1; i >= 0; i--) {
            // Lựa chọn mặc định: token i rơi vào specs
            const nextDefault = dp[i + 1];
            let best = {
                covered: nextDefault.covered,
                lenSq: nextDefault.lenSq,
                accCount: nextDefault.accCount,
                prioScore: nextDefault.prioScore,
                steps: [{ type: "spec", start: i, len: 1 }, ...nextDefault.steps]
            };

            const tryMax = Math.min(maxDictLen, nC - i);
            for (let len = tryMax; len >= 1; len--) {
                const slice = cleanTokens.slice(i, i + len);
                const keyAcc = slice.map((t) => t.normAcc).join(" ");
                const mapAcc = PL01_DICT_STATE.dictByLenAcc.get(len);
                let matchedEntry = null;
                let matchedAcc = false;

                if (mapAcc && mapAcc.has(keyAcc)) {
                    matchedEntry = mapAcc.get(keyAcc);
                    matchedAcc = true;
                } else if (!slice.some((t) => t.hasAcc)) {
                    const keyUnacc = slice.map((t) => t.normUnacc).join(" ");
                    const mapUnacc = PL01_DICT_STATE.dictByLenUnacc.get(len);
                    if (mapUnacc && mapUnacc.has(keyUnacc)) {
                        matchedEntry = mapUnacc.get(keyUnacc);
                    }
                }

                if (matchedEntry) {
                    const next = dp[i + len];
                    const cand = {
                        covered: next.covered + len,
                        lenSq: next.lenSq + len * len,
                        accCount: next.accCount + (matchedAcc ? len : 0),
                        prioScore: next.prioScore + (catPrio[matchedEntry.category] || 0),
                        steps: [{ type: "dict", entry: matchedEntry, start: i, len: len }, ...next.steps]
                    };
                    if (isBetterDP(cand, best)) {
                        best = cand;
                    }
                }
            }
            dp[i] = best;
        }

        const chosenSteps = dp[0] ? dp[0].steps : [];
        for (let si2 = 0; si2 < chosenSteps.length; si2++) {
            const st = chosenSteps[si2];
            const isTrailing = st.start + st.len - 1 === lastCleanIdx;

            if (st.type === "dict") {
                const matchedEntry = st.entry;
                const item = {
                    raw: matchedEntry.raw,
                    key: matchedEntry.accPhrase,
                    words: matchedEntry.words,
                    isTrailing: isTrailing
                };
                if (matchedEntry.category === "structures") {
                    if (!seenStruct.has(item.key)) {
                        seenStruct.add(item.key);
                        structures.push(item);
                    }
                } else if (matchedEntry.category === "materials") {
                    if (!seenMat.has(item.key)) {
                        seenMat.add(item.key);
                        materials.push(item);
                    }
                } else if (matchedEntry.category === "actions") {
                    if (!seenAct.has(item.key)) {
                        seenAct.add(item.key);
                        actions.push(item);
                    }
                }
            } else {
                const tok = cleanTokens[st.start];
                if (!seenSpec.has(tok.normUnacc)) {
                    seenSpec.add(tok.normUnacc);
                    specs.push({
                        raw: tok.normAcc,
                        key: tok.normUnacc,
                        words: [{ acc: tok.normAcc, unacc: tok.normUnacc }],
                        isTrailing: isTrailing
                    });
                }
            }
        }

        return {
            quotedPhrases,
            cleanTokens,
            buckets: { structures, materials, actions, specs }
        };
    }

    function matchWordsInCompiledLine(words, cLine, allowTrailingPrefix, minPrefixLen = 1) {
        if (!words || words.length === 0) return null;
        const posLists = [];
        let accExactCount = 0;
        let usedPrefix = false;

        for (let wi = 0; wi < words.length; wi++) {
            const w = words[wi];
            const isLastW = wi === words.length - 1;
            const allowPrefix = allowTrailingPrefix && isLastW && w.unacc.length >= minPrefixLen;
            const positions = [];

            if (!allowPrefix && !cLine.unaccSet.has(w.unacc)) {
                return null;
            }

            for (let ti = 0; ti < cLine.synTokens.length; ti++) {
                const bt = cLine.synTokens[ti];
                if (bt.normAcc === w.acc) {
                    positions.push({ ti, exactAcc: true, isPrefix: false });
                } else if (bt.normUnacc === w.unacc) {
                    positions.push({ ti, exactAcc: false, isPrefix: false });
                } else if (allowPrefix && bt.normUnacc.startsWith(w.unacc)) {
                    positions.push({ ti, exactAcc: false, isPrefix: true });
                }
            }

            if (positions.length === 0) return null;
            posLists.push(positions);
        }

        // Kiểm tra khớp liền mạch đúng thứ tự (thưởng điểm tie-break, không bắt buộc)
        let isContiguous = false;
        let chosen = null;
        if (words.length >= 2) {
            for (let p0Idx = 0; p0Idx < posLists[0].length; p0Idx++) {
                const startPos = posLists[0][p0Idx];
                const seq = [startPos];
                let seqOk = true;
                for (let wi = 1; wi < words.length; wi++) {
                    const expectedTi = startPos.ti + wi;
                    const found = posLists[wi].find((p) => p.ti === expectedTi);
                    if (!found) {
                        seqOk = false;
                        break;
                    }
                    seq.push(found);
                }
                if (seqOk) {
                    isContiguous = true;
                    chosen = seq;
                    break;
                }
            }
        }

        if (!chosen) {
            chosen = posLists.map((list) => {
                return list.find((p) => p.exactAcc) || list.find((p) => !p.isPrefix) || list[0];
            });
        }

        const matchedOrigIdxSet = new Set();
        const matchedUnaccSet = new Set();
        for (let i = 0; i < chosen.length; i++) {
            const pick = chosen[i];
            if (pick.exactAcc) accExactCount++;
            if (pick.isPrefix) usedPrefix = true;
            const synTok = cLine.synTokens[pick.ti];
            matchedUnaccSet.add(synTok.normUnacc);
            for (let oi = 0; oi < synTok.origIndices.length; oi++) {
                matchedOrigIdxSet.add(synTok.origIndices[oi]);
            }
        }

        return {
            matched: true,
            accExactCount,
            isContiguous,
            usedPrefix,
            posLists: posLists,
            origIndices: Array.from(matchedOrigIdxSet),
            unaccWords: Array.from(matchedUnaccSet)
        };
    }

    function findTightestMatchedCluster(allPosLists) {
        const kCount = allPosLists ? allPosLists.length : 0;
        if (kCount < 2) return { minMaxGap: 0, chosenTi: null };

        // Kiểm tra nhanh số tổ hợp; nếu nhỏ (<= 128) tìm chính xác tối ưu toàn cục
        let totalComb = 1;
        const trimmedLists = allPosLists.map((list) => {
            const arr = list.map((p) => p.ti);
            return arr.length > 6 ? arr.slice(0, 6) : arr;
        });
        for (let i = 0; i < kCount; i++) {
            totalComb *= trimmedLists[i].length;
            if (totalComb > 128) break;
        }

        let bestMaxGap = Infinity;
        let bestSpan = Infinity;
        let bestChosen = null;

        const evaluatePick = (picked) => {
            const sorted = picked.slice().sort((a, b) => a - b);
            let maxGap = 0;
            for (let i = 0; i < sorted.length - 1; i++) {
                const gap = sorted[i + 1] - sorted[i] - 1;
                if (gap > maxGap) maxGap = gap;
            }
            const span = sorted[sorted.length - 1] - sorted[0];
            if (maxGap < bestMaxGap || (maxGap === bestMaxGap && span < bestSpan)) {
                bestMaxGap = maxGap;
                bestSpan = span;
                bestChosen = picked.slice();
            }
        };

        if (totalComb <= 128) {
            const cur = new Array(kCount);
            const dfs = (idx) => {
                if (idx === kCount) {
                    evaluatePick(cur);
                    return;
                }
                const opts = trimmedLists[idx];
                for (let j = 0; j < opts.length; j++) {
                    cur[idx] = opts[j];
                    dfs(idx + 1);
                    if (bestMaxGap === 0 && bestSpan === kCount - 1) return;
                }
            };
            dfs(0);
        } else {
            // Fallback cửa sổ trượt cho dòng có nhiều từ lặp lại
            const cands = [];
            for (let wi = 0; wi < kCount; wi++) {
                const opts = allPosLists[wi];
                for (let j = 0; j < opts.length; j++) {
                    cands.push({ pos: opts[j].ti, wi: wi });
                }
            }
            cands.sort((a, b) => a.pos - b.pos);
            const lastPos = new Array(kCount).fill(-1);
            let seen = 0;
            for (let i = 0; i < cands.length; i++) {
                const c = cands[i];
                if (lastPos[c.wi] === -1) seen++;
                lastPos[c.wi] = c.pos;
                if (seen === kCount) {
                    evaluatePick(lastPos);
                    if (bestMaxGap === 0 && bestSpan === kCount - 1) break;
                }
            }
        }

        return { minMaxGap: bestMaxGap, chosenTi: bestChosen };
    }

    function matchSinglePl01Record(record, rawQuery) {
        if (!PL01_DICT_STATE.ready) {
            hydratePl01DictionaryFromCache();
        }

        const parsed = parsePl01Query(rawQuery);
        const { quotedPhrases, cleanTokens, buckets } = parsed;
        if (cleanTokens.length === 0) return null;

        const hasQuotes = quotedPhrases.length > 0;
        const { structures, materials, actions, specs } = buckets;
        const nS = structures.length;
        const nM = materials.length;
        const nA = actions.length;
        const nP = specs.length;

        if (
            !hasQuotes &&
            cleanTokens.length === 1 &&
            nS === 0 &&
            nM === 0 &&
            nA === 0 &&
            cleanTokens[0].normUnacc.length < 3
        ) {
            return null;
        }

        const cfg = PL01_DICT_STATE.scoring;
        const W = cfg.weights;
        const primaryRatio = cfg.multi_structure_primary_ratio;
        const tiers = cfg.tiers;

        let activeWeight = 0;
        if (nS > 0) activeWeight += W.structures;
        if (nM > 0) activeWeight += W.materials;
        if (nA > 0) activeWeight += W.actions;
        if (nP > 0) activeWeight += W.specs;
        if (activeWeight <= 0) return null;

        // Điều kiện lọc nhanh cấp trang (dùng cấu kiện bắt buộc nếu có, hoặc các từ khóa)
        const pagePreFilterTerms = [];
        if (nS > 0) {
            structures.forEach((s) => s.words.forEach((w) => pagePreFilterTerms.push(w.unacc)));
        } else {
            cleanTokens.forEach((t) => pagePreFilterTerms.push(t.normUnacc));
        }

        const rawMatches = [];

        for (let pIdx = 0; pIdx < record.pages.length; pIdx++) {
            const page = record.pages[pIdx];
            const pageUnaccPad = getCompiledBoqPage(page);

            if (hasQuotes) {
                let quotesOkOnPage = true;
                for (let qi = 0; qi < quotedPhrases.length; qi++) {
                    if (!pageUnaccPad.includes(quotedPhrases[qi].unaccPadNeedle)) {
                        quotesOkOnPage = false;
                        break;
                    }
                }
                if (!quotesOkOnPage) continue;
            }

            if (pagePreFilterTerms.length > 0) {
                let pageHasCandidate = false;
                for (let ti = 0; ti < pagePreFilterTerms.length; ti++) {
                    const needle = pagePreFilterTerms[ti];
                    const needlePad = needle.length >= 3 ? " " + needle : " " + needle + " ";
                    if (pageUnaccPad.includes(needlePad)) {
                        pageHasCandidate = true;
                        break;
                    }
                }
                if (!pageHasCandidate) continue;
            }

            for (let lIdx = 0; lIdx < page.lines.length; lIdx++) {
                const block = page.lines[lIdx];
                const cLine = getCompiledBoqLine(block);
                if (cLine.synTokens.length === 0) continue;

                if (hasQuotes) {
                    let lineQuotesOk = true;
                    for (let qi = 0; qi < quotedPhrases.length; qi++) {
                        if (!cLine.unaccPad.includes(quotedPhrases[qi].unaccPadNeedle)) {
                            lineQuotesOk = false;
                            break;
                        }
                    }
                    if (!lineQuotesOk) continue;
                }

                // 1. Khóa cứng từ lõi (structures): có nhập cấu kiện nhưng không khớp cấu kiện nào -> loại 0%
                const MAX_MATCH_GAP_WORDS = 2;
                let earnedPoints = 0;
                let accExactBonus = 0;
                let contiguousBonus = 0;
                let prefixPenalty = 0;
                const allWordPosLists = [];
                const allOrigIdxSet = new Set();
                const allMatchedUnaccSet = new Set();

                const collectMatch = (mRes) => {
                    accExactBonus += mRes.accExactCount;
                    if (mRes.isContiguous) contiguousBonus += 1;
                    if (mRes.usedPrefix) prefixPenalty += 1;
                    if (Array.isArray(mRes.posLists)) {
                        for (let pi2 = 0; pi2 < mRes.posLists.length; pi2++) {
                            allWordPosLists.push(mRes.posLists[pi2]);
                        }
                    }
                    mRes.origIndices.forEach((idx) => allOrigIdxSet.add(idx));
                    mRes.unaccWords.forEach((uw) => allMatchedUnaccSet.add(uw));
                };

                const minTrailingPrefixLen = cleanTokens.length >= 2 ? 1 : 3;

                if (nS > 0) {
                    const structResults = [];
                    let matchedStructCount = 0;
                    for (let si = 0; si < nS; si++) {
                        const sRes = matchWordsInCompiledLine(
                            structures[si].words,
                            cLine,
                            structures[si].isTrailing,
                            minTrailingPrefixLen
                        );
                        structResults.push(sRes);
                        if (sRes) {
                            matchedStructCount++;
                            collectMatch(sRes);
                        }
                    }
                    if (matchedStructCount === 0) continue;

                    if (nS === 1) {
                        earnedPoints += W.structures;
                    } else {
                        const primaryW = W.structures * primaryRatio;
                        const secondaryW = (W.structures * (1 - primaryRatio)) / (nS - 1);
                        if (structResults[0]) earnedPoints += primaryW;
                        for (let si = 1; si < nS; si++) {
                            if (structResults[si]) earnedPoints += secondaryW;
                        }
                    }
                }

                // 2. Vật liệu (materials)
                if (nM > 0) {
                    let matchedM = 0;
                    for (let mi = 0; mi < nM; mi++) {
                        const mRes = matchWordsInCompiledLine(
                            materials[mi].words,
                            cLine,
                            materials[mi].isTrailing,
                            minTrailingPrefixLen
                        );
                        if (mRes) {
                            matchedM++;
                            collectMatch(mRes);
                        }
                    }
                    earnedPoints += W.materials * (matchedM / nM);
                }

                // 3. Hành động (actions)
                if (nA > 0) {
                    let matchedA = 0;
                    for (let ai = 0; ai < nA; ai++) {
                        const aRes = matchWordsInCompiledLine(
                            actions[ai].words,
                            cLine,
                            actions[ai].isTrailing,
                            minTrailingPrefixLen
                        );
                        if (aRes) {
                            matchedA++;
                            collectMatch(aRes);
                        }
                    }
                    earnedPoints += W.actions * (matchedA / nA);
                }

                // 4. Thông số (specs)
                if (nP > 0) {
                    let matchedP = 0;
                    for (let pi = 0; pi < nP; pi++) {
                        const pRes = matchWordsInCompiledLine(
                            specs[pi].words,
                            cLine,
                            specs[pi].isTrailing,
                            minTrailingPrefixLen
                        );
                        if (pRes) {
                            matchedP++;
                            collectMatch(pRes);
                        }
                    }
                    earnedPoints += W.specs * (matchedP / nP);
                }

                // Quy đổi % bất đối xứng, kiểm tra khoảng cách tối đa giữa 2 từ khớp trên BOQ (<= 2 từ), & phân tầng
                const rawPct = (earnedPoints / activeWeight) * 100;
                let scorePct = Math.round(rawPct);
                if (scorePct < tiers.medium) continue;

                const clusterInfo = findTightestMatchedCluster(allWordPosLists);
                if (allWordPosLists.length >= 2 && clusterInfo.minMaxGap > MAX_MATCH_GAP_WORDS) {
                    scorePct = Math.min(scorePct, tiers.medium);
                }

                const tierPct = scorePct >= tiers.exact ? 100 : scorePct >= tiers.high ? 75 : 50;

                const origToks = cLine.origTokens;
                let sortedOrigIdx = [];
                const tightMatchedUnaccSet = new Set();
                if (clusterInfo.chosenTi && clusterInfo.chosenTi.length > 0) {
                    const tightOrigSet = new Set();
                    for (let ci = 0; ci < clusterInfo.chosenTi.length; ci++) {
                        const st = cLine.synTokens[clusterInfo.chosenTi[ci]];
                        if (st && st.origIndices) {
                            st.origIndices.forEach((oi) => {
                                tightOrigSet.add(oi);
                                if (origToks[oi] && origToks[oi].normUnacc) {
                                    tightMatchedUnaccSet.add(origToks[oi].normUnacc);
                                }
                            });
                        }
                    }
                    sortedOrigIdx = Array.from(tightOrigSet).sort((a, b) => a - b);
                }
                if (sortedOrigIdx.length === 0) {
                    sortedOrigIdx = Array.from(allOrigIdxSet).sort((a, b) => a - b);
                }
                if (sortedOrigIdx.length === 0) continue;

                let sliceStart = sortedOrigIdx[0];
                let sliceEnd = sortedOrigIdx[sortedOrigIdx.length - 1];
                if (sliceEnd - sliceStart > 12) {
                    const [runStart, runEnd] = findLongestContiguousRun(sortedOrigIdx);
                    sliceStart = runStart;
                    sliceEnd = runEnd;
                }

                const keyText = block.raw.slice(origToks[sliceStart].start, origToks[sliceEnd].end);
                const spanPenalty = Math.max(0, sliceEnd - sliceStart + 1 - sortedOrigIdx.length);
                const lineScore =
                    scorePct * 1000 + accExactBonus * 2 + contiguousBonus * 5 - spanPenalty - prefixPenalty * 2;

                rawMatches.push({
                    pct: tierPct,
                    scorePct: scorePct,
                    keyText: keyText,
                    normKey: normalizePl01SearchStr(keyText),
                    pageNum: page.pageNum,
                    contextLine: block.raw,
                    matchedWords:
                        tightMatchedUnaccSet.size > 0
                            ? Array.from(tightMatchedUnaccSet)
                            : Array.from(allMatchedUnaccSet),
                    score: lineScore
                });
            }
        }

        if (rawMatches.length === 0) return null;

        const groupMap = new Map();
        let bestPct = 0;
        let bestScorePct = 0;
        let totalScore = 0;

        rawMatches.forEach((m) => {
            if (m.pct > bestPct) bestPct = m.pct;
            if (m.scorePct > bestScorePct) bestScorePct = m.scorePct;
            totalScore += m.score;

            const gKey = `${m.pct}|${m.normKey}`;
            if (!groupMap.has(gKey)) {
                groupMap.set(gKey, {
                    pct: m.pct,
                    scorePct: m.scorePct,
                    keyText: m.keyText,
                    normKey: m.normKey,
                    count: 1,
                    firstPage: m.pageNum,
                    bestContextLine: m.contextLine,
                    bestContextScore: m.score,
                    matchedWords: m.matchedWords,
                    distinctContexts: new Set([m.contextLine])
                });
            } else {
                const g = groupMap.get(gKey);
                g.count++;
                if (m.scorePct > g.scorePct) g.scorePct = m.scorePct;
                if (m.pageNum < g.firstPage) g.firstPage = m.pageNum;
                g.distinctContexts.add(m.contextLine);
                if (m.score > g.bestContextScore) {
                    g.bestContextScore = m.score;
                    g.bestContextLine = m.contextLine;
                    g.matchedWords = m.matchedWords;
                }
            }
        });

        const groups = Array.from(groupMap.values()).map((g) => ({
            pct: g.pct,
            scorePct: g.scorePct,
            keyText: g.keyText,
            normKey: g.normKey,
            count: g.count,
            firstPage: g.firstPage,
            bestContextLine: g.bestContextLine,
            matchedWords: g.matchedWords,
            extraLocations: Math.max(0, g.distinctContexts.size - 1)
        }));

        groups.sort(
            (a, b) => b.pct - a.pct || b.scorePct - a.scorePct || b.count - a.count || a.firstPage - b.firstPage
        );

        const bestTierMatches = rawMatches.filter((m) => m.pct === bestPct);
        const hasLowerTier = rawMatches.some((m) => m.pct < bestPct);

        return {
            fileId: record.fileId,
            maHD: record.maHD,
            apStart: record.apStart,
            rawQuery: rawQuery.trim(),
            bestPct: bestPct,
            bestScorePct: bestScorePct,
            bestCount: bestTierMatches.length,
            hasLowerTier: hasLowerTier,
            totalMatches: rawMatches.length,
            totalScore: bestScorePct * 100000 + totalScore,
            groups: groups
        };
    }

    function findLongestContiguousRun(sortedIndices) {
        if (!sortedIndices || sortedIndices.length === 0) return [0, 0];
        let bestStart = sortedIndices[0],
            bestEnd = sortedIndices[0];
        let curStart = sortedIndices[0],
            curEnd = sortedIndices[0];
        for (let i = 1; i < sortedIndices.length; i++) {
            if (sortedIndices[i] - curEnd <= 2) {
                curEnd = sortedIndices[i];
                if (curEnd - curStart > bestEnd - bestStart) {
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
        dictState: PL01_DICT_STATE,
        loadDictionary: loadPl01Dictionary,
        compileDictionary: compilePl01Dictionary,
        parseQuery: parsePl01Query,
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
