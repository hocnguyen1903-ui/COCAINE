const SHEET_ID = "1y73SqPevgBN7s0_uhUhYQoGD1OXDbDgvHHXbLQD1EH0";
const SHEET_NAME_TBKQ = "TBKQTT";
const SHEET_NAME_SO_TB = "SO THONG BAO";
const MASTER_FOLDER_ID = '1zStGfH5eitVgbxHF-bhrQGE4NWoKlCpw';

// --- ĐỊNH DANH TOÀN CỤC CHO THIẾT BỊ ĐANG GỌI API ---
var GLOBAL_STAFF_NAME = "UNKNOWN";

/**
 * Hàm lấy tên nhân sự cho các file xử lý logic dùng chung (API_PhuLuc, API_HopDong)
 */
function getCurrentStaffName() {
  return GLOBAL_STAFF_NAME;
}

/**
 * Xử lý xác thực Token qua kiến trúc Hybrid (RAM Cache -> SSD Properties)
 */
function authenticateAndGetName(token) {
  if (!token) return "UNKNOWN";
  
  // Lớp 1: Kiểm tra RAM (CacheService - ~3ms)
  const cache = CacheService.getScriptCache();
  const cachedName = cache.get(token);
  if (cachedName) return cachedName;

  // Lớp 2: Kiểm tra SSD (PropertiesService - ~30ms)
  const props = PropertiesService.getScriptProperties();
  const propName = props.getProperty(token);
  if (propName) {
    // Nạp ngược lại RAM cho các request tiếp theo
    cache.put(token, propName, 21600);
    return propName;
  }
  return "UNKNOWN";
}

/**
 * Xác thực thông tin đăng nhập từ Sheet "User_Registry"
 */
function loginUser(mail, password) {
  if (password !== "1234") {
    throw new Error("Sai mật khẩu đăng nhập hệ thống!");
  }
  
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName("User_Registry");
  if (!sheet) throw new Error("Không tìm thấy Sheet danh sách User 'User_Registry'!");
  
  const data = sheet.getDataRange().getValues();
  const targetMail = mail.toLowerCase().trim();
  let matchedName = "";
  
  // Duyệt dữ liệu bỏ qua Header dòng 1 (A1: Mail, B1: Name)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
      matchedName = data[i][1]?.toString().toUpperCase().trim();
      break;
    }
  }
  
  if (!matchedName) {
    throw new Error("Email của sếp chưa được đăng ký trong hệ thống!");
  }
  
  const token = "TOKEN-" + Utilities.getUuid();
  
  // Lưu vĩnh viễn vào bộ nhớ SSD dự án
  PropertiesService.getScriptProperties().setProperty(token, matchedName);
  // Lưu đệm vào RAM 6 tiếng
  CacheService.getScriptCache().put(token, matchedName, 21600);
  
  return { success: true, token: token, name: matchedName };
}

