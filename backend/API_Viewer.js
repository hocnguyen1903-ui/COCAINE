// =========================================================================
// MODULE VIEWER: CLOUD VISION AI & FAST DRIVE CACHING
// =========================================================================

const VIEWER_CHUNK_SIZE = 2500000;
const VIEWER_RAW_PER_CHUNK = (VIEWER_CHUNK_SIZE / 4) * 3;

function getJsonCacheName_Viewer_(fileName) {
  const cleanBase = (fileName || "").normalize("NFC").replace(/\.pdf$/i, "").trim();
  return "[Số hóa] " + (cleanBase || "TaiLieu") + ".json";
}

function getFolderForFile_Viewer_(fileId) {
  if (!fileId || String(fileId).indexOf("local_") === 0) {
    return DriveApp.getRootFolder();
  }
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  if (parents.hasNext()) return parents.next();
  throw new Error("Không tìm thấy thư mục chứa tệp trên Drive.");
}

function findFileByName_Viewer_(folder, name) {
  if (!name || !folder) return null;
  const files = folder.getFilesByName(name);
  while (files.hasNext()) {
    const f = files.next();
    if (!f.isTrashed()) return f;
  }
  return null;
}

function getDriveCacheFast(fileId, fileName) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(1500);
  } catch (e) {
    locked = false;
  }
  if (!locked) return { found: false, isOptimizing: false, busy: true };

  try {
    const scriptCache = CacheService.getScriptCache();
    const folder = getFolderForFile_Viewer_(fileId);
    const targetJsonName = getJsonCacheName_Viewer_(fileName);
    const cleanBase = (fileName || "").normalize("NFC").replace(/\.pdf$/i, "").trim();

    let targetFile = findFileByName_Viewer_(folder, targetJsonName);
    if (!targetFile) {
      targetFile = findFileByName_Viewer_(folder, targetJsonName.normalize("NFD"));
    }
    if (!targetFile && cleanBase) {
      targetFile = findFileByName_Viewer_(folder, cleanBase + ".json") ||
                   findFileByName_Viewer_(folder, (cleanBase + ".json").normalize("NFD"));
    }

    if (targetFile) {
      scriptCache.remove("LOCK_OPT_" + fileId);
      return { found: true, isOptimizing: false, data: targetFile.getBlob().getDataAsString() };
    }

    if (scriptCache.get("LOCK_OPT_" + fileId)) {
      return { found: false, isOptimizing: true };
    }

    scriptCache.put("LOCK_OPT_" + fileId, String(Date.now()), 600);
    return { found: false, isOptimizing: false };
  } catch (e) {
    // Ném lỗi thật để Client retry thay vì hiểu nhầm là "chưa số hóa" rồi đốt Vision API
    throw new Error("Lỗi đọc cache Drive: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

function saveDriveCacheFast(fileId, fileName, jsonDataString) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error("Hệ thống bận ghi dữ liệu, vui lòng thử lại.");
  }

  const scriptCache = CacheService.getScriptCache();
  try {
    const folder = getFolderForFile_Viewer_(fileId);
    const targetJsonName = getJsonCacheName_Viewer_(fileName);
    let targetFile = findFileByName_Viewer_(folder, targetJsonName);

    if (targetFile) {
      targetFile.setContent(jsonDataString);
    } else {
      targetFile = folder.createFile(targetJsonName, jsonDataString, MimeType.PLAIN_TEXT);
    }

    const cleanBase = (fileName || "").replace(/\.pdf$/i, "").trim();
    if (cleanBase) {
      const oldFiles = folder.getFilesByName(cleanBase + ".json");
      while (oldFiles.hasNext()) {
        const oldF = oldFiles.next();
        if (!oldF.isTrashed() && oldF.getId() !== targetFile.getId()) oldF.setTrashed(true);
      }
    }

    if (!isPlOrPdgFile_Viewer_(fileName)) {
      try {
        updatePl01IndexInternal_(fileId, jsonDataString, null);
      } catch (idxErr) {
        console.warn("Bỏ qua lỗi cập nhật Index_PL01:", idxErr.message);
      }
    }

    scriptCache.remove("LOCK_OPT_" + fileId);
    return { success: true, jsonId: targetFile.getId() };
  } catch (e) {
    scriptCache.remove("LOCK_OPT_" + fileId);
    throw new Error("Lỗi lưu cache: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

function getServiceAccountReadOnlyToken_() {
  const cache = CacheService.getScriptCache();
  const cachedToken = cache.get("SA_DRIVE_RO_TOKEN");
  if (cachedToken) return cachedToken;

  const props = PropertiesService.getScriptProperties();
  const clientEmail = (props.getProperty("SA_CLIENT_EMAIL") || "").trim();
  const rawPrivateKey = props.getProperty("SA_PRIVATE_KEY") || "";
  const privateKey = rawPrivateKey.replace(/\\n/g, "\n").trim();

  if (!clientEmail || !privateKey) {
    throw new Error("Chưa cấu hình SA_CLIENT_EMAIL hoặc SA_PRIVATE_KEY trong Script Properties!");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const toB64Url = (input) => Utilities.base64EncodeWebSafe(input).replace(/=+$/, "");
  const signingInput = toB64Url(JSON.stringify(header)) + "." + toB64Url(JSON.stringify(claimSet));
  const signatureBytes = Utilities.computeRsaSha256Signature(signingInput, privateKey);
  const jwt = signingInput + "." + toB64Url(signatureBytes);

  const res = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(jwt),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const data = JSON.parse(res.getContentText());
  if (code !== 200 || !data.access_token) {
    throw new Error("Không thể cấp Service Account Token: " + (data.error_description || data.error || code));
  }

  cache.put("SA_DRIVE_RO_TOKEN", data.access_token, 3000);
  return data.access_token;
}

function getDriveAccessToken() {
  return getServiceAccountReadOnlyToken_();
}

function makeFilePublicAndGetLink(fileId) {
  try {
    if (!fileId || String(fileId).indexOf("local_") === 0) {
      return { success: false, error: "File cục bộ chưa có trên Drive" };
    }
    const file = DriveApp.getFileById(fileId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return {
      success: true,
      url: "https://drive.google.com/file/d/" + fileId + "/preview"
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function callCloudVisionApiBatch(imagesBase64Array) {
  try {
    enforceAiGuard_("VISION", imagesBase64Array, 16, 20);
    const rawKey = PropertiesService.getScriptProperties().getProperty("VISION_API_KEY");
    if (!rawKey) throw new Error("Chưa cài đặt khóa 'VISION_API_KEY' trong Script Properties!");

    // Tự động làm sạch khoảng trắng thừa
    const apiKey = rawKey.trim();

    const url = "https://vision.googleapis.com/v1/images:annotate?key=" + apiKey;
    const MAX_VISION_BATCH = 16;
    let allResponses = [];

    for (let i = 0; i < imagesBase64Array.length; i += MAX_VISION_BATCH) {
      const slice = imagesBase64Array.slice(i, i + MAX_VISION_BATCH);
      const requests = slice.map(function(b64) {
        return {
          image: { content: String(b64).replace(/^data:image\/\w+;base64,/, "") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["vi", "en"] }
        };
      });

      const res = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ requests: requests }),
        muteHttpExceptions: true
      });

      const resJson = JSON.parse(res.getContentText());
      if (resJson.error) {
        const errorDetail = resJson.error.details ? JSON.stringify(resJson.error.details) : "";
        throw new Error(resJson.error.message + (errorDetail ? " -> Details: " + errorDetail : ""));
      }
      if (resJson.responses) {
        allResponses = allResponses.concat(resJson.responses);
      }
    }

    return allResponses.map(function(resp) {
      if (!resp || !resp.fullTextAnnotation || !resp.fullTextAnnotation.pages) {
        return { words: [], rotation: 0 };
      }

      const pObj = resp.fullTextAnnotation.pages[0];
      const imgW = pObj.width || 0;
      const imgH = pObj.height || 0;

      let angle0 = 0, angle90 = 0, angle180 = 0, angle270 = 0;
      const rawWords = [];

      pObj.blocks.forEach(function(b) {
        b.paragraphs.forEach(function(p) {
          p.words.forEach(function(w) {
            const str = w.symbols.map(function(s) { return s.text; }).join("");
            const v = w.boundingBox.vertices || [];
            if (v.length >= 2 && v[0] && v[1]) {
              const dx = (v[1].x || 0) - (v[0].x || 0);
              const dy = (v[1].y || 0) - (v[0].y || 0);
              if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx >= 0) angle0++;
                else angle180++;
              } else {
                if (dy > 0) angle90++;
                else angle270++;
              }
            }

            let minX = null, minY = null, maxX = null, maxY = null;
            for (let i = 0; i < v.length; i++) {
              const vx = v[i].x || 0;
              const vy = v[i].y || 0;
              if (minX === null || vx < minX) minX = vx;
              if (minY === null || vy < minY) minY = vy;
              if (maxX === null || vx > maxX) maxX = vx;
              if (maxY === null || vy > maxY) maxY = vy;
            }

            rawWords.push({
              str: str,
              x: minX || 0,
              y: minY || 0,
              w: Math.max(1, (maxX || 0) - (minX || 0)),
              h: Math.max(1, (maxY || 0) - (minY || 0))
            });
          });
        });
      });

      let detectedAngle = 0;
      const maxVotes = Math.max(angle0, angle90, angle180, angle270);
      if (maxVotes > 0) {
        if (maxVotes === angle90) detectedAngle = 90;
        else if (maxVotes === angle270) detectedAngle = 270;
        else if (maxVotes === angle180) detectedAngle = 180;
      }

      let pdfRotation = 0;
      if (detectedAngle === 90) pdfRotation = 270;
      else if (detectedAngle === 270) pdfRotation = 90;
      else if (detectedAngle === 180) pdfRotation = 180;

      const correctedWords = rawWords.map(function(w) {
        let nx = w.x, ny = w.y, nw = w.w, nh = w.h;

        if (pdfRotation === 270) {
          nx = w.y;
          ny = Math.max(0, imgW - (w.x + w.w));
          nw = w.h;
          nh = w.w;
        } else if (pdfRotation === 90) {
          nx = Math.max(0, imgH - (w.y + w.h));
          ny = w.x;
          nw = w.h;
          nh = w.w;
        } else if (pdfRotation === 180) {
          nx = Math.max(0, imgW - (w.x + w.w));
          ny = Math.max(0, imgH - (w.y + w.h));
        }

        return { str: w.str, x: nx, y: ny, w: nw, h: nh };
      });

      return { words: correctedWords, rotation: pdfRotation };
    });
  } catch (e) {
    throw new Error("Lỗi Cloud Vision Batch: " + e.message);
  }
}

function getPdfBase64Fast(fileId) {
  return Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
}

function fetchDriveByteRange_Viewer_(fileId, start, endInclusive) {
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true",
    {
      method: "get",
      headers: {
        Authorization: "Bearer " + token,
        Range: "bytes=" + start + "-" + endInclusive
      },
      muteHttpExceptions: true
    }
  );
  const code = res.getResponseCode();
  if (code !== 200 && code !== 206) throw new Error("Drive range HTTP " + code);
  return { code: code, bytes: res.getContent() };
}

function getPdfBase64Chunk(fileId, chunkIndex) {
  const size = DriveApp.getFileById(fileId).getSize();
  const b64Len = Math.ceil(size / 3) * 4;
  const totalChunks = Math.max(1, Math.ceil(b64Len / VIEWER_CHUNK_SIZE));
  const idx = Math.max(0, Number(chunkIndex) || 0);
  const rawStart = idx * VIEWER_RAW_PER_CHUNK;
  if (!size || rawStart >= size) return { totalChunks: totalChunks, chunk: "" };

  const rawEnd = Math.min(size, rawStart + VIEWER_RAW_PER_CHUNK) - 1;
  const ranged = fetchDriveByteRange_Viewer_(fileId, rawStart, rawEnd);
  let bytes = ranged.bytes;
  const expect = rawEnd - rawStart + 1;
  if (ranged.code === 200 && bytes.length > expect) {
    bytes = bytes.slice(rawStart, rawEnd + 1);
  }
  return {
    totalChunks: totalChunks,
    chunk: Utilities.base64Encode(bytes).replace(/\s+/g, "")
  };
}

// =========================================================================
// HẠ TẦNG INDEX SHARDING THEO NĂM (Index_PL01_<YEAR>.json) & BACKFILL
// =========================================================================

function getIndexRootFolderId_Viewer_() {
  return (typeof ROOT_FOLDER_ID !== "undefined" && ROOT_FOLDER_ID)
    ? ROOT_FOLDER_ID
    : "1SmlwbdIfTTQAaGTl2sEtRU-KFEYmx9Xc";
}

function getIndexFileName_Viewer_(year) {
  return "Index_PL01_" + String(year).trim() + ".json";
}

function isPlOrPdgFile_Viewer_(fileName) {
  if (!fileName) return false;
  const clean = String(fileName).toLowerCase();
  const isPdg = /pdg|pđg|phe\s*duyet\s*gia|phê\s*duyệt\s*giá|(\b|_)gia(\b|_)|(\b|_)giá(\b|_)/i.test(clean);
  const isPl = /(^|[^a-z0-9])pl(\d+)?([^a-z0-9]|$)|phu\s*luc|phụ\s*lục/i.test(clean);
  return isPdg || isPl;
}

function removeDiacriticsLower_Viewer_(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compressGzipString_Viewer_(rawStr) {
  const blob = Utilities.newBlob(String(rawStr || ""), "application/json", "index.json");
  const gzBytes = Utilities.gzip(blob).getBytes();
  return "GZ:" + Utilities.base64Encode(gzBytes);
}

function decompressGzipString_Viewer_(payloadStr) {
  if (!payloadStr || typeof payloadStr !== "string") return "";
  const trimmed = payloadStr.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  if (trimmed.startsWith("GZ:")) {
    const rawBytes = Utilities.base64Decode(trimmed.slice(3));
    const gzBlob = Utilities.newBlob(rawBytes, "application/x-gzip");
    return Utilities.ungzip(gzBlob).getDataAsString("UTF-8");
  }
  return trimmed;
}

function isStandaloneNumberOrMoney_Viewer_(tok) {
  if (!tok) return false;
  const s = tok.trim();
  if (!s) return false;
  if (/^[-–—]+$/.test(s)) return true;
  if (/^[₫đ%]+$/i.test(s)) return true;
  if (/^\(?-?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?%?\)?$/.test(s)) return true;
  if (/^-?\d+(?:[.,]\d+)?%?$/.test(s)) return true;
  return false;
}

function cleanPl01Punctuation_Viewer_(str) {
  if (!str) return "";
  const PH_DOT = "\uE001";
  const PH_COMMA = "\uE002";
  let s = String(str)
    .replace(/(\d)\.(?=\d)/g, "$1" + PH_DOT)
    .replace(/(\d),(?=\d)/g, "$1" + PH_COMMA);

  s = s.replace(/[^a-zA-ZÀ-ỹ0-9\uE001\uE002]+/g, " ");

  return s
    .replace(/\uE001/g, ".")
    .replace(/\uE002/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function isCrossColumnBoundary_Viewer_(items, leftIt, rightIt) {
  const leftEnd = leftIt.x + leftIt.w;
  const rightStart = rightIt.x;
  const gap = rightStart - leftEnd;
  const avgH = Math.max(6, (leftIt.h + rightIt.h) / 2);

  const hardMaxGap = Math.max(18, avgH * 1.9);
  if (gap > hardMaxGap) return true;
  if (gap <= Math.max(3.5, avgH * 0.42)) return false;

  const midX = (leftEnd + rightStart) / 2;
  const yCenter = (leftIt.y + rightIt.y) / 2;

  let crossingWords = 0;
  let alignedRightColCount = 0;
  const distinctY = new Set();

  for (let idx = 0; idx < items.length; idx++) {
    const t = items[idx];
    if (!t.str) continue;

    const yDiff = Math.abs(t.y - yCenter);
    if (yDiff > 5 && yDiff <= 120) {
      distinctY.add(Math.round(t.y / 6));
      if (t.x < midX - 1.5 && (t.x + t.w) > midX + 1.5) crossingWords++;
      if (Math.abs(t.x - rightStart) <= 3.5) alignedRightColCount++;
    }
  }

  if (distinctY.size >= 2) {
    if (crossingWords === 0 && (alignedRightColCount >= 1 || gap > avgH * 0.85)) return true;
    if (crossingWords <= 1 && alignedRightColCount >= 2 && gap > avgH * 0.65) return true;
  }

  if (gap > Math.max(12, avgH * 1.25)) return true;
  return false;
}

function extractCleanPl01PagesFromManifest_(manifest) {
  if (!manifest || !Array.isArray(manifest.pages) || manifest.pages.length === 0) return [];
  const total = manifest.numPages || manifest.pages.length;
  const apStart = Number(manifest.appendixStartPage);
  if (!apStart || apStart > total) return [];

  const INLINE_UNIT_NEXT_RE = /^(canh|lop|lot|phu|tang|phut|gio|ngay|thang|nam|bo|chiec|cai|mat|ben|loai|phan|dot|mm|cm|m|m2|m3|md|kg|tan|lit|ong|vien|tam|thanh|cay|soi|cuon|thung|bao|cap|doi|he|bac|buoc)$/;
  const STT_CELL_RE = /^(?:\d{1,4}(?:\.\d{1,2}){0,2}|[IVX]{1,4}|[a-z])[.)]?$/i;

  const resultPages = [];

  for (let pIdx = 0; pIdx < manifest.pages.length; pIdx++) {
    const p = manifest.pages[pIdx];
    const pNum = Number(p.pageNum) || (pIdx + 1);
    if (pNum < apStart || !Array.isArray(p.textItems) || p.textItems.length === 0) continue;

    const pageW = Number(p.width) || 595;
    const pageH = Number(p.height) || 842;

    const normItems = [];
    for (let i = 0; i < p.textItems.length; i++) {
      const it = p.textItems[i];
      const str = Array.isArray(it) ? String(it[0] || "").trim() : String(it.str || "").trim();
      if (!str) continue;
      const x = Number(Array.isArray(it) ? it[1] : it.x) || 0;
      const y = Number(Array.isArray(it) ? it[2] : it.y) || 0;
      const w = Number(Array.isArray(it) ? it[3] : it.w) || 0;
      const h = Number(Array.isArray(it) ? it[4] : it.h) || 10;
      const topY = pageH - (y + h);
      normItems.push({ str, x, y, w, h, topY });
    }

    if (normItems.length === 0) continue;
    normItems.sort((a, b) => (a.topY - b.topY) || (a.x - b.x));

    // 1. Gom các từ nằm trên cùng 1 dòng ngang
    const lines = [];
    let curLine = [normItems[0]];
    let anchorTopY = normItems[0].topY;
    let anchorH = normItems[0].h || 10;

    for (let i = 1; i < normItems.length; i++) {
      const item = normItems[i];
      const tol = Math.max(4, Math.min(anchorH, item.h || 10) * 0.55);
      if (Math.abs(item.topY - anchorTopY) <= tol) {
        curLine.push(item);
      } else {
        lines.push(curLine);
        curLine = [item];
        anchorTopY = item.topY;
        anchorH = item.h || 10;
      }
    }
    lines.push(curLine);

    // 2. Tách từng dòng theo vách ngăn cột (isCrossColumnBoundary_Viewer_) -> Chỉ giữ cell cột Nội dung
    const rawRows = [];
    const anchorXs = [];
    const secondColXs = [];

    for (let l = 0; l < lines.length; l++) {
      const row = lines[l];
      row.sort((a, b) => a.x - b.x);

      while (row.length > 0 && /^[^a-zA-ZÀ-ỹ0-9]+$/.test(row[0].str.trim())) {
        row.shift();
      }
      if (row.length === 0) continue;

      const cells = [[row[0]]];
      for (let k = 1; k < row.length; k++) {
        const prevIt = row[k - 1];
        const curIt = row[k];
        if (curIt.str === "|" || isCrossColumnBoundary_Viewer_(normItems, prevIt, curIt)) {
          if (curIt.str !== "|") cells.push([curIt]);
        } else {
          cells[cells.length - 1].push(curIt);
        }
      }

      let hasStt = false;
      let isGroupStt = false;
      while (cells.length > 1) {
        const c0Text = cells[0].map(t => t.str).join("").trim();
        const c0X = cells[0][0].x;
        if (c0X < pageW * 0.16 && (STT_CELL_RE.test(c0Text) || /^[.)]$/.test(c0Text))) {
          if (/^(?:[IVX]{1,4}|[A-Z])[.)]?$/.test(c0Text)) isGroupStt = true;
          cells.shift();
          hasStt = true;
        } else {
          break;
        }
      }

      const mainCell = cells[0];
      if (!mainCell || mainCell.length === 0) continue;

      if (cells.length >= 2) {
        const c1Text = cells[1].map(t => t.str).join(" ").trim();
        if (isStandaloneNumberOrMoney_Viewer_(c1Text) || c1Text.length <= 8) {
          secondColXs.push(cells[1][0].x);
        }
      }

      let sttStripped = 0;
      while (mainCell.length > 1 && sttStripped < 2) {
        const t0 = mainCell[0];
        const t1 = mainCell[1];
        const s0 = t0.str.trim();
        if (!STT_CELL_RE.test(s0) && !/^[.)]$/.test(s0)) break;

        const gap0 = t1.x - (t0.x + t0.w);
        const avgH0 = Math.max(6, (t0.h + t1.h) / 2);
        const t1Norm = removeDiacriticsLower_Viewer_(t1.str);
        if (/^\d{1,4}$/.test(s0) && gap0 <= avgH0 * 0.75 && INLINE_UNIT_NEXT_RE.test(t1Norm)) break;

        if (t0.x < pageW * 0.16 || /[.)]$/.test(s0) || gap0 > Math.max(6, avgH0 * 0.85)) {
          if (/^(?:[IVX]{1,4}|[A-Z])[.)]?$/.test(s0)) isGroupStt = true;
          mainCell.shift();
          sttStripped++;
          hasStt = true;
        } else {
          break;
        }
      }

      if (mainCell.length === 0) continue;
      const cellJoined = mainCell.map(t => t.str).join(" ").trim();
      if (!cellJoined || isStandaloneNumberOrMoney_Viewer_(cellJoined)) continue;

      const avgH = mainCell.reduce((sum, it) => sum + it.h, 0) / mainCell.length;
      const baselines = mainCell.map(it => pageH - it.y).sort((a, b) => a - b);
      const baselineY = baselines[Math.floor(baselines.length / 2)];
      const lettersOnly = cellJoined.replace(/[^A-Za-zÀ-ỹ]/g, "");
      const isAllCaps = lettersOnly.length >= 4 && lettersOnly === lettersOnly.toUpperCase();

      const rowObj = {
        items: mainCell,
        x: mainCell[0].x,
        baselineY: baselineY,
        avgH: avgH,
        hasStt: hasStt,
        isHeading: isGroupStt || isAllCaps
      };
      rawRows.push(rowObj);

      if (cellJoined.length >= 8 && rowObj.x < pageW * 0.35) {
        anchorXs.push(rowObj.x);
      }
    }

    if (rawRows.length === 0) continue;

    // 3. Khóa cứng biên trái & biên phải của cột Nội dung (chặn tuyệt đối cột ĐVT & Ghi chú mép phải)
    let anchorX = pageW * 0.05;
    if (anchorXs.length >= 2) {
      anchorXs.sort((a, b) => a - b);
      anchorX = anchorXs[Math.floor(anchorXs.length * 0.25)];
    }
    const maxAllowedStartX = anchorX + Math.min(45, pageW * 0.08);

    let descColMaxX = Infinity;
    if (secondColXs.length >= 3) {
      secondColXs.sort((a, b) => a - b);
      const medSecondX = secondColXs[Math.floor(secondColXs.length * 0.5)];
      if (medSecondX > anchorX + pageW * 0.15) {
        descColMaxX = medSecondX - 4;
      }
    }

    const preparedRows = [];
    for (let i = 0; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (r.x > maxAllowedStartX || r.x >= descColMaxX) continue;
      if (descColMaxX < Infinity) {
        r.items = r.items.filter(it => it.x < descColMaxX);
        if (r.items.length === 0) continue;
      }
      preparedRows.push(r);
    }
    if (preparedRows.length === 0) continue;

    // 4. Tính bước dòng nội bộ theo baselineY + mép phải cột Nội dung để ngắt ô chuẩn theo quy luật Word-Wrap
    const getRowEndX = (r) => {
      const last = r.items[r.items.length - 1];
      return last ? (last.x + last.w) : r.x;
    };

    const endXs = [];
    const sampleGaps = [];
    for (let i = 0; i < preparedRows.length; i++) {
      if (preparedRows[i].items.length >= 2) {
        endXs.push(getRowEndX(preparedRows[i]));
      }
      if (i > 0) {
        const g = preparedRows[i].baselineY - preparedRows[i - 1].baselineY;
        const refH = preparedRows[i - 1].avgH || 10;
        if (g > 0 && g <= refH * 2.2) sampleGaps.push(g);
      }
    }

    let colRightEdge = 0;
    if (endXs.length >= 3) {
      endXs.sort((a, b) => a - b);
      const p88 = endXs[Math.floor(endXs.length * 0.88)];
      if (p88 > anchorX + pageW * 0.15) colRightEdge = p88;
    }

    let pageBaseStep = 0;
    if (sampleGaps.length >= 3) {
      sampleGaps.sort((a, b) => a - b);
      pageBaseStep = sampleGaps[Math.floor(sampleGaps.length * 0.25)];
    }

    const itemBlocks = [];
    let curBlockItems = [];
    let curBlockLineCount = 0;
    let curBlockHasStt = false;
    let curBlockIsHeading = false;
    let prevRow = null;
    let prevRowBaselineY = -999;
    let prevRowAvgH = 10;

    for (let rIdx = 0; rIdx < preparedRows.length; rIdx++) {
      const rObj = preparedRows[rIdx];
      const yGap = rObj.baselineY - prevRowBaselineY;
      const refStep = pageBaseStep > 0
        ? Math.max(prevRowAvgH * 1.05, Math.min(pageBaseStep, prevRowAvgH * 1.55))
        : prevRowAvgH * 1.3;

      const isSameCellGap = yGap > 0 && yGap <= refStep * 1.32;
      const conflictsStt = curBlockHasStt && rObj.hasStt;
      const headingBoundary = curBlockIsHeading !== rObj.isHeading;

      let wordWrapBroken = false;
      if (prevRow && colRightEdge > 0 && rObj.items.length > 0 && prevRow.items.length > 0) {
        const prevEndX = getRowEndX(prevRow);
        const prevLastStr = (prevRow.items[prevRow.items.length - 1].str || "").trim();
        const firstWord = rObj.items[0];
        const firstChar = (firstWord.str || "").trim().charAt(0);
        const startsWithUpper = firstChar !== "" && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
        const prevEndedJoiner = /[-–—,(/:+]$/.test(prevLastStr);
        const remainingSpace = colRightEdge - prevEndX;

        if (!prevEndedJoiner && startsWithUpper && remainingSpace > (firstWord.w + Math.max(10, prevRowAvgH * 1.5))) {
          wordWrapBroken = true;
        }
      }

      const isContinuation = isSameCellGap && !conflictsStt && !headingBoundary && !wordWrapBroken && curBlockLineCount > 0 && curBlockLineCount < 4;

      if (isContinuation) {
        curBlockItems.push(...rObj.items);
        curBlockLineCount++;
        if (rObj.hasStt) curBlockHasStt = true;
      } else {
        if (curBlockItems.length > 0) itemBlocks.push(curBlockItems);
        curBlockItems = [...rObj.items];
        curBlockLineCount = 1;
        curBlockHasStt = rObj.hasStt;
        curBlockIsHeading = rObj.isHeading;
      }

      prevRow = rObj;
      prevRowBaselineY = rObj.baselineY;
      prevRowAvgH = rObj.avgH;
    }
    if (curBlockItems.length > 0) itemBlocks.push(curBlockItems);

    // 5. Chuẩn hóa văn bản & lọc tiêu đề/ký tên hành chính
    const cleanBlocks = [];
    for (let bIdx = 0; bIdx < itemBlocks.length; bIdx++) {
      const blockStr = cleanPl01Punctuation_Viewer_(itemBlocks[bIdx].map(t => t.str).join(" "));
      if (!blockStr || blockStr.length < 2 || /^[^a-zA-ZÀ-ỹ0-9]+$/.test(blockStr)) continue;

      const normBlock = removeDiacriticsLower_Viewer_(blockStr);
      const isTableHeader = normBlock.includes("stt") &&
        (normBlock.includes("noi dung") || normBlock.includes("hang muc") || normBlock.includes("dien giai") || normBlock.includes("ten vat tu")) &&
        (normBlock.includes("don gia") || normBlock.includes("thanh tien") || normBlock.includes("khoi luong") || normBlock.includes("dvt"));
      const isAdminBoilerplate =
        /^cong hoa xa hoi chu nghia viet nam\b/.test(normBlock) ||
        /^doc lap tu do hanh phuc\b/.test(normBlock) ||
        (/^trang \d+( \d+)?$/.test(normBlock)) ||
        ((/^(dai dien ben a|dai dien ben b|ben a|ben b|tong giam doc|pho tong giam doc|giam doc)\b/.test(normBlock)) && normBlock.length <= 45) ||
        ((/^(ky ten|ky va ghi ro ho ten|dong dau)\b/.test(normBlock)) && normBlock.length <= 35);

      if (isTableHeader || isAdminBoilerplate) continue;
      cleanBlocks.push(blockStr);
    }

    if (cleanBlocks.length > 0) {
      resultPages.push([pNum, cleanBlocks]);
    }
  }

  return resultPages;
}

