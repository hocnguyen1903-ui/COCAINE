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