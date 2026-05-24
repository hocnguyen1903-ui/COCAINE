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
/**
 * Xác thực thông tin đăng nhập và kiểm tra Trạng thái ACTIVE từ Sheet "User_Registry"
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
  let status = "PENDING";
  
  // Duyệt dữ liệu bỏ qua Header dòng 1 (A1: Mail, B1: Name, C1: Status)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
      matchedName = data[i][1]?.toString().toUpperCase().trim();
      status = data[i][2] ? data[i][2].toString().toUpperCase().trim() : "PENDING";
      break;
    }
  }
  
  if (!matchedName) {
    throw new Error("Email của sếp chưa được đăng ký trong hệ thống!");
  }
  
  if (status !== "ACTIVE") {
    throw new Error("Tài khoản đang chờ sếp phê duyệt hoặc đã bị khóa!");
  }
  
  const token = "TOKEN-" + Utilities.getUuid();
  
  // Lưu vĩnh viễn vào bộ nhớ SSD dự án
  PropertiesService.getScriptProperties().setProperty(token, matchedName);
  // Lưu đệm vào RAM 6 tiếng
  CacheService.getScriptCache().put(token, matchedName, 21600);
  
  return { success: true, token: token, name: matchedName };
}

/**
 * Xử lý yêu cầu Đăng ký tài khoản từ Nhân viên (Append PENDING & Gửi Email)
 */
function registerUser(mail, name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName("User_Registry");
  if (!sheet) {
    sheet = ss.insertSheet("User_Registry");
    sheet.appendRow(["Mail", "Name", "Status"]);
  }
  
  const targetMail = mail.toLowerCase().trim();
  const targetName = name.toUpperCase().trim();
  const data = sheet.getDataRange().getValues();
  
  // 1. Kiểm tra trùng lặp Email đăng ký
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]?.toString().toLowerCase().trim() === targetMail) {
      throw new Error("Email này đã được sử dụng hoặc đang trong hàng chờ sếp duyệt!");
    }
  }
  
  // 2. Kiểm tra trùng lặp Tên viết tắt (Name) đăng ký
  for (let i = 1; i < data.length; i++) {
    if (data[i][1]?.toString().toUpperCase().trim() === targetName) {
      throw new Error(`Tên viết tắt "${targetName}" này đã tồn tại! Vui lòng chọn tên viết tắt khác.`);
    }
  }
  
  // Thêm dòng mới trạng thái PENDING
  sheet.appendRow([targetMail, targetName, "PENDING"]);
  
  // Sinh Token phê duyệt bảo mật dùng một lần
  const approvalToken = "APPROVE-" + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(approvalToken, targetMail + "|" + targetName);
  
  // Gửi Mail thông báo cho sếp
  sendApprovalEmail(targetMail, targetName, approvalToken);
  
  return { success: true };
}
/**
 * Gửi Mail thông báo tối giản chỉ gồm thông tin đăng ký và 2 nút bấm
 */
function sendApprovalEmail(userMail, userName, token) {
  const adminMail = "hocnguyen1903@gmail.com"; 
  const webAppUrl = ScriptApp.getService().getUrl();
  
  const approveLink = `${webAppUrl}?action=approve&token=${token}`;
  const rejectLink = `${webAppUrl}?action=reject&token=${token}`;
  
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 400px; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
      <h3 style="margin-top: 0; color: #333; font-size: 15px;">Yêu cầu đăng ký tài khoản mới</h3>
      <p style="margin-bottom: 20px; font-size: 13.5px; color: #555; line-height: 1.5;">
        • Name: <b>${userName}</b><br>
        • Email: <b>${userMail}</b>
      </p>
      <!-- Hộp chứa Flexbox căn đều 2 cột trái phải bằng nhau -->
      <div style="display: flex; gap: 10px;">
        <a href="${approveLink}" target="_blank" style="flex: 1; text-align: center; padding: 8px 0; background: #2ECC71; color: #ffffff; font-weight: bold; font-size: 12px; text-decoration: none; border-radius: 4px;">OK</a>
        <a href="${rejectLink}" target="_blank" style="flex: 1; text-align: center; padding: 8px 0; background: #E74C3C; color: #ffffff; font-weight: bold; font-size: 12px; text-decoration: none; border-radius: 4px;">REJECT</a>
      </div>
    </div>
  `;
  
  MailApp.sendEmail({
    to: adminMail,
    subject: `[KEN_Registration Approval] ${userName}`,
    htmlBody: htmlBody
  });
}

/**
 * Xử lý tương tác Phê duyệt / Từ chối (Trả về Plain Text siêu tốc thay vì dựng HTML)
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action && e.parameter.token) {
    const action = e.parameter.action;
    const token = e.parameter.token;
    const props = PropertiesService.getScriptProperties();
    const rawData = props.getProperty(token);
    
    if (!rawData) {
      return HtmlService.createHtmlOutput(buildAutoClosePage("LỖI LIÊN KẾT", "Yêu cầu đã được phê duyệt trước đó hoặc liên kết không hợp lệ!", false));
    }
    
    const [userMail, userName] = rawData.split("|");
    
    if (action === "approve") {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      const sheet = ss.getSheetByName("User_Registry");
      const data = sheet.getDataRange().getValues();
      let rowUpdated = false;
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]?.toString().toLowerCase().trim() === userMail.toLowerCase().trim()) {
          sheet.getRange(i + 1, 3).setValue("ACTIVE");
          rowUpdated = true;
          break;
        }
      }
      
      props.deleteProperty(token); // Vô hiệu hóa Token một lần dùng
      
      if (rowUpdated) {
        return HtmlService.createHtmlOutput(buildAutoClosePage("PHÊ DUYỆT THÀNH CÔNG", `Tài khoản của <b>${userName}</b> (${userMail}) đã được kích hoạt thành công!`, true));
      }
    } 
    else if (action === "reject") {
      // Xóa yêu cầu PENDING khỏi Sheet
      const ss = SpreadsheetApp.openById(SHEET_ID);
      const sheet = ss.getSheetByName("User_Registry");
      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][0]?.toString().toLowerCase().trim() === userMail.toLowerCase().trim()) {
          sheet.deleteRow(i + 1);
          break;
        }
      }
      props.deleteProperty(token); // Xóa Token
      return HtmlService.createHtmlOutput(buildAutoClosePage("ĐÃ TỪ CHỐI", `Yêu cầu đăng ký của <b>${userName}</b> đã bị từ chối và xóa khỏi hệ thống.`, false));
    }
  }
  return HtmlService.createHtmlOutput("<h3>Backend API is Online.</h3>");
}

/**
 * Trình dựng giao diện cực hạn (Ultra-Lightweight), tối ưu hóa CPU & RAM render tuyệt đối
 */
function buildAutoClosePage(title, desc, isSuccess) {
  const color = isSuccess ? "#2ECC71" : "#E74C3C";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{background:#031c35;color:#E0E0E0;font-family:sans-serif;text-align:center;padding:35vh 20px 0 20px;margin:0}h2{color:${color};font-size:18px;text-transform:uppercase;margin:0 0 10px 0}p{font-size:14px;margin:0}</style></head><body><h2>${title}</h2><p>${desc}</p></body></html>`;
}

/**
 * ĐỒNG BỘ ĐỊNH TUYẾN WEB APP API
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

  // 1. Chạy tiến trình Đăng nhập & Đăng ký (Bỏ qua màng lọc Token)
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
      const res = registerUser(payload.mail, payload.name);
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