function extractYearFromContract_Viewer_(maHD, rawDate, fileId) {
  if (maHD) {
    const m1 = String(maHD).match(/\/(20\d{2})\//);
    if (m1) return m1[1];
  }
  if (rawDate) {
    const m2 = String(rawDate).match(/\b(20\d{2})\b/);
    if (m2) return m2[1];
  }
  if (fileId) {
    try {
      return String(DriveApp.getFileById(fileId).getDateCreated().getFullYear());
    } catch (e) {}
  }
  return String(new Date().getFullYear());
}

function resolveContractMetaForFileId_(fileId) {
  const res = Sheets.Spreadsheets.Values.get(SHEET_ID, "SO HDTCXD BCONS - NTP!B3:P", {
    valueRenderOption: "FORMATTED_VALUE"
  });
  const rows = res.values || [];
  const target = String(fileId).trim();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const scanStr = String(r[14] || "");
    if (!scanStr || !scanStr.includes(target + "|")) continue;
    const maHD = String(r[3] || "").trim();
    if (/^PL\d+/i.test(maHD)) continue;
    const rawDate = String(r[0] || "").trim();
    return {
      maHD: maHD,
      year: extractYearFromContract_Viewer_(maHD, rawDate, target)
    };
  }
  return {
    maHD: "",
    year: extractYearFromContract_Viewer_("", "", target)
  };
}

