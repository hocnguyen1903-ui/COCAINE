const SHEET_ID = "1y73SqPevgBN7s0_uhUhYQoGD1OXDbDgvHHXbLQD1EH0";
const SHEET_NAME_TBKQ = "TBKQTT";
const SHEET_NAME_SO_TB = "SO THONG BAO";
const MASTER_FOLDER_ID = '1zStGfH5eitVgbxHF-bhrQGE4NWoKlCpw';
const EXPORT_FOLDER_ID = "1pyq3zmQHligiYxr2MqvEr9aijByqqkhB";

// --- ĐỊNH DANH TOÀN CỤC CHO THIẾT BỊ ĐANG GỌI API ---
var GLOBAL_STAFF_NAME = "UNKNOWN";
var GLOBAL_STAFF_ROLE = "USER"; // Mặc định quyền của phiên làm việc là USER


// --- CẤU HÌNH KHÓA TRUYỀN TIN THỜI GIAN THỰC ABLY ---
const ABLY_API_KEY = "GNetjA.Fp7ryA:mZOogyAfJeLjEL-J3WN-893xuKX-_vZvj25jv0AR8RU";

function getHmacSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty("SERVER_HMAC_SECRET");
  if (secret) return secret;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    secret = props.getProperty("SERVER_HMAC_SECRET");
    if (!secret) {
      secret = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
      props.setProperty("SERVER_HMAC_SECRET", secret);
    }
    return secret;
  } finally {
    lock.releaseLock();
  }
}

