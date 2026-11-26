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
            const trimmedStr = str.trim();
            if (
              trimmedStr.length === 1 &&
              /^[A-Za-zÀ-ỹ]$/.test(trimmedStr) &&
              typeof w.confidence === "number" &&
              w.confidence < 0.6
            ) {
              return;
            }
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

      const cleanWords = correctedWords.filter(function(cw) {
        const s = (cw.str || "").trim();
        if (s.length !== 1 || !/^[A-Za-zÀ-ỹ]$/.test(s)) return true;
        const area = Math.max(1, cw.w * cw.h);
        for (let j = 0; j < correctedWords.length; j++) {
          const other = correctedWords[j];
          if (other === cw || (other.str || "").trim().length < 2) continue;
          const ix = Math.min(cw.x + cw.w, other.x + other.w) - Math.max(cw.x, other.x);
          if (ix <= 0) continue;
          const iy = Math.min(cw.y + cw.h, other.y + other.h) - Math.max(cw.y, other.y);
          if (iy <= 0) continue;
          if ((ix * iy) / area >= 0.4) return false;
        }
        return true;
      });

      return { words: cleanWords, rotation: pdfRotation };
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
  const PH_VV = "\uE003";
  let s = String(str)
    .replace(/(^|[^a-zA-ZÀ-ỹ0-9])v\s*\.\s*v\.?(?=[^a-zA-ZÀ-ỹ0-9]|$)/gi, "$1" + PH_VV)
    .replace(/(\d)\.(?=\d)/g, "$1" + PH_DOT)
    .replace(/(\d),(?=\d)/g, "$1" + PH_COMMA);

  s = s.replace(/[^a-zA-ZÀ-ỹ0-9\uE001\uE002\uE003]+/g, " ");

  return s
    .replace(/\uE003/g, "v.v")
    .replace(/\uE001/g, ".")
    .replace(/\uE002/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function isCrossColumnBoundary_Viewer_(items, leftIt, rightIt) {
  const leftEnd = leftIt.x + leftIt.w;
  const rightStart = rightIt.x;
  const rightEnd = rightStart + rightIt.w;
  const rightCenter = (rightStart + rightEnd) / 2;
  const gap = rightStart - leftEnd;
  const avgH = Math.max(6, (leftIt.h + rightIt.h) / 2);

  const hardMaxGap = Math.max(18, avgH * 1.9);
  if (gap > hardMaxGap) return true;
  if (gap <= Math.max(3.5, avgH * 0.42)) return false;

  // Tách nhanh khi từ bên phải là đơn vị / số liệu đứng sau chữ thuần túy (Nội dung -> ĐVT / Số)
  const rightRaw = (rightIt.str || "").trim();
  const leftRaw = (leftIt.str || "").trim();
  if (
    gap > Math.max(7, avgH * 0.75) &&
    leftRaw && !/\d/.test(leftRaw) &&
    (isStandaloneNumberOrMoney_Viewer_(rightRaw) || isUnitCell_Viewer_(rightRaw))
  ) {
    return true;
  }

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
      if (t.w <= avgH * 14 && t.x < midX - 1.5 && (t.x + t.w) > midX + 1.5) crossingWords++;
      const tEnd = t.x + t.w;
      const tCenter = (t.x + tEnd) / 2;
      if (
        Math.abs(t.x - rightStart) <= 3.5 ||
        Math.abs(tEnd - rightEnd) <= 3.5 ||
        Math.abs(tCenter - rightCenter) <= 3.5
      ) {
        alignedRightColCount++;
      }
    }
  }

  if (distinctY.size >= 2) {
    if (crossingWords === 0 && (alignedRightColCount >= 1 || gap > avgH * 0.85)) return true;
    if (crossingWords <= 1 && alignedRightColCount >= 2 && gap > avgH * 0.65) return true;
  }

  if (gap > Math.max(12, avgH * 1.25)) return true;
  return false;
}