function loadPl01IndexObj_(year) {
  const rootFolder = DriveApp.getFolderById(getIndexRootFolderId_Viewer_());
  const fileName = getIndexFileName_Viewer_(year);
  const existing = findFileByName_Viewer_(rootFolder, fileName);

  if (!existing) {
    return {
      file: null,
      indexObj: { year: String(year), updatedAt: Date.now(), version: 1, files: {} }
    };
  }

  try {
    const raw = existing.getBlob().getDataAsString("UTF-8");
    const jsonStr = decompressGzipString_Viewer_(raw);
    const parsed = JSON.parse(jsonStr);
    if (!parsed.files || typeof parsed.files !== "object") parsed.files = {};
    parsed.year = String(year);
    return { file: existing, indexObj: parsed };
  } catch (e) {
    console.warn("Lỗi đọc Index_PL01_" + year + ", khởi tạo mới:", e.message);
    return {
      file: existing,
      indexObj: { year: String(year), updatedAt: Date.now(), version: 1, files: {} }
    };
  }
}

function savePl01IndexObj_(year, indexObj, existingFile) {
  const rootFolder = DriveApp.getFolderById(getIndexRootFolderId_Viewer_());
  const fileName = getIndexFileName_Viewer_(year);
  indexObj.year = String(year);
  indexObj.updatedAt = Date.now();
  indexObj.version = 1;

  const compressed = compressGzipString_Viewer_(JSON.stringify(indexObj));
  const target = existingFile || findFileByName_Viewer_(rootFolder, fileName);

  if (target) {
    target.setContent(compressed);
    return target;
  }
  return rootFolder.createFile(fileName, compressed, MimeType.PLAIN_TEXT);
}

