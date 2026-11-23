// =========================================================================
// BCONS DOCUMENT VIEWER - MODULE 3/4: DRIVE FETCH, CLOUD VISION & PDF REPAIR
// =========================================================================

(() => {
  const BV = window.__BconsViewer;
  const S = BV.state;
  const U = BV.utils;
  const ST = BV.storage;
  const SR = BV.search;
  const googleScriptRun = BV.googleScriptRun;

  // =========================================================================
  // DRIVE AUTH TOKEN & DOWNLOAD STREAMS
  // =========================================================================
  function getDriveTokenAsync() {
    if (S.cachedDriveToken && Date.now() < S.driveTokenExpiresAt) {
      return Promise.resolve(S.cachedDriveToken);
    }
    return new Promise(function(resolve, reject) {
      googleScriptRun
        .withSuccessHandler(function(token) {
          S.cachedDriveToken = token;
          S.driveTokenExpiresAt = Date.now() + (45 * 60 * 1000);
          resolve(token);
        })
        .withFailureHandler(reject)
        .getDriveAccessToken();
    });
  }

  function invalidateDriveToken() {
    S.cachedDriveToken = null;
    S.driveTokenExpiresAt = 0;
  }

  async function fetchDriveMedia(fileId, token, onProgress) {
    const slashes = String.fromCharCode(47, 47);
    const mediaUrl = "https:" + slashes + "www.googleapis.com/drive/v3/files/" + fileId + "?alt=media&supportsAllDrives=true";
    const res = await fetch(mediaUrl, {
      method: "GET",
      headers: { "Authorization": "Bearer " + token },
      signal: S.activeFetchAbortController ? S.activeFetchAbortController.signal : undefined
    });

    if (!res.ok || !res.body || typeof onProgress !== "function") {
      return res;
    }

    const totalHeader = res.headers.get("Content-Length");
    const totalBytes = (totalHeader ? parseInt(totalHeader, 10) : 0) || (S.currentManifest?.pdfByteLength || 0);

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
    const signal = S.activeFetchAbortController ? S.activeFetchAbortController.signal : undefined;
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
      const localBuf = await ST.getLocalPdfBinary(fileId);
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
      if (!res.ok) {
        const err = new Error("HTTP " + res.status);
        if (res.status === 403 || res.status === 404) err.skipRange = true;
        throw err;
      }
      const buf = await res.arrayBuffer();
      ST.saveLocalPdfBinary(fileId, buf).catch(() => {});
      return buf;
    } catch (err) {
      if (err.name === "AbortError" || err.message === "ABORTED_BY_USER") {
        throw new Error("ABORTED_BY_USER");
      }
      if (!err.skipRange) {
        console.warn("CDN lỗi, tải theo dải byte:", err);
        try {
          const ranged = await fetchPdfByByteRanges(fileId, onProgress);
          ST.saveLocalPdfBinary(fileId, ranged).catch(() => {});
          return ranged;
        } catch (rangeErr) {
          if (rangeErr.name === "AbortError" || rangeErr.message === "ABORTED_BY_USER") {
            throw new Error("ABORTED_BY_USER");
          }
          console.warn("Chuyển làn dự phòng Apps Script:", rangeErr);
        }
      }
      const fallbackBuf = await fetchPdfBase64Adaptive(fileId, onProgress);
      ST.saveLocalPdfBinary(fileId, fallbackBuf).catch(() => {});
      return fallbackBuf;
    }
  }

  function fetchPdfBase64Adaptive(fileId, onProgress) {
    const effectiveMB = S.currentFileSizeMB || (S.currentManifest?.pdfByteLength ? S.currentManifest.pdfByteLength / 1048576 : 0);
    if (effectiveMB > 0 && effectiveMB <= S.LARGE_FILE_THRESHOLD_MB) {
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

  // =========================================================================
  // DRIVE MANIFEST CACHE & RETRY
  // =========================================================================
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
    return new Promise(function(resolve, reject) {
      googleScriptRun
        .withSuccessHandler(function(res) { resolve(res); })
        .withFailureHandler(function(err) {
          console.error("Lỗi lưu cache lên Drive:", err);
          reject(err instanceof Error ? err : new Error(String(err || "Lỗi lưu cache Drive")));
        })
        .saveDriveCacheFast(fileId, fileName, jsonString);
    });
  }

  function showViewerLoadError(fileId, fileName, msg) {
    U.hideLoading();
    const vp = document.getElementById("viewport-container");
    if (!vp) return;
    vp.style.visibility = "visible";
    vp.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; padding: 30px; box-sizing: border-box;">
        <i class="bi bi-wifi-off" style="font-size: 50px; color: #ff4d4d; margin-bottom: 15px; opacity: 0.85;"></i>
        <h4 style="color: #ff4d4d; font-size: 14px; font-weight: bold; margin: 0 0 8px 0; text-transform: uppercase;">KHÔNG THỂ TẢI BẢN SỐ HÓA TỪ DRIVE</h4>
        <p style="color: #95A1AF; font-size: 12px; line-height: 1.6; max-width: 420px; margin: 0 0 18px 0;">
          Kết nối tới máy chủ Drive bị gián đoạn. Hệ thống giữ nguyên dữ liệu cũ và không tự động số hóa lại.<br>
          <span style="color: #FFBA08; font-family: monospace; font-size: 11px;">(${msg || "Network / GAS error"})</span>
        </p>
        <button type="button" class="prv-btn" onclick="window.BconsViewer.loadFile('${fileId}', '${(fileName || "").replace(/'/g, "\\'")}')" style="padding: 6px 16px; font-size: 12px;">
          <i class="bi bi-arrow-clockwise" style="margin-right: 6px;"></i> THỬ LẠI
        </button>
      </div>
    `;
  }

  function checkDriveCacheWithRetry(fileId, fileName, retryCount, busyCount, netErrorCount) {
    const myEpoch = S.currentSessionEpoch;
    busyCount = busyCount || 0;
    netErrorCount = netErrorCount || 0;

    fetchDriveCacheAdaptive(fileId, fileName)
      .then(async function(res) {
        if (myEpoch !== S.currentSessionEpoch) return;

        if (res && res.found) {
          try {
            S.currentManifest = await ST.decompressManifest(res.data);
          } catch (decompErr) {
            console.error("Lỗi giải nén manifest từ Drive:", decompErr);
            showViewerLoadError(fileId, fileName, "Lỗi giải nén dữ liệu số hóa");
            return;
          }
          if (myEpoch !== S.currentSessionEpoch) return;

          if (typeof window.markScanFileDigitized_PL === "function") {
            window.markScanFileDigitized_PL(fileId);
          }

          ST.putSessionCache(fileId, S.currentManifest);
          ST.saveLocalManifest(fileId, S.currentManifest);

          try {
            await ensurePdfPreloaded(fileId, 95);
            await BV.ui.renderSlicedDocument();
          } catch (e) {
            if (e.message !== "ABORTED" && e.message !== "REPAIR_OLD_MANIFEST") U.hideLoading();
          }
          return;
        }

        if (res && res.busy) {
          if (busyCount < 8) {
            setTimeout(function() {
              if (myEpoch === S.currentSessionEpoch) {
                checkDriveCacheWithRetry(fileId, fileName, retryCount, busyCount + 1, netErrorCount);
              }
            }, 1500);
            return;
          }
          showViewerLoadError(fileId, fileName, "Máy chủ Drive đang bận, vui lòng thử lại");
          return;
        }

        if (res && res.isOptimizing) {
          if (retryCount <= 60) {
            setTimeout(function() {
              if (myEpoch === S.currentSessionEpoch) {
                checkDriveCacheWithRetry(fileId, fileName, retryCount + 1, 0, netErrorCount);
              }
            }, 10000);
            return;
          }
        }

        processAndOptimizeFileJIT(fileId);
      })
      .catch(function(err) {
        if (myEpoch !== S.currentSessionEpoch) return;
        if (netErrorCount < 2) {
          setTimeout(function() {
            if (myEpoch === S.currentSessionEpoch) {
              checkDriveCacheWithRetry(fileId, fileName, retryCount, busyCount, netErrorCount + 1);
            }
          }, 1500);
        } else {
          showViewerLoadError(fileId, fileName, err && err.message ? err.message : "Lỗi kết nối Drive");
        }
      });
  }

  // =========================================================================
  // CLOUD VISION OCR, LỌC TRANG TRẮNG & GHI ĐÈ FILE GỐC TRÊN DRIVE
  // =========================================================================
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
        if (gray < 180) darkPixels++;
        totalExamined++;
      }
    }

    const inkRatio = (darkPixels / Math.max(1, totalExamined)) * 100;
    return inkRatio < 0.12;
  }

  async function ensurePdfLibLoaded() {
    if (window.PDFLib) return window.PDFLib;
    await new Promise(function(resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/pdf-lib/dist/pdf-lib.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Không thể tải thư viện xử lý PDF (pdf-lib)."));
      document.head.appendChild(script);
    });
    return window.PDFLib;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    const parts = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(""));
  }

  async function overwriteOriginalPdfOnDrive(fileId, cleanBuffer) {
    if (!fileId || String(fileId).startsWith("local_") || !cleanBuffer) return false;
    if (typeof callBackend !== "function") return false;

    const totalSize = cleanBuffer.byteLength;

    // LUỒNG CHÍNH: Xin Resumable PATCH Session URL (0.3s) -> Đẩy thẳng nhị phân lên Drive CDN (~1.5s)
    try {
      const session = await callBackend("getPdfOverwriteSession_Backend", [
        fileId,
        totalSize,
        window.location.origin || ""
      ]);

      if (session && session.success && session.uploadUrl) {
        const chunkSize = 5 * 1024 * 1024; // Bội số của 256KB theo chuẩn Drive API
        const totalChunks = Math.ceil(totalSize / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
          const start = i * chunkSize;
          const end = Math.min(start + chunkSize, totalSize);
          const chunk = cleanBuffer.slice(start, end);

          try {
            const resp = await fetch(session.uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": "application/pdf",
                "Content-Range": `bytes ${start}-${end - 1}/${totalSize}`
              },
              body: chunk
            });

            if (resp.status !== 308 && resp.status !== 200 && resp.status !== 201) {
              throw new Error("Drive phản hồi HTTP " + resp.status);
            }
          } catch (fetchErr) {
            const isLastChunk = (i === totalChunks - 1);
            const isCorsBlock = fetchErr.name === "TypeError" || (fetchErr.message && fetchErr.message.includes("Failed to fetch"));
            if (isLastChunk && isCorsBlock) {
              console.warn("[CORS Bypass] Đã hoàn tất đẩy mảnh cuối lên Drive.");
              break;
            }
            throw fetchErr;
          }
        }
        return true;
      }
    } catch (resumableErr) {
      console.warn("Resumable PATCH lỗi, thử dự phòng cho file nhỏ:", resumableErr);
    }

    // DỰ PHÒNG (chỉ cho file <= 3MB để tránh treo 60s trên GAS)
    if (totalSize <= 3 * 1024 * 1024) {
      const b64 = arrayBufferToBase64(cleanBuffer);
      const res = await callBackend("overwritePdfFile_Backend", [fileId, b64]);
      return Boolean(res && res.success);
    }

    return false;
  }

  async function detectLegacyUnfixedPdf(pdf, manifest, epoch, pdfByteLength) {
    if (!pdf || !manifest || !Array.isArray(manifest.pages)) return false;

    const hasUnbakedRotation = manifest.pages.some(p => p.rotation && p.rotation !== 0);
    const hasVirtualSkippedPages = (pdf.numPages !== manifest.numPages) ||
      manifest.pages.some((p, idx) => p.pdfPageNum && p.pdfPageNum !== (idx + 1));

    if (hasUnbakedRotation || hasVirtualSkippedPages) {
      return true;
    }

    if (!manifest.originalPdfCleanChecked) {
      const scanCanvas = document.createElement("canvas");
      const scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
      let foundBlank = false;

      try {
        for (let i = 0; i < manifest.pages.length; i++) {
          if (epoch !== S.currentSessionEpoch) return false;

          const pMeta = manifest.pages[i];
          if (pMeta.textItems && pMeta.textItems.length > 0) continue;

          const targetPdfPage = pMeta.pdfPageNum || pMeta.pageNum || (i + 1);
          if (targetPdfPage < 1 || targetPdfPage > pdf.numPages) continue;

          const page = await pdf.getPage(targetPdfPage);
          const thumbVp = page.getViewport({ scale: 0.22 });
          scanCanvas.width = thumbVp.width;
          scanCanvas.height = thumbVp.height;
          await page.render({ canvasContext: scanCtx, viewport: thumbVp, intent: "display" }).promise;
          page.cleanup();

          if (isScannedPageBlank(scanCanvas)) {
            foundBlank = true;
            break;
          }
        }
      } finally {
        scanCanvas.width = 0;
        scanCanvas.height = 0;
      }

      if (foundBlank) return true;

      manifest.originalPdfCleanChecked = true;
      if (pdfByteLength && !manifest.pdfByteLength) {
        manifest.pdfByteLength = pdfByteLength;
      }

      const targetId = S.currentFileId;
      const targetName = S.currentFileName;
      if (targetId) {
        ST.saveLocalManifest(targetId, manifest);
        setTimeout(() => {
          ST.compressManifest(manifest)
            .then(gz => saveDriveCacheAdaptive(targetId, targetName, gz))
            .catch(() => {});
        }, 1500);
      }
    }

    return false;
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

      const scanPct = 20 + Math.round(((pdf.numPages - pTop + 1) / Math.min(pdf.numPages, VISION_PAGE_BUDGET)) * 22);
      U.updateProcessProgress(Math.min(42, scanPct), "Đang số hóa tài liệu...");
      const pairData = [];

      for (let i = 0; i < candidateNums.length; i++) {
        const pNum = candidateNums[i];
        const page = await pdf.getPage(pNum);
        const viewport = page.getViewport({ scale: SCAN_AI_SCALE });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport: viewport, intent: "print" }).promise;
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
          width: U.round1(viewport.width / SCAN_AI_SCALE),
          height: U.round1(viewport.height / SCAN_AI_SCALE),
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
                  U.round1(w.x / SCAN_AI_SCALE),
                  U.round1(item.pageData.height - ((w.y + w.h) / SCAN_AI_SCALE)),
                  U.round1(w.w / SCAN_AI_SCALE),
                  U.round1(w.h / SCAN_AI_SCALE)
                ];
              });
            }
          }

          appendixPages.push(item.pageData);
          const aiRawText = item.pageData.textItems.map(it => it[0] || "").join(" ");
          const aiClean = SR.cleanNaturalToken(aiRawText);

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

  // =========================================================================
  // PIPELINE SỐ HÓA JIT & LÀM SẠCH FILE GỐC
  // =========================================================================
  function processAndOptimizeFileJIT(fileId, localFileObj = null, preloadedBuffer = null) {
    const isLocalUpload = (localFileObj !== null);
    const uploadFileName = S.currentFileName;
    const myEpoch = S.currentSessionEpoch;
    U.setAntiExitGuard(true);

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

    U.updateProcessProgress(Math.max(5, Math.round(S.currentLoaderPct)), "Đang chuẩn bị tài liệu...");

    const dlStartPct = Math.max(5, Math.round(S.currentLoaderPct));
    const dataSourcePromise = isLocalUpload
      ? localFileObj.arrayBuffer()
      : (preloadedBuffer
          ? Promise.resolve(preloadedBuffer)
          : fetchPdfDirectOrFallback(fileId, (loaded, total) => {
              if (myEpoch !== S.currentSessionEpoch || !total) return;
              const dlPct = dlStartPct + Math.round((loaded / total) * Math.max(1, 20 - dlStartPct));
              U.updateProcessProgress(Math.min(20, dlPct), "Đang chuẩn bị tài liệu...");
            }));

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

          // GIAI ĐOẠN 2: Quét phụ lục bằng Vision API
          U.updateProcessProgress(20, "Đang số hóa tài liệu...");
          const { appendixStartPage, appendixPages } = await scanAppendixWithVision(pdf, ctx, canvas, skippedBlankPages);
          manifest.pages.push(...appendixPages);
          manifest.appendixStartPage = appendixStartPage;
          manifest.sourcePageCount = sourcePageCount;

          const rotatedCount = appendixPages.filter(p => p.rotation && p.rotation !== 0).length;
          console.log(
            `%c[2/4] VISION AI XONG: Tìm thấy Phụ lục từ Trang ${appendixStartPage} (Đã xoay: ${rotatedCount} trang, Bỏ trắng: ${skippedBlankPages.size} trang) ⏱ Thời gian: ${getLapTime()}`,
            "color: #69f0ae; font-weight: bold;"
          );

          // GIAI ĐOẠN 3: Thân Hợp Đồng + Lọc trang trắng (scale 0.22)
          U.updateProcessProgress(45, "Đang xử lý tài liệu...");
          const contractEndPage = appendixStartPage - 1;
          const preScannedPages = new Set(appendixPages.map(p => p.pageNum));
          const bodyPages = [];

          for (let pageNum = 1; pageNum <= contractEndPage; pageNum++) {
            if (preScannedPages.has(pageNum)) continue;

            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.0 });

            let textItems = [];
            try {
              const tc = await page.getTextContent();
              if (tc && tc.items) {
                textItems = tc.items.map(it => [
                  (it.str || "").trim(),
                  U.round1(it.transform[4]),
                  U.round1(it.transform[5]),
                  U.round1(it.width),
                  U.round1(it.height)
                ]).filter(it => it[0].length > 0);
              }
            } catch (tcErr) {}

            if (textItems.length === 0) {
              const thumbVp = page.getViewport({ scale: 0.22 });
              canvas.width = thumbVp.width;
              canvas.height = thumbVp.height;
              await page.render({ canvasContext: ctx, viewport: thumbVp, intent: "display" }).promise;
              if (isScannedPageBlank(canvas)) {
                skippedBlankPages.add(pageNum);
                page.cleanup();
                continue;
              }
            }

            bodyPages.push({
              pageNum: pageNum,
              pdfPageNum: pageNum,
              width: U.round1(viewport.width),
              height: U.round1(viewport.height),
              rotation: 0,
              textItems: textItems
            });

            page.cleanup();

            if (pageNum % 5 === 0) {
              const pct = 45 + Math.round((pageNum / Math.max(1, contractEndPage)) * 35);
              U.updateProcessProgress(pct, "Đang xử lý tài liệu...");
            }
          }

          manifest.pages.push(...bodyPages);
          manifest.pages.sort((a, b) => a.pageNum - b.pageNum);

          console.log(
            `%c[3/4] XỬ LÝ THÂN HĐ XONG: (${bodyPages.length} trang) ⏱ Thời gian: ${getLapTime()}`,
            "color: #ffd740; font-weight: bold;"
          );

          // GIAI ĐOẠN 4: Sửa trực tiếp trang trắng & góc xoay vào file PDF gốc trên Drive
          const rotationMap = new Map();
          manifest.pages.forEach(p => {
            if (p.rotation && p.rotation !== 0) rotationMap.set(p.pageNum, p.rotation);
          });

          const needsPhysicalFix = !isLocalUpload && (skippedBlankPages.size > 0 || rotationMap.size > 0);
          let activePdf = pdf;
          let activePdfBuffer = preservedPdfData;
          let fixedOriginalOnDrive = false;

          if (needsPhysicalFix) {
            try {
              U.updateProcessProgress(82, "Đang tối ưu tài liệu...");
              const PDFLib = await ensurePdfLibLoaded();
              const editDoc = await PDFLib.PDFDocument.load(preservedPdfData.slice(0), { ignoreEncryption: true });

              rotationMap.forEach((extraRot, origPageNum) => {
                const idx = origPageNum - 1;
                if (idx >= 0 && idx < editDoc.getPageCount()) {
                  const p = editDoc.getPage(idx);
                  const curRot = p.getRotation().angle || 0;
                  p.setRotation(PDFLib.degrees((curRot + extraRot) % 360));
                }
              });

              const blankDesc = Array.from(skippedBlankPages).sort((a, b) => b - a);
              blankDesc.forEach(origPageNum => {
                const idx = origPageNum - 1;
                if (idx >= 0 && idx < editDoc.getPageCount() && editDoc.getPageCount() > 1) {
                  editDoc.removePage(idx);
                }
              });

              const cleanBytes = await editDoc.save();
              const cleanBuffer = cleanBytes.buffer.slice(cleanBytes.byteOffset, cleanBytes.byteOffset + cleanBytes.byteLength);

              U.updateProcessProgress(86, "Đang lưu dữ liệu...");
              fixedOriginalOnDrive = await overwriteOriginalPdfOnDrive(fileId, cleanBuffer);

              if (fixedOriginalOnDrive) {
                activePdfBuffer = cleanBuffer;
                await ST.clearFilePageBitmaps(fileId);
                await ST.saveLocalPdfBinary(fileId, cleanBuffer);
                const newPdf = await pdfjsLib.getDocument({ data: cleanBuffer.slice(0) }).promise;
                try { activePdf.destroy(); } catch (e) {}
                activePdf = newPdf;
              }
            } catch (repairErr) {
              console.warn("Không thể ghi đè file PDF sạch, dùng chế độ ánh xạ ảo dự phòng:", repairErr);
              fixedOriginalOnDrive = false;
            }
          }

          const cleanPages = [];
          let cleanAppendixPage = -1;
          const foundIdx = manifest.pages.findIndex(p => p.pageNum >= appendixStartPage);
          if (foundIdx !== -1) cleanAppendixPage = foundIdx + 1;

          manifest.pages.forEach((p, idx) => {
            cleanPages.push({
              pageNum: idx + 1,
              pdfPageNum: fixedOriginalOnDrive ? (idx + 1) : p.pageNum,
              width: p.width,
              height: p.height,
              rotation: fixedOriginalOnDrive ? 0 : (p.rotation || 0),
              textItems: p.textItems
            });
          });

          manifest.pages = cleanPages;
          manifest.numPages = cleanPages.length;
          manifest.appendixStartPage = (cleanAppendixPage !== -1) ? cleanAppendixPage : (cleanPages.length + 1);
          manifest.mapsOriginalPdf = true;
          manifest.pdfByteLength = activePdfBuffer.byteLength;
          manifest.originalPdfCleanChecked = true;

          if (needsPhysicalFix && !fixedOriginalOnDrive) {
            manifest.pdfRepairFailed = true;
          } else {
            delete manifest.pdfRepairFailed;
          }

          U.updateProcessProgress(90, "Đang lưu dữ liệu...");
          let finalDriveFileId = fileId;
          let finalSizeStr = (activePdfBuffer.byteLength / (1024 * 1024)).toFixed(2) + " MB";

          const compressedPayload = await ST.compressManifest(manifest);
          await saveDriveCacheAdaptive(finalDriveFileId, uploadFileName, compressedPayload);

          ST.putSessionCache(finalDriveFileId, manifest);
          await ST.saveLocalManifest(finalDriveFileId, manifest);

          U.updateProcessProgress(96, "Đang hoàn tất...");
          if (cleanPages.length >= 1) {
            const firstPdfPageNum = cleanPages[0].pdfPageNum || 1;
            const page1 = await activePdf.getPage(firstPdfPageNum);
            const rawDpr = window.devicePixelRatio || 1;
            const sharpFactor = Math.max(rawDpr, 2.0);
            const effectiveScale = Math.min(S.cachedRenderScale * sharpFactor, 2.0);
            const effectiveRot1 = (page1.rotate + (cleanPages[0].rotation || 0)) % 360;
            const vp = page1.getViewport({ scale: effectiveScale, rotation: effectiveRot1 });

            const bCanvas = document.createElement("canvas");
            bCanvas.width = Math.floor(vp.width);
            bCanvas.height = Math.floor(vp.height);
            const bCtx = bCanvas.getContext("2d");
            bCtx.fillStyle = "#ffffff";
            bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
            await page1.render({ canvasContext: bCtx, viewport: vp, intent: "display" }).promise;
            page1.cleanup();
            await ST.savePageBitmap(finalDriveFileId, firstPdfPageNum, S.cachedRenderScale, bCanvas);
            bCanvas.width = 0;
            bCanvas.height = 0;
          }

          if (S.currentPdfDoc && S.currentPdfDoc !== activePdf) {
            try { S.currentPdfDoc.destroy(); } catch (e) {}
          }
          S.currentPdfDoc = activePdf;

          console.log(
            `%c[4/4] LƯU DRIVE & CACHE 100% XONG: Dung lượng ${finalSizeStr} ⏱ Thời gian: ${getLapTime()}`,
            "color: #e040fb; font-weight: bold;"
          );

          U.updateProcessProgress(100, "Số hóa hoàn tất", true);

          if (typeof window.markScanFileDigitized_PL === "function") {
            window.markScanFileDigitized_PL(finalDriveFileId);
          }

          if (myEpoch === S.currentSessionEpoch) {
            S.currentManifest = manifest;
            await BV.ui.renderSlicedDocument();
          }

          const listBlank = Array.from(skippedBlankPages).sort((a, b) => a - b);
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
            "Đã sửa trực tiếp file gốc Drive": fixedOriginalOnDrive ? "Có" : "Không (không cần hoặc không đủ quyền)",
            "Dung lượng bản PDF sạch": finalSizeStr,
            "Drive File ID": finalDriveFileId
          });

        } catch (err) {
          U.setAntiExitGuard(false);
          U.hideLoading();
          U.updateProcessProgress(0, "Số hóa thất bại", false, true);
          console.error(`%c❌ LỖI TRONG TIẾN TRÌNH: ${err.message}`, "color: #ff1744; font-size: 13px; font-weight: bold;", err);
        } finally {
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      })
      .catch(function(err) {
        U.setAntiExitGuard(false);
        U.hideLoading();
        console.error(`%c❌ LỖI TẢI NHỊ PHÂN: ${err.message}`, "color: #ff1744; font-weight: bold;", err);

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
              <button type="button" class="prv-btn" onclick="window.BconsViewer.loadFile('${fileId}', '${(uploadFileName || "").replace(/'/g, "\\'")}')" style="padding: 6px 16px; font-size: 12px;">
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

async function ensurePdfPreloaded(fileId, endPct = 95) {
    if (S.currentPdfDoc) {
      U.stopSoftProgress();
      if (S.transitionWaitPromise) {
        await S.transitionWaitPromise;
        if (fileId !== S.currentFileId) throw new Error("ABORTED");
      }
      U.updateLoaderProgress(98);
      return S.currentPdfDoc;
    }
    const epoch = S.currentSessionEpoch;

    let localBuf = await ST.getLocalPdfBinary(fileId);
    if (localBuf && S.currentManifest && S.currentManifest.pdfByteLength && localBuf.byteLength !== S.currentManifest.pdfByteLength) {
      await Promise.all([ST.deleteLocalPdfBinary(fileId), ST.clearFilePageBitmaps(fileId)]);
      localBuf = null;
    }
    let pdfData = localBuf;

    if (!pdfData) {
      const ov = document.getElementById("loading-overlay");
      if (!ov || ov.style.display !== "flex") {
        U.showLoading("LOADING DOCUMENT", 5);
      }
      U.startSoftProgress(Math.max(5, S.currentLoaderPct), 75, 0.015);

      let streamStartPct = null;
      pdfData = await fetchPdfDirectOrFallback(fileId, (loaded, total) => {
        if (epoch !== S.currentSessionEpoch) return;
        U.stopSoftProgress();
        if (streamStartPct === null) {
          streamStartPct = S.currentLoaderPct;
        }
        const ratio = total > 0
          ? Math.min(1, loaded / total)
          : Math.min(0.92, 1 - Math.exp(-loaded / (8 * 1024 * 1024)));
        const pct = streamStartPct + ratio * (endPct - streamStartPct);
        if (pct > S.currentLoaderPct) {
          U.updateLoaderProgress(pct);
        }
      });
    }

    U.stopSoftProgress();
    if (epoch !== S.currentSessionEpoch) throw new Error("ABORTED");

    if (S.transitionWaitPromise) {
      await S.transitionWaitPromise;
      if (epoch !== S.currentSessionEpoch) throw new Error("ABORTED");
    }

    U.updateLoaderProgress(96);
    const preservedBuffer = pdfData.slice(0);
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    if (epoch !== S.currentSessionEpoch) {
      try { pdf.destroy(); } catch (e) {}
      throw new Error("ABORTED");
    }

    const needsLegacyRepair = await detectLegacyUnfixedPdf(pdf, S.currentManifest, epoch, preservedBuffer.byteLength);
    if (epoch !== S.currentSessionEpoch) {
      try { pdf.destroy(); } catch (e) {}
      throw new Error("ABORTED");
    }

    if (
      needsLegacyRepair &&
      S.currentManifest &&
      !S.currentManifest._repairing &&
      !S.currentManifest.pdfRepairFailed &&
      !S.AUTO_REPAIR_ATTEMPTED.has(fileId)
    ) {
      S.currentManifest._repairing = true;
      S.AUTO_REPAIR_ATTEMPTED.add(fileId);
      delete S.SESSION_MANIFEST_CACHE[fileId];
      try { pdf.destroy(); } catch (e) {}

      U.showLoading("RE-DIGITIZING & CLEANING PDF", 5);
      if (typeof showToast_PL === "function") {
        showToast_PL("🔄 Phát hiện bản số hóa cũ còn trang trắng / xoay lệch, đang tự động chuẩn hóa lại...", "success");
      }

      setTimeout(() => {
        if (epoch === S.currentSessionEpoch) processAndOptimizeFileJIT(fileId, null, preservedBuffer);
      }, 50);
      throw new Error("REPAIR_OLD_MANIFEST");
    }

    S.currentPdfDoc = pdf;
    return pdf;
  }

  function isPlOrPdgFile(fileName) {
    if (!fileName) return false;
    const clean = fileName.toLowerCase();
    const isPdg = /pdg|pđg|phe\s*duyet\s*gia|phê\s*duyệt\s*giá|(\b|_)gia(\b|_)|(\b|_)giá(\b|_)/i.test(clean);
    const isPl = /(^|[^a-z0-9])pl(\d+)?([^a-z0-9]|$)|phu\s*luc|phụ\s*lục/i.test(clean);
    return isPdg || isPl;
  }

  async function loadPdfDirectWithoutOcr(fileId, localFileObj = null) {
    const myEpoch = S.currentSessionEpoch;
    try {
      const ramCached = ST.getSessionCache(fileId);
      if (ramCached) {
        S.currentManifest = ramCached;
        if (S.transitionWaitPromise) await S.transitionWaitPromise;
        if (myEpoch !== S.currentSessionEpoch) return;
        await BV.ui.renderSlicedDocument();
        U.hideLoading();
        return;
      }
      const localCached = await ST.getLocalManifest(fileId);
      if (localCached) {
        ST.putSessionCache(fileId, localCached);
        S.currentManifest = localCached;
        if (S.transitionWaitPromise) await S.transitionWaitPromise;
        if (myEpoch !== S.currentSessionEpoch) return;
        await BV.ui.renderSlicedDocument();
        U.hideLoading();
        return;
      }

      U.startSoftProgress(0, 25, 0.035);
      let streamStartPct = null;
      const rawPdfData = localFileObj
        ? await localFileObj.arrayBuffer()
        : await fetchPdfDirectOrFallback(fileId, (loaded, total) => {
            if (myEpoch !== S.currentSessionEpoch) return;
            U.stopSoftProgress();
            if (streamStartPct === null) streamStartPct = S.currentLoaderPct;
            const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
            const pct = streamStartPct + ratio * (95 - streamStartPct);
            if (pct > S.currentLoaderPct) U.updateLoaderProgress(pct);
          });
      U.stopSoftProgress();
      U.updateLoaderProgress(96);

      if (S.transitionWaitPromise) await S.transitionWaitPromise;
      if (myEpoch !== S.currentSessionEpoch) return;

      const preservedPdfData = rawPdfData.slice(0);
      const pdf = await pdfjsLib.getDocument({ data: rawPdfData }).promise;
      S.currentPdfDoc = pdf;

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
              U.round1(it.transform[4]),
              U.round1(it.transform[5]),
              U.round1(it.width),
              U.round1(it.height)
            ]).filter(it => it[0].length > 0);
          }
        } catch (tcErr) {}

        manifest.pages.push({
          pageNum: pNum,
          pdfPageNum: pNum,
          width: U.round1(vp.width),
          height: U.round1(vp.height),
          rotation: 0,
          textItems: textItems
        });
        page.cleanup();
      }

      if (myEpoch !== S.currentSessionEpoch) return;

      ST.putSessionCache(fileId, manifest);
      ST.saveLocalManifest(fileId, manifest);
      ST.saveLocalPdfBinary(fileId, preservedPdfData);

      S.currentManifest = manifest;
      await BV.ui.renderSlicedDocument();
      U.hideLoading();

      console.log(`%c⚡ [DIRECT VIEW] Đã mở trực tiếp (không số hóa): "${S.currentFileName}" (${pdf.numPages} trang)`, "color: #00BCD4; font-weight: bold;");
    } catch (err) {
      U.hideLoading();
      console.error("Lỗi mở trực tiếp PDF:", err);
      if (myEpoch === S.currentSessionEpoch) {
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

  async function loadFile(fileId, fileName, sizeMB, isProcessed, jsonId) {
    if (S.currentFileId === fileId && S.currentManifest) return;

    BV.ui.setupSearchFaviconNote();
    BV.ui.setupHandToolPanning();
    BV.ui.setupCtrlWheelZoom();
    BV.ui.setupTouchPinchZoom();
    BV.ui.setupSmartClipboardCopy();

    S.currentSessionEpoch++;
    const myEpoch = S.currentSessionEpoch;

    if (S.activeFetchAbortController) {
      S.activeFetchAbortController.abort();
      S.activeFetchAbortController = null;
    }
    S.activeFetchAbortController = new AbortController();

    if (S.currentPdfDoc) {
      S.currentPdfDoc.destroy();
      S.currentPdfDoc = null;
    }

    S.currentManifest = null;
    S.currentFileId = fileId;
    S.currentFileName = fileName || "Document.pdf";
    S.currentFileSizeMB = (sizeMB !== undefined) ? sizeMB : 0;
    S.currentScale = 1.0;

    const fnEl = document.getElementById("preview-file-name") || document.getElementById("prv-file-name");
    if (fnEl) fnEl.textContent = S.currentFileName;

    SR.clearSearchState();
    const inp = document.getElementById("jump-page-input");
    if (inp) inp.value = "1";

    const vp = document.getElementById("viewport-container");
    if (vp) {
      vp.style.visibility = "hidden";
      vp.innerHTML = "";
    }
    const pageInd = document.getElementById("page-indicator");
    if (pageInd) pageInd.style.display = "none";

    const isDirectDoc = isPlOrPdgFile(S.currentFileName);

    let cachedManifest = ST.getSessionCache(fileId);
    if (!cachedManifest) {
      cachedManifest = await ST.getLocalManifest(fileId);
      if (myEpoch !== S.currentSessionEpoch) return;
      if (cachedManifest) ST.putSessionCache(fileId, cachedManifest);
    }

    if (cachedManifest) {
      S.currentManifest = cachedManifest;
      if (!isDirectDoc && typeof window.markScanFileDigitized_PL === "function") {
        window.markScanFileDigitized_PL(fileId);
      }

      const hasBin = await ST.getLocalPdfBinary(fileId);
      if (myEpoch !== S.currentSessionEpoch) return;

      if (!hasBin || S.isPanelTransitioning) {
        U.showLoading("LOADING DOCUMENT", hasBin ? 80 : 5);
      }

      try {
        await ensurePdfPreloaded(fileId, 95);
        await BV.ui.renderSlicedDocument();
      } catch (e) {
        if (e.message !== "ABORTED" && e.message !== "REPAIR_OLD_MANIFEST") {
          U.hideLoading();
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

    U.showLoading("LOADING DOCUMENT", 0);

    if (isDirectDoc) {
      await loadPdfDirectWithoutOcr(fileId);
      return;
    }

    U.startSoftProgress(0, 12, 0.035);
    checkDriveCacheWithRetry(fileId, S.currentFileName, 1);
  }

  BV.pipeline = {
    getDriveTokenAsync,
    invalidateDriveToken,
    fetchPdfDirectOrFallback,
    processAndOptimizeFileJIT,
    ensurePdfPreloaded,
    isPlOrPdgFile,
    loadFile
  };
})();