function filterOcrNoiseTokens_Viewer_(items) {
  if (!items || items.length < 3) return items;

  const hs = items.map(it => it.h || 10).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 10;
  const ys = items.map(it => it.y || 0).sort((a, b) => a - b);
  const medY = ys[Math.floor(ys.length / 2)] || 0;

  return items.filter((cur, idx) => {
    const s = (cur.str || "").trim();
    if (s.length !== 1 || idx === 0 || idx === items.length - 1) return true;
    if (!/^[A-Za-zÀ-ỹ]$/.test(s)) return true;

    const prev = items[idx - 1];
    const next = items[idx + 1];
    const curW = Math.max(1, cur.w || 1);
    const curH = Math.max(1, cur.h || 1);

    // 1. Bị từ liền trước hoặc liền sau chồng lấn hộp tọa độ >= 35% bề rộng (OCR đọc lặp nét)
    const overlapPrev = (prev.x + prev.w) - cur.x;
    const overlapNext = (cur.x + curW) - next.x;
    if (overlapPrev >= curW * 0.35 || overlapNext >= curW * 0.35) return false;

    // 2. Chiều cao nhỏ bất thường (< 55% chuẩn dòng) -> vết mực/bụi scan
    if (curH < medH * 0.55) return false;

    // 3. Lệch hẳn đường đáy chữ so với dòng (> 45% chiều cao chuẩn) -> nhiễu dấu mộc/nền
    if (Math.abs((cur.y || 0) - medY) > Math.max(4, medH * 0.45)) return false;

    return true;
  });
}

function isDimensionOrNumericCell_Viewer_(rawText) {
  if (!rawText) return true;
  const trimmed = String(rawText).trim();
  if (!trimmed || isStandaloneNumberOrMoney_Viewer_(trimmed)) return true;
  const norm = removeDiacriticsLower_Viewer_(trimmed)
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return true;
  return /^(?:(?:[øφdwhlr]|phi)\s*)?-?\d+(?:[.,]\d+)?(?:\s*(?:mm|cm|dm|m|m2|m3|md|kg|tan|lit|%))?(?:\s*(?:[x×*\/\-–—±+]|(?:\+-))\s*(?:(?:[øφdwhlr]|phi)\s*)?-?\d+(?:[.,]\d+)?(?:\s*(?:mm|cm|dm|m|m2|m3|md|kg|tan|lit|%))?)*$/.test(norm);
}

function isUnitCell_Viewer_(rawText) {
  if (!rawText) return true;
  const norm = removeDiacriticsLower_Viewer_(rawText).replace(/[.\s]+/g, " ").trim();
  if (!norm || /^[-–—]+$/.test(norm)) return true;
  return /^(m|m2|m3|md|mm|cm|dm|km|kg|tan|lit|l|bo|cai|chiec|cay|tam|vien|cuon|thung|bao|cap|doi|he|ht|he thong|goi|tron goi|lan|phan|diem|cum|can|tang|o|lo|truc|vi tri|cong|ngay|thang|nam|ca|gio|set|pcs|ea|lot|item|unit|m2\/lop|m2\/mat|m\/lop)$/.test(norm);
}

function isExcludedColumnHeader_Viewer_(headerNorm) {
  if (!headerNorm) return false;
  const h = headerNorm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!h) return false;
  // Bảo vệ tuyệt đối các cột mô tả văn bản kỹ thuật
  if (/(noi dung|hang muc|dien giai|ten cong tac|ten vat tu|thong so|chung loai|mo ta|xuat xu|nhan hieu|thuong hieu|nha san xuat|vi tri|khu vuc)/.test(h)) {
    return false;
  }
  if (/^(stt|tt|so tt|ma|ma so|ma hieu|ma cv|code)$/.test(h)) return true;
  if (/\b(dvt|don vi|don vi tinh|unit)\b/.test(h)) return true;
  if (/(khoi luong|so luong|\bkl\b|\bsl\b|dien tich|the tich|trong luong|so bo|so cai|so tang|so can|he so)/.test(h)) return true;
  if (/(don gia|thanh tien|gia tri|vat lieu|nhan cong|may thi cong|chi phi|tong cong|tong gia|\bdg\b|\bvl\b|\bnc\b|\bmtc\b|\bvat\b)/.test(h)) return true;
  if (/(kich thuoc|chieu rong|chieu cao|chieu day|chieu dai|duong kinh|\brong\b|\bcao\b|\bday\b|\bdai\b|\bkt\b)/.test(h)) return true;
  return false;
}

function isTableHeaderLine_Viewer_(lineCells) {
  if (!lineCells || lineCells.length < 3) return false;
  const joined = removeDiacriticsLower_Viewer_(lineCells.map(c => c.text).join(" "));
  let hits = 0;
  if (/\bstt\b/.test(joined)) hits++;
  if (/(noi dung|hang muc|dien giai|ten vat tu|thong so|chung loai)/.test(joined)) hits++;
  if (/(dvt|don vi|khoi luong|so luong|don gia|thanh tien|kich thuoc)/.test(joined)) hits++;
  if (/(don gia|thanh tien)/.test(joined)) hits++;
  return hits >= 3 || (/\bstt\b/.test(joined) && /(noi dung|hang muc|dien giai|ten vat tu)/.test(joined));
}