function updatePl01IndexInternal_(fileId, manifestOrJsonString, optMeta) {
  if (!fileId) return false;
  const meta = optMeta || resolveContractMetaForFileId_(fileId);
  if (!meta.maHD || /^PL\d+/i.test(meta.maHD)) return false;

  const manifest = (typeof manifestOrJsonString === "string")
    ? JSON.parse(decompressGzipString_Viewer_(manifestOrJsonString))
    : manifestOrJsonString;

  const pages = extractCleanPl01PagesFromManifest_(manifest);
  const loaded = loadPl01IndexObj_(meta.year);
  const indexObj = loaded.indexObj;

  if (pages.length > 0) {
    indexObj.files[fileId] = {
      maHD: meta.maHD,
      apStart: Number(manifest.appendixStartPage) || pages[0][0],
      pages: pages
    };
  } else {
    delete indexObj.files[fileId];
  }

  savePl01IndexObj_(meta.year, indexObj, loaded.file);
  return true;
}

function getPl01IndexMeta() {
  const rootFolder = DriveApp.getFolderById(getIndexRootFolderId_Viewer_());
  const files = rootFolder.getFiles();
  const list = [];

  while (files.hasNext()) {
    const f = files.next();
    if (f.isTrashed()) continue;
    const m = f.getName().match(/^Index_PL01_(\d{4})\.json$/);
    if (!m) continue;
    list.push({
      year: m[1],
      fileId: f.getId(),
      updatedAt: f.getLastUpdated().getTime(),
      size: f.getSize()
    });
  }

  list.sort((a, b) => Number(b.year) - Number(a.year));
  return list;
}

