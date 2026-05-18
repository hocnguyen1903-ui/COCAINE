const SHEET_ID = "1_whNLrEL5x1Kk3Fheq8-AgTE425LnWkvbGVmhXMlL1I";
const SHEET_NAME_TBKQ = "TBKQTT";
const SHEET_NAME_SO_TB = "SO THONG BAO";
const MASTER_FOLDER_ID = '1zStGfH5eitVgbxHF-bhrQGE4NWoKlCpw';
const CONFIG_SHEET_NAME = "WEB_CONFIG";

// --- KHU VỰC CẤU HÌNH HỆ THỐNG ---
const STAFF_CONFIG = {
    "hocnguyen1903@gmail.com": "HỌC",
    "ngocchaulhtst@gmail.com": "CHÂU"
};

/**
 * Hàm lấy tên nhân sự dựa trên Email đang đăng nhập
 */
function getCurrentStaffName() {
    const email = Session.getActiveUser().getEmail();
    return STAFF_CONFIG[email] || email || "UNKNOWN";
}

// =========================================================================
// 1. TẠO KHUNG WEB APP (SINGLE PAGE APPLICATION)
// =========================================================================
// Thay thế đoạn code cũ bằng API Router này
/**
 * GAS - File: Code.js
 * Cập nhật hàm doPost để đăng ký API Metadata
 */
function doPost(e) {
  if (!e || !e.postData) return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "No post data" })).setMimeType(ContentService.MimeType.JSON);
  
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "JSON Parse error" })).setMimeType(ContentService.MimeType.JSON);
  }

  const { action, data: payload } = request;

  // BẢNG ĐỊNH TUYẾN CHUẨN (Khớp 100% với các file API_*.gs của mày)
  const routes = {
    // --- CORE & SYSTEM ---
    "getSystemData": () => getSystemData(),
    "getActiveProjectFolders_Backend": () => getActiveProjectFolders_Backend(),

    // --- HỢP ĐỒNG (HDTCXD) ---
    "handleFullExportProcess_HD": () => handleFullExportProcess_HD(payload),

    // --- THÔNG BÁO KẾT QUẢ (TBKQ) ---
    "handleFullExportProcess_TB": () => handleFullExportProcess_TB(payload),

    // --- PHỤ LỤC & BÀN GIAO (PLHD) ---
    "writeToSheetAndExportDoc_PL": () => writeToSheetAndExportDoc_PL(payload),
    "updateContractData_PL": () => updateContractData_PL(payload[0], payload[1], payload[2]),
    "updateTransferStatus_PL": () => updateTransferStatus_PL(payload[0], payload[1], payload[2]),
    "exportToNewSpreadsheet_PL": () => exportToNewSpreadsheet_PL(payload),
    "deleteContractRow_Backend": () => deleteContractRow_Backend(payload),
    "uploadScanToDrive": () => uploadScanToDrive(payload[0], payload[1], payload[2]),
    "deleteScanFilePermanently": () => deleteScanFilePermanently(payload[0], payload[1]),

    // --- DRAWING & MINDMAP ---
    "getMindmapData": () => getMindmapData(payload),
    "getTasksByFileId": () => getTasksByFileId(payload),
    "getAllTasksByProject": () => getAllTasksByProject(payload),
    "updateTasksOrderBackend": () => updateTasksOrderBackend(payload[0], payload[1], payload[2]),

    // --- AI EXTRACTION ---
    "getFileBase64ForAI": () => getFileBase64ForAI(payload),
    "extractDataOnly": () => extractDataOnly(payload[0], payload[1], payload[2]),
    "batchAddTasksBackend": () => batchAddTasksBackend(payload[0], payload[1], payload[2], payload[3]),

    // 🔥 API METADATA MỚI CỦA MÀY ĐÂY 🔥
    "getMetadataSync": () => getMetadataSync(),
    "processInjection": () => processInjection(payload)
  };

  try {
    if (!routes[action]) throw new Error("Action '" + action + "' not found in Backend Routing.");
    
    // Thực thi hàm tương ứng dựa trên action
    const result = routes[action]();
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success", data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
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

function getMetadataSync() {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
    if (!configSheet) throw new Error("Thiếu sheet WEB_CONFIG");

    const lastRow = configSheet.getLastRow();
    if (lastRow < 2) return { metadata: [], sources: {} };

    // Lấy đúng 12 cột (A-L) tương ứng Index 0-11
    const data = configSheet.getRange(2, 1, lastRow - 1, 12).getValues();
    const metadata = data.map(r => ({
      id: r[3],           // Cột D: Field_ID
      label: r[1],        // Cột B: Label
      placeholder: r[2],  // Cột C: Placeholder
      type: r[4],         // Cột E: Input_Type
      row: r[5],          // Cột F: Row
      width: r[6],        // Cột G: Width
      source: r[7],       // Cột H: Source_Data
      dependsOn: r[8],    // Cột I: Depends_On
      lookupCol: r[9],    // Cột J: Lookup_Col
      targetS: r[10],     // Cột K: Target_Sheet
      targetC: r[11]      // Cột L: Target_Cell
    })).filter(x => x.id); // Bỏ qua dòng trống không có Field_ID

    // Logic lấy Source Data (Giữ nguyên thuật toán $O(K)$)
    const sources = {};
    metadata.forEach(f => {
      if (f.source && f.source.toString().includes("!")) {
        try {
          const range = ss.getRange(f.source);
          sources[f.id] = range.getValues().filter(r => r[0] !== "" && r[0] !== null);
        } catch (e) { 
          console.warn("Lỗi Range: " + f.source);
          sources[f.id] = []; 
        }
      } else if (f.source && f.source.toString().startsWith("[")) {
        try {
          sources[f.id] = JSON.parse(f.source).map(x => [x]);
        } catch (e) { sources[f.id] = []; }
      }
    });

    return { 
      version: ss.getLastUpdated() ? ss.getLastUpdated().getTime() : new Date().getTime(), 
      metadata, 
      sources 
    };
  } catch (err) {
    throw new Error("Backend Error: " + err.message);
  }
}

function processInjection(payload) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  // Đồng bộ Range A2:L để giữ index chuẩn từ 0-11
  const config = ss.getSheetByName(CONFIG_SHEET_NAME).getRange("A2:L").getValues();
  const mapping = {};
  
  // r[3] = Field_ID, r[10] = Target_Sheet, r[11] = Target_Cell
  config.forEach(r => { 
    if(r[3] && r[10] && r[11]) mapping[r[3]] = { s: r[10], c: r[11] }; 
  });

  Object.keys(payload).forEach(id => {
    if (mapping[id]) {
      const target = mapping[id];
      ss.getSheetByName(target.s).getRange(target.c).setValue(payload[id]);
    }
  });
  return { success: true };
}