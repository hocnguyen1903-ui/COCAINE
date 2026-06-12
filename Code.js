const SHEET_ID = "1y73SqPevgBN7s0_uhUhYQoGD1OXDbDgvHHXbLQD1EH0";
const SHEET_NAME_TBKQ = "TBKQTT";
const SHEET_NAME_SO_TB = "SO THONG BAO";
const MASTER_FOLDER_ID = '1zStGfH5eitVgbxHF-bhrQGE4NWoKlCpw';

// --- ĐỊNH DANH TOÀN CỤC CHO THIẾT BỊ ĐANG GỌI API ---
var GLOBAL_STAFF_NAME = "UNKNOWN";
var GLOBAL_STAFF_ROLE = "USER"; // Mặc định quyền của phiên làm việc là USER

/**
 * Xử lý xác thực Token qua kiến trúc Hybrid (Bóc tách phân quyền Name|Role)
 */
function authenticateAndGetName(token) {
  if (!token) throw new Error("UNAUTHORIZED: Phiên làm việc không tồn tại, vui lòng đăng nhập!");
  
  const cache = CacheService.getScriptCache();
  let cachedVal = cache.get(token);
  
  if (!cachedVal) {
    const props = PropertiesService.getScriptProperties();
    cachedVal = props.getProperty(token);
    if (cachedVal) cache.put(token, cachedVal, 21600);
  }
  
  if (cachedVal && cachedVal.includes("|")) {
    const parts = cachedVal.split("|");
    GLOBAL_STAFF_NAME = parts[0].toUpperCase().trim();
    GLOBAL_STAFF_ROLE = parts[1] ? parts[1].toUpperCase().trim() : "USER"; 
    return GLOBAL_STAFF_NAME;
  }
  
  throw new Error("UNAUTHORIZED: Phiên làm việc đã hết hạn hoặc bị thu hồi, vui lòng đăng nhập lại!");
}

// --- CẤU HÌNH KHÓA TRUYỀN TIN THỜI GIAN THỰC ABLY ---
const ABLY_API_KEY = "GNetjA.Fp7ryA:mZOogyAfJeLjEL-J3WN-893xuKX-_vZvj25jv0AR8RU";

/**
 * Xác thực thông tin đăng nhập từ Sheet "User_Registry"
 */