function getPl01IndexByYear(year) {
  const y = String(year || "").trim();
  if (!/^\d{4}$/.test(y)) throw new Error("Năm Index không hợp lệ.");

  const rootFolder = DriveApp.getFolderById(getIndexRootFolderId_Viewer_());
  const file = findFileByName_Viewer_(rootFolder, getIndexFileName_Viewer_(y));
  if (!file) {
    return { year: y, found: false, updatedAt: 0, data: null };
  }

  return {
    year: y,
    found: true,
    fileId: file.getId(),
    updatedAt: file.getLastUpdated().getTime(),
    data: file.getBlob().getDataAsString("UTF-8")
  };
}

function backfillPl01IndexFromDrive(options) {
  const startMs = Date.now();
  const opts = options || {};
  const forceRebuild = Boolean(opts.forceRebuild);
  const targetYear = opts.targetYear ? String(opts.targetYear).trim() : "";

  const res = Sheets.Spreadsheets.Values.get(SHEET_ID, "SO HDTCXD BCONS - NTP!B3:P", {
    valueRenderOption: "FORMATTED_VALUE"
  });
  const rows = res.values || [];
  const byYear = {};

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawDate = String(r[0] || "").trim();
    const maHD = String(r[3] || "").trim();
    const scanRaw = String(r[14] || "").trim();

    if (!maHD || /^PL\d+/i.test(maHD) || !scanRaw || !scanRaw.includes("|")) continue;

    const entries = scanRaw.split(";;").filter(Boolean);
    let mainEntry = null;
    for (let j = 0; j < entries.length; j++) {
      const parts = entries[j].split("|");
      const fId = (parts[0] || "").trim();
      const fName = (parts[1] || "").trim();
      const digitizedFlag = (parts[2] || "").trim();
      if (!fId || digitizedFlag !== "1" || isPlOrPdgFile_Viewer_(fName)) continue;
      mainEntry = { fileId: fId, fileName: fName };
      break;
    }
    if (!mainEntry) continue;

    const year = extractYearFromContract_Viewer_(maHD, rawDate, mainEntry.fileId);
    if (targetYear && year !== targetYear) continue;

    if (!byYear[year]) byYear[year] = [];
    byYear[year].push({ fileId: mainEntry.fileId, fileName: mainEntry.fileName, maHD: maHD });
  }

  let processed = 0, skipped = 0, failed = 0, timedOut = false;
  const yearsUpdated = [];

  const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));
  for (let yIdx = 0; yIdx < years.length; yIdx++) {
    if (timedOut) break;
    const y = years[yIdx];
    const items = byYear[y];

    const loaded = loadPl01IndexObj_(y);
    const workingFiles = forceRebuild ? {} : Object.assign({}, loaded.indexObj.files);
    const touchedIds = {};
    let changed = forceRebuild;

    for (let k = 0; k < items.length; k++) {
      if (Date.now() - startMs > 270000) {
        timedOut = true;
        break;
      }

      const item = items[k];
      if (!forceRebuild && workingFiles[item.fileId]) {
        skipped++;
        continue;
      }

      try {
        const folder = getFolderForFile_Viewer_(item.fileId);
        const jsonName = getJsonCacheName_Viewer_(item.fileName);
        const cleanBase = item.fileName.normalize("NFC").replace(/\.pdf$/i, "").trim();

        let jsonFile = findFileByName_Viewer_(folder, jsonName) ||
                       findFileByName_Viewer_(folder, jsonName.normalize("NFD"));
        if (!jsonFile && cleanBase) {
          jsonFile = findFileByName_Viewer_(folder, cleanBase + ".json") ||
                     findFileByName_Viewer_(folder, (cleanBase + ".json").normalize("NFD"));
        }

        if (!jsonFile) {
          failed++;
          continue;
        }

        const rawContent = jsonFile.getBlob().getDataAsString("UTF-8");
        const manifest = JSON.parse(decompressGzipString_Viewer_(rawContent));
        const pages = extractCleanPl01PagesFromManifest_(manifest);

        const entryObj = {
          maHD: item.maHD,
          apStart: Number(manifest.appendixStartPage) || (pages.length > 0 ? pages[0][0] : 0),
          pages: pages
        };
        workingFiles[item.fileId] = entryObj;
        touchedIds[item.fileId] = entryObj;
        changed = true;
        processed++;
      } catch (itemErr) {
        failed++;
        console.warn(`[Backfill] Lỗi file ${item.fileName} (${item.fileId}): ${itemErr.message}`);
      }
    }

    if (changed) {
      const lock = LockService.getScriptLock();
      try {
        lock.waitLock(20000);
        const latest = loadPl01IndexObj_(y);
        const finalFiles = forceRebuild ? workingFiles : Object.assign({}, latest.indexObj.files, touchedIds);
        latest.indexObj.files = finalFiles;
        savePl01IndexObj_(y, latest.indexObj, latest.file);
        yearsUpdated.push(y);
      } finally {
        lock.releaseLock();
      }
    }
  }

  const summary = { processed, skipped, failed, timedOut, yearsUpdated };
  console.log("[Backfill PL01 Index] Summary:", JSON.stringify(summary));
  return summary;
}

function rebuildAllPl01IndexesFromDrive() {
  return backfillPl01IndexFromDrive({ forceRebuild: true });
}