function constantTimeEqual_(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

function signSessionToken_(mail) {
  const secret = getHmacSecret_();
  const payload = {
    m: mail.toLowerCase().trim(),
    exp: Date.now() + (30 * 24 * 60 * 60 * 1000) // Hạn 30 ngày
  };
  const toB64Url = (s) => Utilities.base64EncodeWebSafe(s).replace(/=+$/, "");
  const payloadB64 = toB64Url(JSON.stringify(payload));
  const sigBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  const sigB64 = toB64Url(sigBytes);
  return `BCONS2.${payloadB64}.${sigB64}`;
}

function verifySessionToken_(token) {
  if (!token || typeof token !== "string" || !token.startsWith("BCONS2.")) return "";
  const parts = token.split(".");
  if (parts.length !== 3) return "";

  const payloadB64 = parts[1];
  const sigB64 = parts[2];
  const secret = getHmacSecret_();
  const expectedSigBytes = Utilities.computeHmacSha256Signature(payloadB64, secret);
  const expectedSigB64 = Utilities.base64EncodeWebSafe(expectedSigBytes).replace(/=+$/, "");

  if (!constantTimeEqual_(sigB64, expectedSigB64)) return "";

  try {
    let padded = payloadB64;
    while (padded.length % 4 !== 0) padded += "=";
    const jsonStr = Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
    const payload = JSON.parse(jsonStr);
    if (!payload.m || !payload.exp || Date.now() > payload.exp) return "";
    return payload.m.toLowerCase().trim();
  } catch (e) {
    return "";
  }
}

function hashPassword_(rawPass, existingSalt = null) {
  const salt = existingSalt || Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${salt}:${rawPass}`, Utilities.Charset.UTF_8);
  const hex = bytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0")).join("");
  return `sha256$${salt}$${hex}`;
}

function verifyPassword_(inputPass, storedVal) {
  const cleanStored = String(storedVal || "");
  if (!cleanStored) return { matched: false, needsMigration: false };

  if (cleanStored.startsWith("sha256$")) {
    const parts = cleanStored.split("$");
    if (parts.length !== 3) return { matched: false, needsMigration: false };
    const candidateHash = hashPassword_(inputPass, parts[1]);
    return { matched: constantTimeEqual_(candidateHash, cleanStored), needsMigration: false };
  }

  // Hỗ trợ tài khoản cũ hoặc mật khẩu tạm Admin vừa gõ tay vào Sheet -> Tự động nâng cấp sang SHA-256
  return { matched: constantTimeEqual_(inputPass, cleanStored), needsMigration: true };
}

function generateRandomTempPass_(len = 6) {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [
    letters[Math.floor(Math.random() * letters.length)],
    digits[Math.floor(Math.random() * digits.length)]
  ];
  for (let i = 2; i < len; i++) {
    chars.push(all[Math.floor(Math.random() * all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function authenticateAndGetName(token) {
  if (!token) throw new Error("UNAUTHORIZED: Phiên làm việc không tồn tại, vui lòng đăng nhập!");

  const targetMail = verifySessionToken_(token);
  if (!targetMail) {
    throw new Error("UNAUTHORIZED: Phiên làm việc không hợp lệ hoặc đã hết hạn, vui lòng đăng nhập lại!");
  }

  const cache = CacheService.getScriptCache();
  let cachedVal = cache.get("USER_AUTH_" + targetMail);

  if (!cachedVal) {
    try {
      const response = Sheets.Spreadsheets.Values.get(SHEET_ID, "User_Registry!A2:E", {
        valueRenderOption: "UNFORMATTED_VALUE"
      });
      const data = response.values || [];
      for (let i = 0; i < data.length; i++) {
        const rowMail = (data[i][0] || "").toString().toLowerCase().trim();
        const uStatus = (data[i][3] || "").toString().toUpperCase().trim();
        if (rowMail === targetMail) {
          if (uStatus !== "ACTIVE") {
            throw new Error("UNAUTHORIZED: Tài khoản đã bị khóa hoặc đang chờ phê duyệt!");
          }
          const uName = (data[i][1] || "").toString().toUpperCase().trim();
          const uRole = (data[i][4] || "USER").toString().toUpperCase().trim();
          cachedVal = uName + "|" + uRole;
          cache.put("USER_AUTH_" + targetMail, cachedVal, 1800);
          break;
        }
      }
    } catch (e) {
      throw new Error(e.message || "Lỗi xác thực người dùng");
    }
  }

  if (cachedVal && cachedVal.includes("|")) {
    const parts = cachedVal.split("|");
    GLOBAL_STAFF_NAME = parts[0].toUpperCase().trim();
    GLOBAL_STAFF_ROLE = parts[1] ? parts[1].toUpperCase().trim() : "USER";
    return GLOBAL_STAFF_NAME;
  }

  throw new Error("UNAUTHORIZED: Tài khoản không tồn tại hoặc đã bị khóa!");
}

function loginUser(mail, password) {
  const targetMail = (mail || "").toLowerCase().trim();
  const inputPass = (password || "").toString();
  if (!targetMail || !inputPass) {
    throw new Error("Vui lòng nhập đầy đủ Email và Password!");
  }

  const cache = CacheService.getScriptCache();
  const failKey = "LOGIN_FAIL_" + targetMail;
  const failCount = parseInt(cache.get(failKey) || "0", 10);
  if (failCount >= 5) {
    throw new Error("Tài khoản tạm khóa 10 phút do nhập sai mật khẩu quá 5 lần!");
  }

  const response = Sheets.Spreadsheets.Values.get(SHEET_ID, "User_Registry!A2:E", {
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  const data = response.values || [];

  let matchedRowNum = -1;
  let matchedName = "";
  let storedPassword = "";
  let status = "PENDING";
  let role = "USER";

  for (let i = 0; i < data.length; i++) {
    if ((data[i][0] || "").toString().toLowerCase().trim() === targetMail) {
      matchedRowNum = i + 2;
      matchedName = (data[i][1] || "").toString().toUpperCase().trim();
      storedPassword = (data[i][2] || "").toString();
      status = (data[i][3] || "PENDING").toString().toUpperCase().trim();
      role = (data[i][4] || "USER").toString().toUpperCase().trim();
      break;
    }
  }

  if (!matchedName) {
    throw new Error("Email của sếp chưa được đăng ký trong hệ thống!");
  }

  const check = verifyPassword_(inputPass, storedPassword);
  if (!check.matched) {
    const newFails = failCount + 1;
    cache.put(failKey, String(newFails), 600);
    throw new Error(`Sai mật khẩu đăng nhập hệ thống! (Còn ${Math.max(0, 5 - newFails)} lần thử)`);
  }

  cache.remove(failKey);

  if (status !== "ACTIVE") {
    throw new Error("Tài khoản đang chờ phê duyệt hoặc đã bị khóa!");
  }

  if (check.needsMigration && matchedRowNum > 1) {
    try {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("User_Registry");
      if (sheet) {
        sheet.getRange(matchedRowNum, 3).setNumberFormat("@").setValue(hashPassword_(inputPass));
      }
    } catch (e) {
      console.warn("Bỏ qua lỗi auto-migrate hash mật khẩu:", e.message);
    }
  }

  const token = signSessionToken_(targetMail);
  cache.put("USER_AUTH_" + targetMail, `${matchedName}|${role}`, 1800);

  return { success: true, token: token, name: matchedName, role: role };
}

function approveUser_InApp(mail) {
  if (GLOBAL_STAFF_ROLE !== "ADMIN") {
    throw new Error("BẢO MẬT: Sếp không có quyền quản trị để thực hiện hành động này!");
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("User_Registry");
  if (!sheet) return false;

  const data = sheet.getDataRange().getValues();
  const targetMail = mail.toLowerCase().trim();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
      sheet.getRange(i + 1, 4).setValue("ACTIVE");
      CacheService.getScriptCache().remove("USER_AUTH_" + targetMail);
      return true;
    }
  }
  return false;
}

function rejectUser_InApp(mail) {
  if (GLOBAL_STAFF_ROLE !== "ADMIN") {
    throw new Error("BẢO MẬT: Sếp không có quyền quản trị để thực hiện hành động này!");
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("User_Registry");
    if (!sheet) return false;

    const data = sheet.getDataRange().getValues();
    const targetMail = mail.toLowerCase().trim();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
        sheet.deleteRow(i + 1);
        CacheService.getScriptCache().remove("USER_AUTH_" + targetMail);
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

function registerUser(mail, name, password) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName("User_Registry");
    if (!sheet) {
      sheet = ss.insertSheet("User_Registry");
      sheet.appendRow(["Mail", "Name", "Password", "Status", "Role", "Token"]);
    }

    const targetMail = (mail || "").toLowerCase().trim();
    const targetName = (name || "").toUpperCase().trim();
    const cleanPassword = password ? password.toString() : "";

    if (cleanPassword.length < 4) {
      throw new Error("Mật khẩu đăng ký phải chứa tối thiểu 4 ký tự!");
    }

    const data = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
        throw new Error("Email này đã được sử dụng!");
      }
      if (data[i][1]?.toString().toUpperCase().trim() === targetName) {
        throw new Error(`Tên viết tắt "${targetName}" này đã tồn tại! Vui lòng chọn tên viết tắt khác.`);
      }
    }

    const hashedPassword = hashPassword_(cleanPassword);
    const nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, 5).setNumberFormat("@").setValues([[
      targetMail, targetName, hashedPassword, "PENDING", "USER"
    ]]);

    try {
      const ablyUrl = "https://rest.ably.io/channels/bcons_notification/messages";
      const ablyPayload = {
        "name": "new_registration",
        "data": { "mail": targetMail, "name": targetName }
      };
      UrlFetchApp.fetch(ablyUrl, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Utilities.base64Encode(ABLY_API_KEY),
          "Content-Type": "application/json"
        },
        payload: JSON.stringify(ablyPayload),
        muteHttpExceptions: true
      });
    } catch (err) {
      console.warn("Lỗi Ably Realtime: " + err.message);
    }

    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function forgotPassword(mail) {
  const targetMail = (mail || "").toLowerCase().trim();
  if (!targetMail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetMail)) {
    throw new Error("Vui lòng nhập địa chỉ Email hợp lệ!");
  }

  const cache = CacheService.getScriptCache();
  const limitKey = "FORGOT_LIMIT_" + targetMail;
  const sentCount = parseInt(cache.get(limitKey) || "0", 10);
  if (sentCount >= 2) {
    throw new Error("Bạn đã yêu cầu cấp lại mật khẩu quá 2 lần. Vui lòng thử lại sau 15 phút!");
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("User_Registry");
    if (!sheet) throw new Error("Hệ thống chưa khởi tạo danh sách tài khoản!");

    const data = sheet.getDataRange().getValues();
    let matchedRow = -1;
    let uName = "";
    let uStatus = "";

    for (let i = 1; i < data.length; i++) {
      if ((data[i][0] || "").toString().toLowerCase().trim() === targetMail) {
        matchedRow = i + 1;
        uName = (data[i][1] || "").toString().toUpperCase().trim();
        uStatus = (data[i][3] || "PENDING").toString().toUpperCase().trim();
        break;
      }
    }

    if (matchedRow === -1) {
      throw new Error("Email này chưa được đăng ký trong hệ thống!");
    }
    if (uStatus !== "ACTIVE") {
      throw new Error("Tài khoản đang chờ phê duyệt hoặc đã bị khóa, không thể cấp lại mật khẩu!");
    }

    const tempPass = generateRandomTempPass_(6);
    const hashed = hashPassword_(tempPass);

    sheet.getRange(matchedRow, 3).setNumberFormat("@").setValue(hashed);
    SpreadsheetApp.flush();

    MailApp.sendEmail({
      to: targetMail,
      subject: "[KEN - BCONS] Cấp lại mật khẩu đăng nhập hệ thống",
      htmlBody: `
        <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.6;">
          <p>Chào <b>${uName}</b>,</p>
          <p>Hệ thống vừa tiếp nhận yêu cầu cấp lại mật khẩu cho tài khoản <b>${targetMail}</b>.</p>
          <p>Mật khẩu đăng nhập mới của bạn là:</p>
          <div style="display:inline-block; padding: 10px 18px; background:#031c35; color:#FFBA08; font-size:18px; font-weight:bold; letter-spacing:2px; border-radius:6px;">${tempPass}</div>
          <p style="font-size:12px; color:#666; margin-top:16px;">Lưu ý: Mật khẩu phân biệt chữ hoa / chữ thường. Nếu không phải bạn yêu cầu, vui lòng liên hệ Admin ngay.</p>
        </div>
      `
    });

    cache.put(limitKey, String(sentCount + 1), 900);
    cache.remove("LOGIN_FAIL_" + targetMail);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * CHUYẾN XE TẢI DỮ LIỆU TỔNG - KHẮC PHỤC TRỄ ĐỒNG BỘ CÔNG THỨC BẢNG X
 */
function getSystemData(token) {
  if (token) {
    try { authenticateAndGetName(token); } catch(e) {}
  }

  // Đã loại bỏ SO HDTCXD BCONS - NTP!B3:V để triệt tiêu thời gian quét hàng nghìn dòng không dùng
  const response = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, {
    ranges: [
      "User_Registry!A2:E",
      "DATABCONS!A3:B",
      "DATAGOITHAU!B12:T",
      "DATAGOITHAU!N3:N",
      "DATANTP!C3:D",
      "X!A4:V"
    ],
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  const valueRanges = response.valueRanges || [];
  const userRegistryData = valueRanges[0]?.values || [];
  const dataBcons = valueRanges[1]?.values || [];
  const dataGoiThau = valueRanges[2]?.values || [];
  const dataWarranty = valueRanges[3]?.values || [];
  const dataNTP = valueRanges[4]?.values || [];
  const dataX = valueRanges[5]?.values || [];

  // 1. LẤY DANH SÁCH USER CHỜ PHÊ DUYỆT (PENDING)
  const pendingUsers = [];
  userRegistryData.forEach(row => {
    const uMail = (row[0] || "").toString().toLowerCase().trim();
    const uName = (row[1] || "").toString().toUpperCase().trim();
    const uStatus = row[3] ? row[3].toString().toUpperCase().trim() : "PENDING";
    if (uMail && uStatus === "PENDING") {
      pendingUsers.push({ mail: uMail, name: uName });
    }
  });

  // 2. LẤY DATA DỰ ÁN CHO HỢP ĐỒNG (TỪ DATABCONS)
  const reversedBcons = [...dataBcons].reverse();
  const projectHD = reversedBcons.map(r => {
    if (!r[0]) return null;
    return {
      display: r[0].toString().trim(),
      searchString: r[1] ? `${r[0]} | ${r[1]}`.trim() : r[0].toString().trim()
    };
  }).filter(i => i && i.display);

  // 3. LẤY DATA GÓI THẦU & BẢO HÀNH
  const packHD = dataGoiThau.filter(r => r[18] && r[18].toString().trim() !== "").map(r => ({
    searchString: r[18].toString().trim(),
    category: r[0] ? r[0].toString().trim() : ""
  }));
  const warrantyHD = dataWarranty.map(r => r[0]).filter(Boolean).map(v => v.toString().trim());

  // 4. LẤY DATA NHÀ THẦU
  const contractorHD = dataNTP.map(r => {
    if (!r[0]) return null;
    return {
      display: r[0].toString().trim(),
      searchString: r[1] ? `${r[1]} | ${r[0]}`.trim() : r[0].toString().trim()
    };
  }).filter(i => i && i.display);

  // 5. LẤY DATA PHỤ LỤC (BẢNG X) - Xử lý an toàn fallback giá trị Cột C hoặc Cột D
  const field0PL = dataX.map(r => {
    const valA = (r[0] || "").toString().trim();
    if (!valA) return null;
    const scanRaw = (r[15] || "").toString().trim();
    let strDate = (r[7] || "").toString().trim();

    // Ưu tiên Cột C (r[2]), nếu rỗng lấy Cột D (r[3])
    const rawValC = (r[2] !== undefined && r[2] !== null) ? r[2].toString().trim() : "";
    const rawValD = (r[3] !== undefined && r[3] !== null) ? r[3].toString().trim() : "";
    const effectiveValue = rawValC !== "" ? rawValC : rawValD;

    return {
      maHD: valA,
      display: `${valA} | ${(r[6] || "").toString().trim()} | ${effectiveValue}`,
      note: (r[1] || "").toString().trim(),
      searchK: (r[10] || "").toString().trim(), 
      dateH: strDate, 
      packageI: (r[1] || "").toString().trim(),
      valueK: effectiveValue,
      searchM: (r[12] || "").toString().trim(),
      transferred: (r[14] || "").toString().trim() !== "",
      scanId: scanRaw, 
      fileName: scanRaw.includes("|") ? scanRaw.split(";;")[0].split("|")[1].trim() : "", 
      c: effectiveValue,
      hasQ: (r[16] || "").toString().trim().toLowerCase() === "x",
      hasR: (r[17] || "").toString().trim().toLowerCase() === "x",
      hasS: (r[18] || "").toString().trim().toLowerCase() === "x"
    };
  }).filter(Boolean);

  return {
    hd: { project: projectHD, pack: packHD, warranty: warrantyHD, contractor: contractorHD },
    pl: { field0: field0PL },
    pendingUsers: pendingUsers, 
    currentUserRole: GLOBAL_STAFF_ROLE ? GLOBAL_STAFF_ROLE.toUpperCase().trim() : "USER"
  };
}


/**
 * ĐỊNH TUYẾN WEB APP API
 */
function doPost(e) {
  if (!e || !e.postData) return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "No post data" })).setMimeType(ContentService.MimeType.JSON);
  
  let request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "JSON Parse error" })).setMimeType(ContentService.MimeType.JSON);
  }

  const { action, data: payload, token } = request;

  const publicActions = [
    "loginUser",
    "registerUser",
    "forgotPassword"
  ];

  if (!publicActions.includes(action)) {
    try {
      authenticateAndGetName(token); 
    } catch (authError) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: authError.message })).setMimeType(ContentService.MimeType.JSON);
    }
  } else {
    if (token) {
      try { authenticateAndGetName(token); } catch (ignored) {}
    }
  }

  const routes = {
    "loginUser": () => loginUser(payload?.mail, payload?.password),
    "registerUser": () => registerUser(payload?.mail, payload?.name, payload?.password),
    "forgotPassword": () => forgotPassword(payload?.mail),
    "batchRequest": () => apiDispatcher(payload),
    "getSystemData": () => getSystemData(),
    "getActiveProjectFolders_Backend": () => getActiveProjectFolders_Backend(),
    "handleFullExportProcess_HD": () => handleFullExportProcess_HD(payload),
    "handleFullExportProcess_TB": () => handleFullExportProcess_TB(payload),
    "writeToSheetAndExportDoc_PL": () => writeToSheetAndExportDoc_PL(payload),
    "updateContractData_PL": () => updateContractData_PL(payload?.[0], payload?.[1], payload?.[2]),
    "updateTransferStatus_PL": () => updateTransferStatus_PL(payload?.[0], payload?.[1], payload?.[2]),
    "exportToNewSpreadsheet_PL": () => exportToNewSpreadsheet_PL(payload),
    "deleteContractRow_Backend": () => deleteContractRow_Backend(payload),
    "uploadScanToDrive": () => uploadScanToDrive(payload?.[0], payload?.[1], payload?.[2]),
    "deleteScanFilePermanently": () => deleteScanFilePermanently(payload?.[0], payload?.[1]),
    "getMindmapData": () => getMindmapData(payload),
    "getTasksByFileId": () => getTasksByFileId(payload),
    "getAllTasksByProject": () => getAllTasksByProject(payload),
    "updateTasksOrderBackend": () => updateTasksOrderBackend(payload?.[0], payload?.[1], payload?.[2]),
    "getFileBase64ForAI": () => getFileBase64ForAI(payload),
    "getDriveFileStreamInfo_Backend": () => getDriveFileStreamInfo_Backend(payload),
    "extractDataOnly": () => extractDataOnly(payload?.[0], payload?.[1], payload?.[2]),
    "extractDataFromImages": () => extractDataFromImages(payload?.[0], payload?.[1]),
    "batchAddTasksBackend": () => batchAddTasksBackend(payload?.[0], payload?.[1], payload?.[2], payload?.[3]),
    "approveUser_InApp": () => approveUser_InApp(payload), 
    "getDrawingUploadSession_Backend": () => getDrawingUploadSession_Backend(payload),
    "renameAndRouteDrawingFile_Backend": () => renameAndRouteDrawingFile_Backend(payload),
    "deleteDrawingFileAndTasks_Backend": () => deleteDrawingFileAndTasks_Backend(payload),
    "syncDrawingsToSheet_Backend": () => syncDrawingsToSheet_Backend(payload),
    "getProjectDrawingFullData": () => getProjectDrawingFullData(payload),
    "rejectUser_InApp": () => rejectUser_InApp(payload),
    // ROUTE ĐIỀU PHỐI CHO BCONS VIEWER
    "getDriveCacheFast": () => getDriveCacheFast(payload?.[0] || payload?.fileId, payload?.[1] || payload?.fileName),
    "saveDriveCacheFast": () => saveDriveCacheFast(payload?.[0] || payload?.fileId, payload?.[1] || payload?.fileName, payload?.[2] || payload?.jsonDataString),
    "callCloudVisionApiBatch": () => callCloudVisionApiBatch(Array.isArray(payload) ? payload : (payload?.images || payload)),
    "getPdfBase64Fast": () => getPdfBase64Fast(Array.isArray(payload) ? payload[0] : (payload?.fileId || payload)),
    "getPdfBase64Chunk": () => getPdfBase64Chunk(payload?.[0] || payload?.fileId, payload?.[1] || payload?.chunkIndex),
    "getDriveAccessToken": () => getDriveAccessToken(),
    "makeFilePublicAndGetLink": () => makeFilePublicAndGetLink(Array.isArray(payload) ? payload[0] : (payload?.fileId || payload)),
    "markScanDigitized_PL": () => markScanDigitized_PL(payload),
    "overwritePdfFile_Backend": () => overwritePdfFile_Backend(payload?.[0], payload?.[1]),
    "getPdfOverwriteSession_Backend": () => getPdfOverwriteSession_Backend(payload?.[0], payload?.[1], payload?.[2]),
  };

  try {
    if (!routes[action]) throw new Error(`Action '${action}' not found in Backend Routing.`);
    const result = routes[action]();
    return ContentService.createTextOutput(JSON.stringify({ status: "success", data: result })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error(`[API ERROR] Action: ${action} | Msg: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.message || error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getCurrentStaffName() {
  return GLOBAL_STAFF_NAME;
}

/**
 * Trả về trạng thái online của Backend
 */
function doGet(e) {
  return HtmlService.createHtmlOutput("<h3>Backend API is Online.</h3>");
}

function apiDispatcher(payload) {
  const results = {};
  for (const key in payload) {
    const request = payload[key];
    const action = request.action;
    const params = request.params || [];
    try {
      switch (action) {
        case 'getSystemData':
          results[key] = getSystemData();
          break;
        case 'getActiveProjectFolders':
          results[key] = getActiveProjectFolders_Backend();
          break;
        case 'getLatestTBNo':
          results[key] = getLatestContractNumber_TB();
          break;
        default:
          results[key] = null;
          break;
      }
    } catch (e) {
      results[key] = { error: e.toString() };
    }
  }
  return results;
}

function keepSystemWarm_Trigger() {
  const now = new Date();
  const day = now.getDay(); // 0: Chủ Nhật, 1-6: Thứ 2 - Thứ 7
  const hour = now.getHours(); // 0 - 23

  // Chỉ chạy từ Thứ 2 đến Thứ 7, khung giờ từ 07:00 đến 20:00
  if (day === 0 || hour < 7 || hour >= 20) {
    return;
  }

  try {
    // Đọc ngầm dải ô để ép Google Sheets tính toán và duy trì V8 warm instance
    getSystemData();
    console.log("[Keep-Warm] Đã làm ấm container và bảng tính lúc: " + now.toLocaleTimeString());
  } catch (e) {
    console.warn("[Keep-Warm Failed]: " + e.message);
  }
}

/**
 * Cấp link tải trực tiếp từ Drive qua Service Account (để PDF.js tải theo dải byte)
 */
function getDriveFileStreamInfo_Backend(fileId) {
  return {
    downloadUrl: "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true",
    token: getServiceAccountReadOnlyToken_()
  };
}