function loginUser(mail, password) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("User_Registry");
  if (!sheet) throw new Error("Không tìm thấy Sheet danh sách User 'User_Registry'!");
  
  const data = sheet.getDataRange().getValues();
  const targetMail = mail.toLowerCase().trim();
  let matchedName = "";
  let storedPassword = "";
  let status = "PENDING";
  let role = "USER"; 
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
      matchedName = data[i][1]?.toString().toUpperCase().trim();
      storedPassword = data[i][2]?.toString().trim(); // Cột C (Password)
      status = data[i][3] ? data[i][3].toString().toUpperCase().trim() : "PENDING"; // Cột D (Status)
      role = data[i][4] ? data[i][4].toString().toUpperCase().trim() : "USER"; // Cột E (Role)
      break;
    }
  }
  
  if (!matchedName) {
    throw new Error("Email của sếp chưa được đăng ký trong hệ thống!");
  }

  // Xác thực mật khẩu cá nhân của từng user
  if (password !== storedPassword) {
    throw new Error("Sai mật khẩu đăng nhập hệ thống!");
  }
  
  if (status !== "ACTIVE") {
    throw new Error("Tài khoản đang chờ sếp phê duyệt hoặc đã bị khóa!");
  }
  
  const token = "TOKEN-" + Utilities.getUuid();
  const tokenValue = matchedName + "|" + role; 
  
  PropertiesService.getScriptProperties().setProperty(token, tokenValue);
  CacheService.getScriptCache().put(token, tokenValue, 21600);
  
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
    authenticateAndGetName(token); 
  }

  // 1. GHI ĐÈ LỆNH ĐỌC BẢNG X QUA SPREADSHEETAPP ĐỂ ÉP GOOGLE SHTEETS ĐỒNG BỘ CÔNG THỨC LẬP TỨC
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheetX = ss.getSheetByName("X");
  const lastRowX = sheetX.getLastRow();
  const dataX = lastRowX >= 4 ? sheetX.getRange(4, 1, lastRowX - 3, 22).getValues() : [];

  // 2. GỌI BATCH GET TRUY VẤN ĐỒNG THỜI 6 BẢNG STATIC CÒN LẠI ĐỂ TỐI ƯU HÓA TỐC ĐỘ TẢI
  const response = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, {
    ranges: [
      "User_Registry!A2:E",
      "DATABCONS!A3:B",
      "DATAGOITHAU!B12:T",
      "DATAGOITHAU!N3:N",
      "DATANTP!C3:D",
      "SO HDTCXD BCONS - NTP!B3:V"
    ]
  });

  const valueRanges = response.valueRanges || [];
  const userRegistryData = valueRanges[0]?.values || [];
  const dataBcons = valueRanges[1]?.values || [];
  const dataGoiThau = valueRanges[2]?.values || [];
  const dataWarranty = valueRanges[3]?.values || [];
  const dataNTP = valueRanges[4]?.values || [];
  const logData = valueRanges[5]?.values || [];

  // 3. LẤY DANH SÁCH USER CHỜ PHÊ DUYỆT (PENDING)
  const pendingUsers = [];
  userRegistryData.forEach(row => {
    const uMail = (row[0] || "").toString().toLowerCase().trim();
    const uName = (row[1] || "").toString().toUpperCase().trim();
    const uStatus = row[3] ? row[3].toString().toUpperCase().trim() : "PENDING";
    if (uMail && uStatus === "PENDING") {
      pendingUsers.push({ mail: uMail, name: uName });
    }
  });

  // 4. LẤY DATA DỰ ÁN
  const reversedBcons = [...dataBcons].reverse();
  const projectHD = reversedBcons.map(r => {
    if (!r[0]) return null;
    return {
      display: r[0].toString().trim(),
      searchString: r[1] ? `${r[0]} | ${r[1]}`.trim() : r[0].toString().trim()
    };
  }).filter(i => i && i.display);

  // 5. LẤY DATA GÓI THẦU & BẢO HÀNH
  const packHD = dataGoiThau.filter(r => r[18] && r[18].toString().trim() !== "").map(r => ({
    searchString: r[18].toString().trim(),
    category: r[0] ? r[0].toString().trim() : ""
  }));
  const warrantyHD = dataWarranty.map(r => r[0]).filter(Boolean).map(v => v.toString().trim());

  // 6. LẤY DATA NHÀ THẦU
  const contractorHD = dataNTP.map(r => {
    if (!r[0]) return null;
    return {
      display: r[0].toString().trim(),
      searchString: r[1] ? `${r[1]} | ${r[0]}`.trim() : r[0].toString().trim()
    };
  }).filter(i => i && i.display);

  // 7. LẤY DATA PHỤ LỤC (BẢNG X)
  const field0PL = dataX.map(r => {
    const valA = (r[0] || "").toString().trim();
    if (!valA) return null;
    const scanRaw = (r[15] || "").toString().trim();
    let rawDate = r[7];
    let strDate = (rawDate instanceof Date) ? Utilities.formatDate(rawDate, "GMT+7", "dd/MM/yyyy") : (rawDate ? rawDate.toString().trim() : "");

    return {
      maHD: valA,
      display: `${valA} | ${(r[6] || "").toString().trim()} | ${(r[2] || "").toString().trim() || (r[3] || "").toString().trim() || ""}`,
      note: (r[1] || "").toString().trim(),
      searchK: (r[10] || "").toString().trim(), 
      dateH: strDate, 
      packageI: (r[1] || "").toString().trim(),
      valueK: (r[2] || "").toString().trim(),
      searchM: (r[12] || "").toString().trim(),
      transferred: (r[14] || "").toString().trim() !== "",
      scanId: scanRaw, 
      fileName: scanRaw.includes("|") ? scanRaw.split(";;")[0].split("|")[1].trim() : "", 
      c: (r[2] || "").toString().trim(),
      hasQ: (r[16] || "").toString().trim().toLowerCase() === "x",
      hasR: (r[17] || "").toString().trim().toLowerCase() === "x",
      hasS: (r[18] || "").toString().trim().toLowerCase() === "x"
    };
  }).filter(Boolean);

  // 8. LẤY DỮ LIỆU SỔ THEO DÕI
  const transferMap = {};
  logData.forEach(r => {
    const contractNo = (r[2] || "").toString().trim();
    if (contractNo) {
      transferMap[contractNo] = {
        isTransferred: r[13] !== undefined && (r[13] || "").toString().trim() !== "",                                       
        t: (r[18] || "").toString().trim().toLowerCase().startsWith("x"),         
        u: (r[19] || "").toString().trim() !== "" && r[19] != 0,                  
        v: (r[20] || "").toString().trim() !== "" && r[20] != 0                   
      };
    }
  });

  return {
    hd: { project: projectHD, pack: packHD, warranty: warrantyHD, contractor: contractorHD },
    pl: { field0: field0PL },
    transferMap: transferMap,
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
      sheet.appendRow(["Mail", "Name", "Password", "Status", "Role"]);
    }
    
    const targetMail = mail.toLowerCase().trim();
    const targetName = name.toUpperCase().trim();
    const cleanPassword = password ? password.toString().trim() : "";

    if (cleanPassword.length < 4) {
      throw new Error("Mật khẩu đăng ký phải chứa tối thiểu 4 ký tự!");
    }

    const data = sheet.getDataRange().getValues();
    
    // 1. Kiểm tra trùng lặp Email đăng ký
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
        throw new Error("Email này đã được sử dụng!");
      }
    }
    
    // 2. Kiểm tra trùng lặp Tên viết tắt (Name) đăng ký
    for (let i = 1; i < data.length; i++) {
      if (data[i][1]?.toString().toUpperCase().trim() === targetName) {
        throw new Error(`Tên viết tắt "${targetName}" này đã tồn tại! Vui lòng chọn tên viết tắt khác.`);
      }
    }
    
    // Thêm dòng mới trạng thái PENDING, mật khẩu lưu vào Cột C, Status cột D, Role cột E
    sheet.appendRow([targetMail, targetName, cleanPassword, "PENDING", "USER"]);
    
    // 🚀 BẮN TÍN HIỆU THỜI GIAN THỰC SANG ABLY
    try {
      const ablyUrl = "https://rest.ably.io/channels/bcons_notification/messages";
      const ablyPayload = {
        "name": "new_registration",
        "data": { "mail": targetMail, "name": targetName }
      };
      const ablyOptions = {
        "method": "POST",
        "headers": {
          "Authorization": "Basic " + Utilities.base64Encode(ABLY_API_KEY),
          "Content-Type": "application/json"
        },
        "payload": JSON.stringify(ablyPayload),
        "muteHttpExceptions": true
      };
      UrlFetchApp.fetch(ablyUrl, ablyOptions);
    } catch (err) {
      console.error("Lỗi bắn tín hiệu Ably Realtime: " + err.message);
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

  // 🚀 KIỂM TRA BẢO MẬT THẮT CHẶT: Chặn đứng mọi tiến trình ghi ngay tại cửa ngõ nếu Token không hợp lệ
  if (action !== "loginUser" && action !== "registerUser") {
    try {
      authenticateAndGetName(token); 
    } catch (authError) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: authError.message })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === "loginUser") {
    try {
      const res = loginUser(payload.mail, payload.password);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", data: res })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  
  if (action === "registerUser") {
    try {
      const res = registerUser(payload.mail, payload.name, payload.password);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", data: res })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  const routes = {
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
    "rejectUser_InApp": () => rejectUser_InApp(payload)    
  };

  try {
    if (!routes[action]) throw new Error(`Action '${action}' not found in Backend Routing.`);
    const result = routes[action]();
    return ContentService.createTextOutput(JSON.stringify({ status: "success", data: result })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error(`[API ERROR] Action: ${action} | Msg: ${error.message}`);
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
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

