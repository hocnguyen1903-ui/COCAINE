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

/**
 * Xử lý xác thực Token qua kiến trúc 3 tầng (Cache -> Properties -> Sheet User_Registry)
 */
function authenticateAndGetName(token) {
  if (!token) throw new Error("UNAUTHORIZED: Phiên làm việc không tồn tại, vui lòng đăng nhập!");
  
  let targetMail = "";
  if (token.startsWith("BCONS_")) {
    try {
      targetMail = Utilities.newBlob(Utilities.base64Decode(token.replace("BCONS_", ""))).getDataAsString().toLowerCase().trim();
    } catch(e) {
      targetMail = "";
    }
  }

  const cache = CacheService.getScriptCache();
  let cachedVal = cache.get("AUTH_" + token);
  
  if (!cachedVal) {
    try {
      const response = Sheets.Spreadsheets.Values.get(SHEET_ID, "User_Registry!A2:E", {
        valueRenderOption: "UNFORMATTED_VALUE"
      });
      const data = response.values || [];
      for (let i = 0; i < data.length; i++) {
        const rowMail = (data[i][0] || "").toString().toLowerCase().trim();
        const uStatus = (data[i][3] || "").toString().toUpperCase().trim();
        
        if (targetMail && rowMail === targetMail) {
          if (uStatus !== "ACTIVE") {
            throw new Error("UNAUTHORIZED: Tài khoản đã bị khóa hoặc đang chờ phê duyệt!");
          }
          const uName = (data[i][1] || "").toString().toUpperCase().trim();
          const uRole = (data[i][4] || "USER").toString().toUpperCase().trim();
          cachedVal = uName + "|" + uRole;
          cache.put("AUTH_" + token, cachedVal, 21600); // Lưu cache tăng tốc
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
  
  throw new Error("UNAUTHORIZED: Phiên làm việc không hợp lệ, vui lòng đăng nhập lại!");
}

/**
 * Xác thực thông tin đăng nhập từ Sheet "User_Registry" (Lưu Token bền vững vào Cột F)
 */
function loginUser(mail, password) {
  const targetMail = (mail || "").toLowerCase().trim();
  const inputPass = (password || "").toString().trim();
  
  const response = Sheets.Spreadsheets.Values.get(SHEET_ID, "User_Registry!A2:E", {
    valueRenderOption: "UNFORMATTED_VALUE"
  });
  const data = response.values || [];
  
  let matchedName = "";
  let storedPassword = "";
  let status = "PENDING";
  let role = "USER";
  
  for (let i = 0; i < data.length; i++) {
    if ((data[i][0] || "").toString().toLowerCase().trim() === targetMail) {
      matchedName = (data[i][1] || "").toString().toUpperCase().trim();
      storedPassword = (data[i][2] || "").toString().trim();
      status = (data[i][3] || "PENDING").toString().toUpperCase().trim();
      role = (data[i][4] || "USER").toString().toUpperCase().trim();
      break;
    }
  }
  
  if (!matchedName) {
    throw new Error("Email của sếp chưa được đăng ký trong hệ thống!");
  }

  if (inputPass !== storedPassword) {
    throw new Error("Sai mật khẩu đăng nhập hệ thống!");
  }
  
  if (status !== "ACTIVE") {
    throw new Error("Tài khoản đang chờ phê duyệt hoặc đã bị khóa!");
  }
  
  // Token bền vững gắn liền với email người dùng
  const token = "BCONS_" + Utilities.base64Encode(targetMail);
  const tokenValue = matchedName + "|" + role;
  
  CacheService.getScriptCache().put("AUTH_" + token, tokenValue, 21600);
  
  return { success: true, token: token, name: matchedName, role: role };
}


/**
 * Hàm phê duyệt nhanh tài khoản ACTIVE ngay trong Web App
 */
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
      sheet.getRange(i + 1, 4).setValue("ACTIVE"); // Cột D là cột Status
      return true;
    }
  }
  return false;
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
 * XỬ LÝ YÊU CẦU ĐĂNG KÝ TÀI KHOẢN TỪ NHÂN VIÊN (ĐỒNG BỘ REALTIME QUA ABLY)
 */
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
    const cleanPassword = password ? password.toString().trim() : "";

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
    
    const nextRow = sheet.getLastRow() + 1;
    // Ghi từng ô với định dạng text thuần (@) để bảo toàn ký tự số
    sheet.getRange(nextRow, 1, 1, 5).setNumberFormat("@").setValues([[
      targetMail, targetName, cleanPassword, "PENDING", "USER"
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

  // Danh mục thao tác ĐỌC & ĐĂNG NHẬP: Không chặn cửa, không bắt buộc Token
  const publicActions = [
    "getSystemData",
    "loginUser",
    "registerUser",
    "getActiveProjectFolders_Backend",
    "getMindmapData",
    "getTasksByFileId",
    "getAllTasksByProject",
    "getProjectDrawingFullData"
  ];

  if (!publicActions.includes(action)) {
    // Thao tác GHI: Bắt buộc xác thực danh tính để ghi log sổ theo dõi
    try {
      authenticateAndGetName(token); 
    } catch (authError) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: authError.message })).setMimeType(ContentService.MimeType.JSON);
    }
  } else {
    // Thao tác ĐỌC: Gán mềm danh tính nếu có token hợp lệ
    if (token) {
      try { authenticateAndGetName(token); } catch (ignored) {}
    }
  }

  const routes = {
    "loginUser": () => loginUser(payload?.mail, payload?.password),
    "registerUser": () => registerUser(payload?.mail, payload?.name, payload?.password),
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
    "extractDataOnly": () => extractDataOnly(payload?.[0], payload?.[1], payload?.[2]),
    "batchAddTasksBackend": () => batchAddTasksBackend(payload?.[0], payload?.[1], payload?.[2], payload?.[3]),
    "approveUser_InApp": () => approveUser_InApp(payload), 
    "getDrawingUploadSession_Backend": () => getDrawingUploadSession_Backend(payload),
    "renameAndRouteDrawingFile_Backend": () => renameAndRouteDrawingFile_Backend(payload),
    "deleteDrawingFileAndTasks_Backend": () => deleteDrawingFileAndTasks_Backend(payload),
    "syncDrawingsToSheet_Backend": () => syncDrawingsToSheet_Backend(payload),
    "getProjectDrawingFullData": () => getProjectDrawingFullData(payload),
    "rejectUser_InApp": () => rejectUser_InApp(payload)    
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