/**
 * ĐỊNH TUYẾN WEB APP API (CHẶN BẢO MẬT 403)
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

  // 1. Chạy tiến trình Đăng nhập (Bỏ qua màng lọc Token)
  if (action === "loginUser") {
    try {
      const res = loginUser(payload.mail, payload.password);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", data: res })).setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 2. Màng lọc bảo mật Hybrid xác thực Token cho toàn bộ Request khác
  GLOBAL_STAFF_NAME = authenticateAndGetName(token);
  if (GLOBAL_STAFF_NAME === "UNKNOWN") {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "UNAUTHORIZED: Phiên làm việc hết hạn hoặc không hợp lệ!" })).setMimeType(ContentService.MimeType.JSON);
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
    "batchAddTasksBackend": () => batchAddTasksBackend(payload?.[0], payload?.[1], payload?.[2], payload?.[3])
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

// Hàm bổ trợ bắt buộc phải có để tránh lỗi khi truy cập link trực tiếp
function doGet() {
  return HtmlService.createHtmlOutput("Backend API is Online. Please use Frontend from GitHub.");
}

// =========================================================================
// 2. CHUYẾN XE TẢI DỮ LIỆU TỔNG (ĐÃ NÂNG CẤP LẤY CỘT K ĐỂ SEARCH)
// =========================================================================
function getSystemData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // 1. LẤY DATA DỰ ÁN (Dùng chung cho HD và TBKQ)
  const dataBcons = ss.getSheetByName("DATABCONS").getRange("A3:B").getValues().reverse();
  const projectHD = dataBcons.map(r => ({
    display: r[0].toString().trim(),
    searchString: r[1] ? `${r[0]} | ${r[1]}`.trim() : r[0].toString().trim()
  })).filter(i => i.display);

  // 2. LẤY DATA GÓI THẦU (DATAGOITHAU)
  const sheetGoiThau = ss.getSheetByName("DATAGOITHAU");
  const lastRowGT = sheetGoiThau.getLastRow();
  
  let packHD = []; 
  let warrantyHD = []; 

  if (lastRowGT >= 12) {
    const dataGT = sheetGoiThau.getRange(12, 2, lastRowGT - 11, 19).getValues();
    packHD = dataGT.filter(r => r[18] !== "").map(r => ({
      searchString: r[18].toString().trim(),
      category: r[0].toString().trim()
    }));
    warrantyHD = sheetGoiThau.getRange("N3:N").getValues().flat().filter(String);
  }

  // 3. LẤY DATA NHÀ THẦU (DATANTP)
  const dataNTP = ss.getSheetByName("DATANTP").getRange("C3:D").getValues();
  const contractorHD = dataNTP.map(r => ({
    display: r[0].toString().trim(),
    searchString: r[1] ? `${r[1]} | ${r[0]}`.trim() : r[0].toString().trim()
  })).filter(i => i.display);

  // 4. LẤY DATA PHỤ LỤC (Sheet X) - ĐÃ BỔ SUNG CỘT K
  const sheetX = ss.getSheetByName("X");
  const lastRowX = sheetX.getLastRow();
  let field0PL = [];
  
  if (lastRowX >= 4) {
    // Lấy đến cột V (Index 21) để đảm bảo bao phủ hết các trường Q, R, S
    const dataX = sheetX.getRange(`A4:V${lastRowX}`).getValues(); 
    
    field0PL = dataX.map(r => {
      const valA = r[0]?.toString().trim() || ""; // Cột A: Số HĐ
      if (!valA) return null;

      const scanRaw = r[15]?.toString().trim() || ""; // Cột P: Scan ID
      let rawDate = r[7]; // Cột H: Ngày ký
      let strDate = rawDate instanceof Date ? Utilities.formatDate(rawDate, "GMT+7", "dd/MM/yyyy") : (rawDate?.toString().trim() || "");

      return {
        maHD: valA, // Cột A
        display: `${valA} | ${r[6]?.toString().trim() || ""} | ${r[2]?.toString().trim() || r[3]?.toString().trim() || ""}`,
        note: r[1]?.toString().trim() || "", // Cột B: Tên gói thầu
        
        // 🔥 BỔ SUNG: LẤY DỮ LIỆU CỘT K (Index 10) ĐỂ SEARCH
        searchK: r[10]?.toString().trim() || "", 
        
        dateH: strDate, 
        packageI: r[1]?.toString().trim() || "",
        valueK: r[2]?.toString().trim() || "",
        searchM: r[12]?.toString().trim() || "",
        transferred: r[14]?.toString().trim() !== "", // Cột O: CHUYỂN HS
        scanId: scanRaw, 
        fileName: scanRaw.includes("|") ? scanRaw.split(";;")[0].split("|")[1].trim() : "", 
        c: r[2]?.toString().trim() || "",
        
        // ĐỌC DỮ LIỆU TỪ CỘT Q, R, S (Index 16, 17, 18)
        hasQ: r[16]?.toString().trim().toLowerCase() === "x", // Đề nghị tạm ứng
        hasR: r[17]?.toString().trim().toLowerCase() === "x", // Bảo lãnh tạm ứng
        hasS: r[18]?.toString().trim().toLowerCase() === "x"  // Bảo lãnh HĐ
      };
    }).filter(Boolean);
  }

  // 5. LẤY DỮ LIỆU SỔ THEO DÕI ĐỂ TICK CHUYỂN GIAO UI
  const logSheet = ss.getSheetByName("SO HDTCXD BCONS - NTP");
  const logLastRow = logSheet.getLastRow();
  const transferMap = {};

  if (logLastRow >= 3) {
    const logData = logSheet.getRange(3, 2, logLastRow - 2, 21).getValues(); 
    logData.forEach(r => {
      const contractNo = r[2]?.toString().trim(); // Cột D (index 2 tính từ B)
      if (contractNo) {
        transferMap[contractNo] = {
          isTransferred: r[13] !== "",                                       
          t: r[18]?.toString().trim().toLowerCase().startsWith("x"),         
          u: r[19]?.toString().trim() !== "" && r[19] != 0,                  
          v: r[20]?.toString().trim() !== "" && r[20] != 0                   
        };
      }
    });
  }

  return {
    hd: { project: projectHD, pack: packHD, warranty: warrantyHD, contractor: contractorHD },
    pl: { field0: field0PL },
    transferMap: transferMap 
  };
}

// THÊM VÀO CUỐI FILE Code.gs
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
        // Mày có thể thêm các case khác ở đây nếu muốn gộp thêm
        default:
          results[key] = null;
      }
    } catch (e) {
      results[key] = { error: e.toString() };
    }
  }
  return results;
}