function detectColumnsFromCells_Viewer_(rowCellLists, headerCells, pageW, prevPageCols) {
  const BIN_PX = 2;
  const numBins = Math.max(10, Math.ceil(pageW / BIN_PX) + 2);
  const bins = new Int32Array(numBins);
  let multiCellRows = 0;

  for (let r = 0; r < rowCellLists.length; r++) {
    const cells = rowCellLists[r];
    if (cells.length < 2) continue;
    multiCellRows++;
  }

  const maxCellW = multiCellRows > 3 ? pageW * 0.50 : pageW * 0.65;
  for (let r = 0; r < rowCellLists.length; r++) {
    const cells = rowCellLists[r];
    if (cells.length < 2) continue;
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      if ((cell.xEnd - cell.x) > maxCellW) continue;
      const bStart = Math.max(0, Math.floor(cell.x / BIN_PX));
      const bEnd = Math.min(numBins - 1, Math.floor(cell.xEnd / BIN_PX));
      for (let b = bStart; b <= bEnd; b++) bins[b]++;
    }
  }

  if (headerCells && headerCells.length >= 2) {
    for (let c = 0; c < headerCells.length; c++) {
      const cell = headerCells[c];
      if ((cell.xEnd - cell.x) > pageW * 0.45) continue;
      const bStart = Math.max(0, Math.floor(cell.x / BIN_PX));
      const bEnd = Math.min(numBins - 1, Math.floor(cell.xEnd / BIN_PX));
      for (let b = bStart; b <= bEnd; b++) bins[b] += 1;
    }
  }

  const extractMergedBands = (floor) => {
    const raw = [];
    let inBand = false;
    let bandStart = 0;
    for (let b = 0; b < numBins; b++) {
      if (bins[b] > floor) {
        if (!inBand) { inBand = true; bandStart = b; }
      } else if (inBand) {
        raw.push({ minX: bandStart * BIN_PX, maxX: b * BIN_PX });
        inBand = false;
      }
    }
    if (inBand) raw.push({ minX: bandStart * BIN_PX, maxX: numBins * BIN_PX });

    const merged = [];
    for (let i = 0; i < raw.length; i++) {
      if (merged.length > 0 && (raw[i].minX - merged[merged.length - 1].maxX) < 4) {
        merged[merged.length - 1].maxX = raw[i].maxX;
      } else {
        merged.push({ minX: raw[i].minX, maxX: raw[i].maxX });
      }
    }
    return merged;
  };

  const noiseFloor = multiCellRows >= 6
    ? Math.max(2, Math.floor(multiCellRows * 0.14))
    : (multiCellRows >= 3 ? 1 : 0);
  let bands = extractMergedBands(noiseFloor);

  if (bands.length === 0 && noiseFloor > 0) {
    bands = extractMergedBands(0);
  }

  // Chẻ các band bị dính nhau dựa trên rãnh mật độ thấp nhất giữa các ô tiêu đề cột
  if (headerCells && headerCells.length >= 3 && bands.length > 0) {
    const sortedHeaders = headerCells.slice().sort((a, b) => a.x - b.x);
    const refinedBands = [];

    for (let bi = 0; bi < bands.length; bi++) {
      const band = bands[bi];
      const innerHeaders = sortedHeaders.filter(hc => {
        const cx = (hc.x + hc.xEnd) / 2;
        return cx >= band.minX - 6 && cx <= band.maxX + 6;
      });

      if (innerHeaders.length < 2) {
        refinedBands.push(band);
        continue;
      }

      const splitBounds = [];
      for (let hi = 0; hi < innerHeaders.length - 1; hi++) {
        const hLeft = innerHeaders[hi];
        const hRight = innerHeaders[hi + 1];
        if ((hRight.x - hLeft.xEnd) < 6) continue;

        const searchStartB = Math.max(0, Math.floor((hLeft.xEnd - 2) / BIN_PX));
        const searchEndB = Math.min(numBins - 1, Math.ceil((hRight.x + 2) / BIN_PX));
        if (searchEndB <= searchStartB) continue;

        let minVal = Infinity;
        let sumMinIdx = 0;
        let countMin = 0;
        for (let b = searchStartB; b <= searchEndB; b++) {
          if (bins[b] < minVal) {
            minVal = bins[b];
            sumMinIdx = b;
            countMin = 1;
          } else if (bins[b] === minVal) {
            sumMinIdx += b;
            countMin++;
          }
        }
        const splitX = Math.round((sumMinIdx / Math.max(1, countMin)) * BIN_PX);
        if (splitX > band.minX + 4 && splitX < band.maxX - 4) {
          splitBounds.push(splitX);
        }
      }

      if (splitBounds.length === 0) {
        refinedBands.push(band);
      } else {
        let curMin = band.minX;
        for (let si = 0; si < splitBounds.length; si++) {
          const sx = splitBounds[si];
          if (sx > curMin + 2) {
            refinedBands.push({ minX: curMin, maxX: sx - 2 });
            curMin = sx + 2;
          }
        }
        if (band.maxX > curMin + 2) {
          refinedBands.push({ minX: curMin, maxX: band.maxX });
        }
      }
    }
    if (refinedBands.length > bands.length) {
      bands = refinedBands;
    }
  }

  if (bands.length === 0 || (bands.length === 1 && prevPageCols && prevPageCols.length >= 3 && !headerCells)) {
    if (prevPageCols && prevPageCols.length > 0) {
      return prevPageCols.map(c => ({
        minX: c.minX,
        maxX: c.maxX,
        boundLeft: c.boundLeft,
        boundRight: c.boundRight,
        headerNorm: c.headerNorm,
        rows: []
      }));
    }
    if (bands.length === 0) {
      return [{ minX: 0, maxX: pageW, boundLeft: 0, boundRight: pageW, headerNorm: "", rows: [] }];
    }
  }

  const cols = bands.map((b, idx) => ({
    minX: b.minX,
    maxX: b.maxX,
    boundLeft: idx === 0 ? 0 : (bands[idx - 1].maxX + b.minX) / 2,
    boundRight: idx === bands.length - 1 ? pageW : (b.maxX + bands[idx + 1].minX) / 2,
    headerNorm: "",
    rows: []
  }));

  // Gắn tiêu đề cột từ dòng header của chính trang này
  if (headerCells && headerCells.length > 0) {
    for (let h = 0; h < headerCells.length; h++) {
      const hc = headerCells[h];
      const cx = (hc.x + hc.xEnd) / 2;
      let target = cols.find(col => cx >= col.boundLeft && cx <= col.boundRight);
      if (!target) {
        let bestDist = Infinity;
        for (let ci = 0; ci < cols.length; ci++) {
          const d = Math.abs(cx - (cols[ci].minX + cols[ci].maxX) / 2);
          if (d < bestDist) { bestDist = d; target = cols[ci]; }
        }
      }
      if (target) {
        const norm = removeDiacriticsLower_Viewer_(hc.text);
        target.headerNorm = target.headerNorm ? (target.headerNorm + " " + norm) : norm;
      }
    }
  } else if (prevPageCols && prevPageCols.length > 0) {
    // Kế thừa nhãn cột từ trang PL01 trước nếu trang này không lặp lại tiêu đề bảng
    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      let bestPrev = null;
      let bestOv = 0;
      for (let pi = 0; pi < prevPageCols.length; pi++) {
        const pc = prevPageCols[pi];
        const ov = Math.min(col.maxX, pc.maxX) - Math.max(col.minX, pc.minX);
        if (ov > bestOv) { bestOv = ov; bestPrev = pc; }
      }
      if (bestPrev && bestOv >= Math.min(col.maxX - col.minX, bestPrev.maxX - bestPrev.minX) * 0.45) {
        col.headerNorm = bestPrev.headerNorm || "";
      }
    }
  }

  return cols;
}

function extractBlocksForColumn_Viewer_(col, pageW) {
  const preparedRows = col.rows;
  if (!preparedRows || preparedRows.length === 0) return [];

  const getRowEndX = (r) => {
    const last = r.items[r.items.length - 1];
    return last ? (last.x + last.w) : r.x;
  };

  const endXs = [];
  const sampleGaps = [];
  for (let i = 0; i < preparedRows.length; i++) {
    if (preparedRows[i].items.length >= 2) endXs.push(getRowEndX(preparedRows[i]));
    if (i > 0) {
      const g = preparedRows[i].baselineY - preparedRows[i - 1].baselineY;
      const refH = preparedRows[i - 1].avgH || 10;
      if (g > 0 && g <= refH * 2.2) sampleGaps.push(g);
    }
  }

  let colRightEdge = col.maxX || 0;
  if (endXs.length >= 3) {
    endXs.sort((a, b) => a - b);
    const p88 = endXs[Math.floor(endXs.length * 0.88)];
    if (p88 > col.minX + 35) colRightEdge = p88;
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

    const isSameCellGap = yGap > 0 && yGap <= refStep * 1.35;
    const conflictsStt = curBlockHasStt && rObj.hasStt;
    const headingBoundary = curBlockIsHeading !== rObj.isHeading;

    let wordWrapBroken = false;
    if (prevRow && colRightEdge > 0 && rObj.items.length > 0 && prevRow.items.length > 0) {
      const prevEndX = getRowEndX(prevRow);
      const prevLastStr = (prevRow.items[prevRow.items.length - 1].str || "").trim();
      const firstWord = rObj.items[0];
      const firstWordStr = (firstWord.str || "").trim();
      const firstChar = firstWordStr.charAt(0);
      const isVvStart = /^v\s*\.\s*v\b/i.test(firstWordStr);
      const startsWithUpper = !isVvStart && firstChar !== "" && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
      const prevEndedJoiner = /[-–—,(/:+]$/.test(prevLastStr);
      const remainingSpace = colRightEdge - prevEndX;

      if (!prevEndedJoiner && startsWithUpper && remainingSpace > (firstWord.w + Math.max(10, prevRowAvgH * 1.5))) {
        wordWrapBroken = true;
      }
    }

    const isContinuation = isSameCellGap && !conflictsStt && !headingBoundary && !wordWrapBroken && curBlockLineCount > 0 && curBlockLineCount < 6;

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

  return itemBlocks;
}

function extractCleanPl01PagesFromManifest_(manifest) {
  if (!manifest || !Array.isArray(manifest.pages) || manifest.pages.length === 0) return [];
  const total = manifest.numPages || manifest.pages.length;
  const apStart = Number(manifest.appendixStartPage);
  if (!apStart || apStart > total) return [];

  const INLINE_UNIT_NEXT_RE = /^(canh|lop|lot|phu|tang|phut|gio|ngay|thang|nam|bo|chiec|cai|mat|ben|loai|phan|dot|mm|cm|m|m2|m3|md|kg|tan|lit|ong|vien|tam|thanh|cay|soi|cuon|thung|bao|cap|doi|he|bac|buoc)$/;
  const STT_CELL_RE = /^(?:\d{1,4}(?:\.\d{1,2}){0,2}|[IVX]{1,4}|[A-Z]\d{0,2}|[a-z])[.)]?$/i;

  const resultPages = [];
  let prevPageCols = null;
  let prevPageW = 0;

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

    // 2. Tách từng dòng thành các cell theo vách ngăn cột (isCrossColumnBoundary_Viewer_)
    const parsedLineCells = [];
    for (let l = 0; l < lines.length; l++) {
      const row = lines[l];
      row.sort((a, b) => a.x - b.x);

      const rawCells = [];
      let curCell = null;
      for (let k = 0; k < row.length; k++) {
        const curIt = row[k];
        if (curIt.str === "|") { curCell = null; continue; }
        if (!curCell) {
          curCell = [curIt];
          rawCells.push(curCell);
        } else {
          const prevIt = curCell[curCell.length - 1];
          if (isCrossColumnBoundary_Viewer_(normItems, prevIt, curIt)) {
            curCell = [curIt];
            rawCells.push(curCell);
          } else {
            curCell.push(curIt);
          }
        }
      }

      const cellObjs = [];
      for (let c = 0; c < rawCells.length; c++) {
        let items = rawCells[c];
        // Tách bỏ dấu câu trang trí ở đầu ô (như gạch đầu dòng "-") trừ khi cả ô chỉ là dấu "-"
        while (items.length > 1 && /^[^a-zA-ZÀ-ỹ0-9]+$/.test(items[0].str.trim())) {
          items.shift();
        }
        items = filterOcrNoiseTokens_Viewer_(items);
        if (items.length === 0) continue;

        const text = items.map(t => t.str).join(" ").trim();
        if (!text) continue;

        const avgH = items.reduce((sum, it) => sum + it.h, 0) / items.length;
        const baselines = items.map(it => pageH - it.y).sort((a, b) => a - b);
        const baselineY = baselines[Math.floor(baselines.length / 2)];
        const x = items[0].x;
        const lastIt = items[items.length - 1];
        const xEnd = lastIt.x + lastIt.w;

        cellObjs.push({ items, x, xEnd, baselineY, avgH, text });
      }

      if (cellObjs.length > 0) parsedLineCells.push(cellObjs);
    }

    if (parsedLineCells.length === 0) continue;

    // 3. Phát hiện dòng tiêu đề bảng (lưu lại để nhận diện tên cột + cắt bỏ tiêu đề đầu trang)
    let headerCells = null;
    let headerLineIdx = -1;
    const headerScanLimit = Math.min(parsedLineCells.length, pNum === apStart ? 20 : 8);
    for (let l = 0; l < headerScanLimit; l++) {
      if (isTableHeaderLine_Viewer_(parsedLineCells[l])) {
        headerCells = parsedLineCells[l];
        headerLineIdx = l;
        break;
      }
    }

    if (pNum === apStart) {
      if (headerLineIdx !== -1) {
        parsedLineCells.splice(0, headerLineIdx + 1);
      } else {
        while (parsedLineCells.length > 0) {
          const firstRaw = removeDiacriticsLower_Viewer_(parsedLineCells[0].map(c => c.text).join(" "));
          if (/^phu luc hop dong\b|^(?:cong trinh|hang muc|goi thau|chu dau tu|dia diem)\s*:/.test(firstRaw)) {
            parsedLineCells.shift();
          } else {
            break;
          }
        }
      }
    } else if (headerLineIdx !== -1) {
      // Các trang tiếp theo lặp lại hàng tiêu đề cột -> chỉ xóa đúng hàng tiêu đề đó
      parsedLineCells.splice(headerLineIdx, 1);
    }

    if (parsedLineCells.length === 0) continue;

    // 4. Bóc sạch hoàn toàn cột STT trước khi dựng Histogram cột (kể cả số STT đứng lẻ giữa 2 dòng)
    if (headerCells && headerCells.length > 1) {
      const h0Norm = removeDiacriticsLower_Viewer_(headerCells[0].text).replace(/[^a-z0-9]/g, "");
      if (headerCells[0].x < pageW * 0.16 && (h0Norm === "stt" || h0Norm === "tt")) {
        headerCells = headerCells.slice(1);
      }
    }

    const col1StartXs = [];
    for (let l = 0; l < parsedLineCells.length; l++) {
      const lc = parsedLineCells[l];
      if (lc.length >= 2) {
        const c0Compact = lc[0].text.replace(/\s+/g, "");
        if (lc[0].x < pageW * 0.16 && (STT_CELL_RE.test(c0Compact) || /^[.)]$/.test(c0Compact))) {
          col1StartXs.push(lc[1].x);
        }
      }
    }
    let sttColMaxX = pageW * 0.16;
    if (col1StartXs.length >= 2) {
      col1StartXs.sort((a, b) => a - b);
      sttColMaxX = Math.min(pageW * 0.16, col1StartXs[Math.floor(col1StartXs.length * 0.4)] - 2);
    }

    const strippedLines = [];
    for (let l = 0; l < parsedLineCells.length; l++) {
      const lc = parsedLineCells[l].slice();
      let lineHasStt = false;
      let lineIsGroupStt = false;

      // Bóc cell STT độc lập ở mép trái (kể cả khi dòng chỉ có duy nhất 1 số STT căn giữa dọc)
      while (lc.length > 0) {
        const c0 = lc[0];
        const c0Compact = c0.text.replace(/\s+/g, "");
        const inSttZone = (c0.x < sttColMaxX) && (c0.xEnd <= sttColMaxX + 8 || lc.length > 1);
        if (inSttZone && (STT_CELL_RE.test(c0Compact) || /^[.)]$/.test(c0Compact))) {
          lineHasStt = true;
          if (/^(?:[IVX]{1,4}|[A-Z])[.)]?$/.test(c0Compact)) lineIsGroupStt = true;
          lc.shift();
        } else {
          break;
        }
      }

      if (lc.length === 0) continue;

      // Dự phòng trường hợp STT dính sát chữ đầu ô văn bản chưa tách thành cell riêng
      let firstItems = lc[0].items.slice();
      let sttStripped = 0;
      while (firstItems.length > 1 && sttStripped < 2) {
        const t0 = firstItems[0];
        const t1 = firstItems[1];
        const s0 = t0.str.trim();
        if (!STT_CELL_RE.test(s0) && !/^[.)]$/.test(s0)) break;
        const gap0 = t1.x - (t0.x + t0.w);
        const avgH0 = Math.max(6, (t0.h + t1.h) / 2);
        const t1Norm = removeDiacriticsLower_Viewer_(t1.str);
        if (/^\d{1,4}$/.test(s0) && gap0 <= avgH0 * 0.75 && INLINE_UNIT_NEXT_RE.test(t1Norm)) break;
        if (t0.x < sttColMaxX || /[.)]$/.test(s0) || (t0.x < pageW * 0.16 && gap0 > Math.max(6, avgH0 * 0.85))) {
          if (/^(?:[IVX]{1,4}|[A-Z])[.)]?$/.test(s0)) lineIsGroupStt = true;
          firstItems.shift();
          sttStripped++;
          lineHasStt = true;
        } else {
          break;
        }
      }
      if (firstItems.length > 0 && sttStripped > 0) {
        lc[0] = Object.assign({}, lc[0], {
          items: firstItems,
          x: firstItems[0].x,
          xEnd: firstItems[firstItems.length - 1].x + firstItems[firstItems.length - 1].w,
          text: firstItems.map(t => t.str).join(" ").trim()
        });
      }

      strippedLines.push({ cells: lc, hasStt: lineHasStt, isGroupStt: lineIsGroupStt });
    }

    if (strippedLines.length === 0) continue;

    // Dựng các cột vật lý của trang (Histogram vách ngăn) sau khi đã loại sạch STT
    const inheritPrev = (prevPageCols && Math.abs(pageW - prevPageW) <= 25) ? prevPageCols : null;
    const cols = detectColumnsFromCells_Viewer_(strippedLines.map(sl => sl.cells), headerCells, pageW, inheritPrev);
    const detectedColCount = cols.length;

    for (let l = 0; l < strippedLines.length; l++) {
      const { cells: lineCells, hasStt: lineHasStt, isGroupStt: lineIsGroupStt } = strippedLines[l];

      // Dự phòng nếu trang không tách được >= 3 cột: lọc bỏ từng cell là ĐVT/số liệu và giữ các cell chữ tách cột riêng
      if (detectedColCount <= 2 && lineCells.length >= 2) {
        const textCells = lineCells.filter(cell => {
          const cellText = (cell.text || "").trim();
          if (!cellText) return false;
          if (isUnitCell_Viewer_(cellText) || isDimensionOrNumericCell_Viewer_(cellText)) return false;
          if (cell.x < pageW * 0.16 && STT_CELL_RE.test(cellText.replace(/\s+/g, ""))) return false;
          return true;
        });
        textCells.forEach((cell, tIdx) => {
          while (cols.length <= tIdx) {
            cols.push({ minX: cell.x, maxX: cell.xEnd, boundLeft: cell.x, boundRight: cell.xEnd, headerNorm: "", rows: [] });
          }
          const cellText = (cell.text || "").trim();
          const lettersOnly = cellText.replace(/[^A-Za-zÀ-ỹ]/g, "");
          const isAllCaps = lettersOnly.length >= 4 && lettersOnly === lettersOnly.toUpperCase();
          cols[tIdx].rows.push({
            items: [...cell.items],
            x: cell.x,
            baselineY: cell.baselineY,
            avgH: cell.avgH,
            hasStt: lineHasStt,
            isGroupStt: lineIsGroupStt,
            text: cellText,
            isHeading: lineIsGroupStt || isAllCaps
          });
        });
        continue;
      }

      const rowBucketByCol = new Map();

      for (let c = 0; c < lineCells.length; c++) {
        const cell = lineCells[c];
        const cellX = cell.x;
        const cellXEnd = cell.xEnd;

        let colIdx = cols.findIndex(col => cellX >= col.boundLeft && cellX <= col.boundRight);
        if (colIdx === -1) {
          let bestOv = -1;
          for (let ci = 0; ci < cols.length; ci++) {
            const ov = Math.min(cellXEnd, cols[ci].boundRight) - Math.max(cellX, cols[ci].boundLeft);
            if (ov > bestOv) { bestOv = ov; colIdx = ci; }
          }
        }
        if (colIdx === -1) colIdx = 0;

        if (!rowBucketByCol.has(colIdx)) {
          rowBucketByCol.set(colIdx, {
            items: [...cell.items],
            x: cellX,
            baselineY: cell.baselineY,
            avgH: cell.avgH,
            hasStt: lineHasStt,
            isGroupStt: lineIsGroupStt
          });
        } else {
          const existing = rowBucketByCol.get(colIdx);
          existing.items.push(...cell.items);
          existing.hasStt = existing.hasStt || lineHasStt;
          existing.isGroupStt = existing.isGroupStt || lineIsGroupStt;
        }
      }

      rowBucketByCol.forEach((rObj, ci) => {
        rObj.items.sort((a, b) => a.x - b.x);
        const joined = rObj.items.map(t => t.str).join(" ").trim();
        if (!joined) return;
        const lettersOnly = joined.replace(/[^A-Za-zÀ-ỹ]/g, "");
        const isAllCaps = lettersOnly.length >= 4 && lettersOnly === lettersOnly.toUpperCase();
        rObj.text = joined;
        rObj.isHeading = rObj.isGroupStt || isAllCaps;
        cols[ci].rows.push(rObj);
      });
    }

    // Lưu cấu trúc cột để kế thừa cho trang PL01 tiếp theo (nếu không lặp tiêu đề)
    if (detectedColCount >= 2) {
      prevPageCols = cols.slice(0, detectedColCount).map(c => ({
        minX: c.minX,
        maxX: c.maxX,
        boundLeft: c.boundLeft,
        boundRight: c.boundRight,
        headerNorm: c.headerNorm
      }));
      prevPageW = pageW;
    }

    // 5. Phân loại từng cột: Giữ cột văn bản, loại STT / ĐVT / Khối lượng / Đơn giá / Thành tiền / Kích thước / Cột thuần số
    const cleanBlocks = [];

    for (let ci = 0; ci < cols.length; ci++) {
      const col = cols[ci];
      if (!col.rows || col.rows.length === 0) continue;

      if (isExcludedColumnHeader_Viewer_(col.headerNorm)) continue;

      let sttCnt = 0, unitCnt = 0, numDimCnt = 0, totalMeaningful = 0;
      for (let r = 0; r < col.rows.length; r++) {
        const txt = (col.rows[r].text || "").trim();
        if (!txt) continue;
        totalMeaningful++;
        const compact = txt.replace(/\s+/g, "");
        if (STT_CELL_RE.test(compact)) sttCnt++;
        if (isUnitCell_Viewer_(txt)) unitCnt++;
        if (isDimensionOrNumericCell_Viewer_(txt)) numDimCnt++;
      }

      if (totalMeaningful === 0) continue;
      const sttRatio = sttCnt / totalMeaningful;
      const unitRatio = unitCnt / totalMeaningful;
      const numDimRatio = numDimCnt / totalMeaningful;

      if (col.minX < pageW * 0.16 && sttRatio >= 0.65) continue;
      if (unitRatio >= 0.65) continue;
      if (numDimRatio >= 0.70) continue;
      if ((unitCnt + numDimCnt) / totalMeaningful >= 0.85 && col.rows.every(r => (r.text || "").length <= 22)) continue;

      // 6. Gom block độc lập cho từng cột văn bản được giữ lại
      const colBlocks = extractBlocksForColumn_Viewer_(col, pageW);
      for (let bIdx = 0; bIdx < colBlocks.length; bIdx++) {
        const blockStr = cleanPl01Punctuation_Viewer_(colBlocks[bIdx].map(t => t.str).join(" "));
        if (!blockStr || blockStr.length < 2 || /^[^a-zA-ZÀ-ỹ0-9]+$/.test(blockStr)) continue;
        if (isDimensionOrNumericCell_Viewer_(blockStr) || isUnitCell_Viewer_(blockStr)) continue;

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

function deleteDigitizedJsonForFile_Viewer_(fileId, optFileName) {
  if (!fileId) return;
  try {
    CacheService.getScriptCache().remove("LOCK_OPT_" + fileId);
  } catch (e) {}

  try {
    const file = DriveApp.getFileById(fileId);
    const resolvedName = (optFileName || file.getName() || "").normalize("NFC");
    const cleanBase = resolvedName.replace(/\.pdf$/i, "").trim();
    if (!cleanBase) return;

    const jsonMain = getJsonCacheName_Viewer_(resolvedName);
    const candidateNames = Array.from(new Set([
      jsonMain,
      jsonMain.normalize("NFD"),
      cleanBase + ".json",
      (cleanBase + ".json").normalize("NFD")
    ]));

    const parents = file.getParents();
    while (parents.hasNext()) {
      const folder = parents.next();
      candidateNames.forEach(name => {
        const files = folder.getFilesByName(name);
        while (files.hasNext()) {
          const jf = files.next();
          if (jf.isTrashed()) continue;
          try {
            Drive.Files.remove(jf.getId());
          } catch (remErr) {
            try { jf.setTrashed(true); } catch (trashErr) {}
          }
        }
      });
    }
  } catch (e) {
    console.warn("Bỏ qua lỗi xóa file JSON số hóa:", e.message);
  }
}

function removeFileFromPl01Index_Viewer_(fileId, maHD, rawDate) {
  if (!fileId) return false;
  const targetId = String(fileId).trim();
  let removed = false;

  try {
    if (maHD || rawDate) {
      const year = extractYearFromContract_Viewer_(maHD || "", rawDate || "", targetId);
      const loaded = loadPl01IndexObj_(year);
      if (loaded.file && loaded.indexObj && loaded.indexObj.files && loaded.indexObj.files[targetId]) {
        delete loaded.indexObj.files[targetId];
        savePl01IndexObj_(year, loaded.indexObj, loaded.file);
        return true;
      }
    }

    const metaList = getPl01IndexMeta();
    for (let i = 0; i < metaList.length; i++) {
      const y = metaList[i].year;
      const loaded = loadPl01IndexObj_(y);
      if (loaded.file && loaded.indexObj && loaded.indexObj.files && loaded.indexObj.files[targetId]) {
        delete loaded.indexObj.files[targetId];
        savePl01IndexObj_(y, loaded.indexObj, loaded.file);
        removed = true;
      }
    }
  } catch (e) {
    console.warn("Bỏ qua lỗi xóa file khỏi Index_PL01:", e.message);
  }
  return removed;
}