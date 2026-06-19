function checkAvailableModels() {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Chưa cấu hình GEMINI_API_KEY trong Script Properties.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  
  if (response.getResponseCode() !== 200) {
    console.error("Lỗi API:", response.getContentText());
    return;
  }

  const data = JSON.parse(response.getContentText());
  
  // Lọc lấy các model có hỗ trợ generateContent
  const validModels = data.models.filter(m => 
    m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")
  );

  console.log(`[AI System] Tìm thấy ${validModels.length} model khả dụng cho generateContent:`);
  validModels.forEach(m => {
    // Tên model thực tế dùng cho URL sẽ là chuỗi sau tiền tố 'models/'
    console.log(`=> Tên mã: "${m.name.replace('models/', '')}" | Tên hiển thị: ${m.displayName}`);
  });
}
// MODULE DRAWING: BACKEND - QUÉT DRIVE & AI EXTRACTION (5-COLUMN ENGINE)
// =========================================================================

const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";

/**
 * 1. LẤY DỮ LIỆU MINDMAP TỪ FOLDER DỰ ÁN
 */
function getMindmapData(projectCode) {
  try {
    const masterFolder = DriveApp.getFolderById(MASTER_FOLDER_ID);
    const projectFolders = masterFolder.getFoldersByName(projectCode);
    if (!projectFolders.hasNext()) return { projectCode: projectCode, files: [] };
    
    const projectFolder = projectFolders.next();
    const allFiles = [];
    const subFolders = projectFolder.getFolders();

    while (subFolders.hasNext()) {
      const folder = subFolders.next();
      const folderName = folder.getName().toLowerCase();

      if (folderName.includes("bộ môn") || folderName.includes("bản vẽ 3") || folderName.includes("bvtktc")) {
        const branchFolders = folder.getFolders();
        while (branchFolders.hasNext()) {
          const bFolder = branchFolders.next();
          const bName = bFolder.getName().toLowerCase();
          const branchTag = bName.includes("hầm") ? "Hầm" : "Thân";
          scanFilesForMindmap(bFolder, allFiles, "ORIGINAL", branchTag);
        }
      } 
      else if (folderName.includes("cập nhật") || folderName.includes("update")) {
        scanFilesForMindmap(folder, allFiles, "UPDATE", "");
      }
      else if (folderName.includes("đề xuất") || folderName.includes("proposal")) {
        scanFilesForMindmap(folder, allFiles, "PROPOSAL", "");
      }
    }
    return { projectCode: projectCode, files: allFiles };
  } catch (e) { throw new Error("Drive System Error: " + e.message); }
}

function scanFilesForMindmap(folder, fileArray, type, branch) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const fId = f.getId(), fName = f.getName(), fNameUpper = fName.toUpperCase();
    let dateLabel = "", sortValue = 0; 
    const dateMatch = fName.match(/^(\d{2})(\d{2})(\d{2})/); 
    if (dateMatch) {
      dateLabel = dateMatch[3] + "/" + dateMatch[2] + "/20" + dateMatch[1]; 
      sortValue = parseInt("20" + dateMatch[1] + dateMatch[2] + dateMatch[3]); 
    }
    
    // 🚀 BẢO VỆ BỘ MÔN: Rà soát tên thư mục vật lý chứa file nếu tên file không chứa từ khóa viết tắt
    const folderNameUpper = folder.getName().toUpperCase();
    let dept = fNameUpper.includes("STR") || folderNameUpper.includes("STR") || folderNameUpper.includes("KẾT CẤU") ? "STR" :
               fNameUpper.includes("ARC") || folderNameUpper.includes("ARC") || folderNameUpper.includes("KIẾN TRÚC") ? "ARC" :
               fNameUpper.includes("MEP") || folderNameUpper.includes("MEP") || folderNameUpper.includes("CƠ ĐIỆN") ? "MEP" : "Khác";
    
    let finalBranch = branch;
    
    if (type === "ORIGINAL") {
      // Khử dấu tiếng Việt của tên file để tránh lệch so khớp không dấu
      const cleanName = removeVietnameseDiacritics(fName);
      const hasHầm = cleanName.includes("ham") || cleanName.includes("hầm");
      const hasThân = cleanName.includes("than") || cleanName.includes("thân");
      
      if ((hasHầm && hasThân) || (!hasHầm && !hasThân)) {
        finalBranch = "Chung";
      } else if (hasHầm) {
        finalBranch = "Hầm";
      } else if (hasThân) {
        finalBranch = "Thân";
      }
    }
    
    fileArray.push({ fileId: fId, fileName: fName, dateLabel, sortValue, type, branch: finalBranch, dept, url: f.getUrl() });
  }
}

/**
 * 2. QUẢN LÝ TASK (5 CỘT: Dự án | TaskID | FileID | Nội dung | Bộ môn)
 */
function getTasksByFileId(fileId) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Task_Log");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data.filter(r => r[2] === fileId).map(r => ({ taskId: r[1], description: r[3], team: r[4] }));
}

// HÀM MỚI: Lấy tất cả hạng mục của một dự án để Search
function getAllTasksByProject(projectCode) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Task_Log");
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  return data
    .filter(r => r[0] === projectCode)
    .map(r => ({ taskId: r[1], fileId: r[2], description: r[3], team: r[4] }));
}

function batchAddTasksBackend(projectCode, fileId, tasksArray, isOverwrite = false) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng 20 giây chống xung đột chèn Task_Log hàng loạt
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("Task_Log") || ss.insertSheet("Task_Log");
    if (sheet.getLastRow() === 0) sheet.appendRow(["Mã dự án", "Task_ID", "File_ID", "Description", "Team"]);

    if (isOverwrite) {
      const data = sheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][2] === fileId) sheet.deleteRow(i + 1);
      }
    }

    if (!tasksArray || tasksArray.length === 0) return true;
    const now = new Date().getTime();
    const rowsToInsert = tasksArray.map((t, i) => [projectCode, "T-" + now + "-" + i, fileId, t.note, t.dept]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToInsert.length, 5).setValues(rowsToInsert);
    return true;
  } catch (e) { 
    throw new Error(e.message); 
  } finally {
    lock.releaseLock(); // Giải phóng khóa
  }
}

function updateTasksOrderBackend(projectCode, fileId, orderedTasks) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng 20 giây chống xung đột ghi đè Task_Log
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Task_Log");
    const data = sheet.getDataRange().getValues();
    const header = ["Mã dự án", "Task_ID", "File_ID", "Description", "Team"];
    const otherFiles = data.filter((row, idx) => idx > 0 && row[2] !== fileId);
    const currentFile = orderedTasks.map(t => [projectCode, t.taskId, fileId, t.description, t.team]);
    const final = [header, ...otherFiles, ...currentFile];
    sheet.clearContents();
    sheet.getRange(1, 1, final.length, 5).setValues(final);
    return true;
  } finally {
    lock.releaseLock(); // Giải phóng khóa
  }
}

function editTaskBackend(taskId, newDesc, newTeam) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng tránh xung đột trượt dòng Task_Log khi sửa đổi
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Task_Log");
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      if (data[i][1] === taskId) {
        sheet.getRange(i + 1, 4, 1, 2).setValues([[newDesc, newTeam]]);
        return true;
      }
    }
  } finally {
    lock.releaseLock(); // Giải phóng khóa
  }
}

function deleteTaskBackend(taskId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng tránh xung đột trượt dòng Task_Log khi xóa tác vụ
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Task_Log");
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i][1] === taskId) { sheet.deleteRow(i + 1); return true; }
    }
  } finally {
    lock.releaseLock(); // Giải phóng khóa
  }
}

function addTaskBackend(projectCode, fileId, desc, team) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng tránh tranh chấp dòng ghi khi thêm mới tác vụ bản vẽ
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("Task_Log");
    sheet.appendRow([projectCode, "T-" + new Date().getTime(), fileId, desc, team]);
    return true;
  } finally {
    lock.releaseLock(); // Giải phóng khóa
  }
}

/**
 * 3. AI EXTRACTION ENGINE (PDF OPTIMIZED)
 */
function getFileBase64ForAI(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    return Utilities.base64Encode(file.getBlob().getBytes());
  } catch (e) { return { error: e.toString() }; }
}

/**
 * 3. AI EXTRACTION ENGINE (PDF OPTIMIZED & HIGH AVAILABILITY)
 */
function extractDataOnly(base64, mimeType = "application/pdf", fileType = "UPDATE") {
  try {
    // Nếu file > 20MB (tương đương ~27MB base64), chặn từ đầu để tránh sập RAM
    if (base64.length > 28000000) throw new Error("File quá lớn, vượt giới hạn xử lý an toàn của hệ thống.");

    const promptProposal = `Role: Senior Construction Consultant.
Task: Extract distinct work items AND their exact locations, condensed into concise strings.

Rules:
1. EXTRACTION PATTERN: Identify the [Core Physical Item] + [Specific Location].
2. MULTIPLE LOCATIONS: If an item applies to multiple distinct zones, strictly preserve conjunctions (và, &) or commas to separate them. DO NOT merge independent zones into illogical strings.
3. TARGETED CONDENSATION (PRIORITIZE BREVITY): Aim for the absolute minimum number of words possible. MAXIMUM 13 words per note. Aggressively strip generic action verbs (thi công, lắp đặt) and filler prepositions (tại, khu vực). Shorter is always better.
   - Example Input: "[Verb] [Item X] [Preposition] [Zone A] và [Zone B]"
   - Expected Output: "[Item X] [Zone A] và [Zone B]"
4. FLOOR ABBREVIATION (CRITICAL): Compress floor ranges into extreme abbreviations. 'Tầng' = 'T', 'Hầm' = 'H', 'Mái' = 'MÁI', 'Tum' = 'TUM', 'đến' = '-'. Example Input: 'từ Hầm 2 đến Tầng 8'. Expected Output: 'H2-T8'. Example Input: 'tầng 1 đến tầng tum'. Expected Output: 'T1-TUM'.
5. EXCLUSIONS: Ignore signatures, routing slips, and administrative metadata.
6. OUTPUT: Vietnamese language.
7. FORMAT: JSON only. {"notes":[{"note": "Item + Zone A và Zone B", "dept": "XD/MEP"}]}`;

    const promptOriginalUpdate = `Role: Senior Construction Data Architect.
Task: Extract a consolidated list of "Target Construction Categories" by strictly prioritizing the "Diễn giải" column.

Data Source Anchoring & Prioritization:
1. PRIMARY SOURCE: Scan and extract physical entities primarily from the "Diễn giải" column (typically in Table 1: Thành phần hồ sơ).
2. SECONDARY SOURCE: Use the "Danh mục bản vẽ thiết kế thay đổi" (Table 2) ONLY as a fallback to clarify or identify specific components if the Primary Source is too generic (e.g., if "Diễn giải" only states an abstract scope like "Hồ sơ phần thân", look into Table 2 to extract the actual physical entities like "Cửa, vách kính").
3. EXCLUSIONS: Strictly ignore outer headers, routing slips, signatures, and project scopes.

Core Definition of a Valid Output:
A "Target Construction Category" MUST be a tangible, physical component or a functional system that gets built or installed on-site. It represents the "WHAT" is being built, not the "WHERE" (zones/scopes), the "HOW" (actions), or the "PAPERWORK" (documents/metadata).

Generative Rules:
1. CATEGORY LEVEL ABSTRACTION: Group specific instances into their parent architectural/structural family. 
   - Examples of logic: [Cửa 1, Vách 2, Lan can 3] -> 'Cửa, vách kính và lan can'. [Cây lớn, Thảm cỏ] -> 'Cây lớn và thảm cỏ'. [Kicker K1, Kicker K2] -> 'Kicker sân vườn'.
2. PURE NOUN EXTRACTION: The output must strictly be the noun phrase of the physical entity itself. Automatically drop all verbs (thay đổi, bỏ, vạt, cập nhật) and document types (mặt bằng, định vị, phần thân, hồ sơ).
3. STANDARDIZED NAMING:
   - For Civil/Architecture/Landscape (XD): Output the direct category name (e.g., 'Hoàn thiện đường bộ').
   - For MEP/Fire Safety (MEP/PCCC): The output MUST begin with the prefix 'Hệ thống ' followed by the function (e.g., 'Hệ thống thoát nước mưa').
4. FORMAT: Vietnamese language, 2-7 words per category. NO duplicates.
5. SORTING: 'XD' items FIRST, then 'MEP'.

Output format: Strict JSON only.
{"notes":[{"note": "Target Category Name", "dept": "XD/MEP"}]}`;

    const finalPrompt = (fileType === "PROPOSAL") ? promptProposal : promptOriginalUpdate;
    const payload = {
      "contents": [{ "parts": [{ "text": finalPrompt }, { "inline_data": { "mime_type": mimeType, "data": base64 } }] }],
      "generationConfig": { "response_mime_type": "application/json", "temperature": 0.1 }
    };
    
    const options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
    
    // GỌI HÀM BACKOFF VỚI CHUỖI FALLBACK MODEL (Ưu tiên ổn định, trượt tuần tự)
    const modelChain = [
      "gemini-3.5-flash", // Ưu tiên 1: Tốc độ cao, chi phí thấp thế hệ mới
      "gemini-2.5-flash", // Dự phòng 1: Ổn định
      "gemini-2.0-flash", // Dự phòng 2: Rất nhẹ và ổn định
      "gemini-2.5-pro"    // Chốt chặn cuối: Xử lý sâu nhưng quota thấp
    ];
    const responseText = fetchWithRobustFallback(payload, options, modelChain);
    
    const cleanText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(cleanText);
    
  } catch (e) { 
    return { error: e.toString() }; 
  }
}

/**
 * Lõi gọi API: Đa Fallback Model + Exponential Backoff + Jitter
 * Tối ưu: Tự động trượt qua mảng model nếu gặp lỗi 404 hoặc kẹt server.
 */
function fetchWithRobustFallback(payloadBody, options, modelChain) {
    const maxRetries = 5; // Tăng limit để cover chuỗi model dài
    const baseDelay = 1500; 
    let currentModelIndex = 0;

    for (let i = 0; i <= maxRetries; i++) {
        let currentModel = modelChain[currentModelIndex];
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`;
            const response = UrlFetchApp.fetch(url, options);
            const responseCode = response.getResponseCode();
            const responseText = response.getContentText();
            
            if (responseCode === 200) {
                const result = JSON.parse(responseText);
                if (result.error) throw new Error(result.error.message);
                return result.candidates[0].content.parts[0].text;
            }
            
            if (responseCode === 429 || responseCode >= 500 || responseCode === 404) {
                if (i === maxRetries) throw new Error("Kiệt sức toàn bộ chuỗi Model sau " + maxRetries + " lần thử: " + responseText);
                
                // Trượt Model: Lỗi 404 (chuyển ngay), Lỗi kẹt server (chuyển sau lần thử 1)
                if (responseCode === 404 || i >= 1) {
                    if (currentModelIndex < modelChain.length - 1) {
                        currentModelIndex++;
                        console.warn(`[AI System] Cảnh báo model ${currentModel} (Mã lỗi ${responseCode}). Chuyển sang: ${modelChain[currentModelIndex]}`);
                        if (responseCode === 404) continue; // 404 không cần chờ, gọi ngay model tiếp theo
                    }
                }

                const exponentialWait = baseDelay * Math.pow(2, i); 
                const jitterWait = Math.floor(Math.random() * (exponentialWait * 0.3));
                const waitTime = exponentialWait + jitterWait;
                
                console.warn(`[AI System] Lỗi Server ${responseCode}. Đang chờ ${waitTime}ms để thử lại...`);
                Utilities.sleep(waitTime);
            } else {
                throw new Error(`Lỗi Logic API ${responseCode}: ` + responseText);
            }
            
        } catch (e) {
            if (i === maxRetries) throw new Error("Đứt kết nối API hoàn toàn: " + e.message);
            const waitTime = baseDelay * Math.pow(2, i) + Math.floor(Math.random() * 1000);
            Utilities.sleep(waitTime);
        }
    }
}

function getActiveProjectFolders_Backend() {
  try {
    const folders = DriveApp.getFolderById(MASTER_FOLDER_ID).getFolders();
    let names = [];
    while (folders.hasNext()) names.push(folders.next().getName().toUpperCase());
    return names;
  } catch (e) { return []; } }

/**
 * 4. KHỞI TẠO PHIÊN TẢI FILE PHÂN MẢNH VỚI GOOGLE DRIVE (CHỐNG TRỄ PHÂN TÁN 1.5s)
 */
function getDrawingUploadSession_Backend(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    
    const fileName = (payload.fileName || "").normalize("NFC");
    const fileSize = payload.fileSize;
    const lowerName = fileName.toLowerCase();
    
    const parts = fileName.split("_");
    if (parts.length < 3) {
      throw new Error("Tên tệp không đúng định dạng chuẩn! Cú pháp chuẩn: [YYMMDD]_[MÃ_DỰ_ÁN]_[TẢI_LÊN]_[NỘI_DUNG].pdf");
    }
    
    const projectCode = parts[1].trim().toUpperCase();
    let type = "";
    let branch = "";
    
    if (lowerName.includes("tkbvtc") || lowerName.includes("bvtktc") || lowerName.includes("bộ môn")) {
      type = "ORIGINAL";
      
      // Khử dấu tiếng Việt tên tệp khi phân tích phiên tải lên
      const cleanName = removeVietnameseDiacritics(fileName);
      const hasHầm = cleanName.includes("ham") || cleanName.includes("hầm");
      const hasThân = cleanName.includes("than") || cleanName.includes("thân");
      
      if ((hasHầm && hasThân) || (!hasHầm && !hasThân)) {
        branch = "Chung";
      } else if (hasHầm) {
        branch = "Hầm";
      } else {
        branch = "Thân";
      }
    }
    else if (lowerName.includes("cập nhật") || lowerName.includes("update")) type = "UPDATE";
    else if (lowerName.includes("pđx") || lowerName.includes("pdx") || lowerName.includes("đề xuất") || lowerName.includes("proposal")) type = "PROPOSAL";
    else throw new Error("Không thể nhận diện loại bản vẽ! Tên file phải chứa từ khóa: 'TKBVTC', 'Cập nhật', hoặc 'PĐX'.");
    
    const masterFolder = DriveApp.getFolderById(MASTER_FOLDER_ID);
    const projectFolders = masterFolder.getFoldersByName(projectCode);
    let projFolder = null;
    let isNewlyCreated = false; // Cờ nhận dạng thư mục mới tạo
    
    if (projectFolders.hasNext()) {
      projFolder = projectFolders.next();
    } else {
      projFolder = masterFolder.createFolder(projectCode);
      isNewlyCreated = true;
      console.log(`[Auto-Project] Created new project: ${projectCode}`);
    }
    
    let targetFolder = null;
    let originalParentFolder = null; 
    
    const subFolders = projFolder.getFolders();
    while (subFolders.hasNext()) {
      const sub = subFolders.next();
      const subName = sub.getName().normalize("NFC").toLowerCase();
      
      if (type === "PROPOSAL" && (subName.includes("đề xuất") || subName.includes("proposal"))) { targetFolder = sub; break; }
      else if (type === "UPDATE" && (subName.includes("cập nhật") || subName.includes("update"))) { targetFolder = sub; break; }
      else if (subName.includes("bộ môn") || subName.includes("bản vẽ 3") || subName.includes("bvtktc")) { originalParentFolder = sub; }
    }
    
    if (!targetFolder) {
      if (type === "PROPOSAL") targetFolder = projFolder.createFolder("Đề xuất");
      else if (type === "UPDATE") targetFolder = projFolder.createFolder("Cập nhật");
      else if (type === "ORIGINAL") {
        if (!originalParentFolder) originalParentFolder = projFolder.createFolder("Bộ môn");
        
        const branchFolders = originalParentFolder.getFolders();
        const targetBranchLower = branch.toLowerCase();
        while (branchFolders.hasNext()) {
          const bSub = branchFolders.next();
          if (bSub.getName().normalize("NFC").toLowerCase().includes(targetBranchLower)) { targetFolder = bSub; break; }
        }
        if (!targetFolder) {
          targetFolder = originalParentFolder.createFolder("Phần " + branch);
          isNewlyCreated = true;
        }
      }
      isNewlyCreated = true;
    }

    // 🚀 BẢO VỆ CHỐNG TRỄ PHÂN TÁN CỦA GOOGLE DRIVE (Propagation Delay Defense)
    // Nếu có bất kỳ thư mục nào vừa được tạo mới tinh, bắt buộc dừng ngủ ngầm 1.5 giây
    // để máy chủ phân tán của Google kịp đồng bộ hóa ID trước khi trả URL về cho trình duyệt upload.
    if (isNewlyCreated) {
      SpreadsheetApp.flush();
      Utilities.sleep(1500);
    }
    
    const targetFolderId = targetFolder.getId();
    const apiURL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable";
    const options = {
      method: 'POST',
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": payload.mimeType || "application/pdf",
        "X-Upload-Content-Length": fileSize.toString()
      },
      payload: JSON.stringify({ name: fileName, parents: [targetFolderId] }),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(apiURL, options);
    if (response.getResponseCode() !== 200) throw new Error("Lỗi API khởi tạo phiên: " + response.getContentText());
    
    const uploadUrl = response.getHeaders()["Location"] || response.getHeaders()["location"];
    if (!uploadUrl) throw new Error("Google API không trả về đường dẫn tải phân mảnh.");
    
    return { success: true, uploadUrl: uploadUrl, projectCode: projectCode, type: type, branch: branch };
    
  } catch (e) { return { success: false, error: e.message }; } 
  finally { lock.releaseLock(); }
}

/**
 * 5. HÀM KHỬ DẤU TIẾNG VIỆT ĐỂ SO KHỚP CHUẨN XÁC TÊN FILE KHÔNG DẤU
 */
function removeVietnameseDiacritics(str) {
  if (!str) return "";
  return str.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Xóa các dấu thanh
            .replace(/đ/g, "d")
            .replace(/Đ/g, "D")
            .toLowerCase()
            .trim();
}

/**
 * 6. SỬA TÊN BẢN VẼ VÀ TỰ ĐỘNG DI CHUYỂN THƯ MỤC NẾU THAY ĐỔI PHÂN NHÁNH
 */
function renameAndRouteDrawingFile_Backend(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng an toàn tránh tranh chấp ghi đè
    
    const fileId = payload.fileId;
    const newFileName = (payload.newFileName || "").normalize("NFC");
    const lowerName = newFileName.toLowerCase();
    
    const file = DriveApp.getFileById(fileId);
    
    // Đổi tên tệp vật lý trên Drive chính chủ
    file.setName(newFileName);
    
    // Phân tích tên tệp mới để tự động dọn dẹp và di chuyển thư mục con phù hợp
    const parts = newFileName.split("_");
    if (parts.length >= 3) {
      const projectCode = parts[1].trim().toUpperCase();
      let type = "";
      let branch = "";
      
      const cleanName = removeVietnameseDiacritics(newFileName);
      const hasHầm = cleanName.includes("ham") || cleanName.includes("hầm");
      const hasThân = cleanName.includes("than") || cleanName.includes("thân");
      
      if (lowerName.includes("tkbvtc") || lowerName.includes("bvtktc") || lowerName.includes("bộ môn")) {
        type = "ORIGINAL";
        if ((hasHầm && hasThân) || (!hasHầm && !hasThân)) branch = "Chung";
        else if (hasHầm) branch = "Hầm";
        else branch = "Thân";
      } 
      else if (lowerName.includes("cập nhật") || lowerName.includes("update")) type = "UPDATE";
      else if (lowerName.includes("pđx") || lowerName.includes("pdx") || lowerName.includes("đề xuất") || lowerName.includes("proposal")) type = "PROPOSAL";
      
      if (type) {
        const masterFolder = DriveApp.getFolderById(MASTER_FOLDER_ID);
        const projectFolders = masterFolder.getFoldersByName(projectCode);
        if (projectFolders.hasNext()) {
          const projFolder = projectFolders.next();
          let targetFolder = null;
          let originalParentFolder = null;
          
          const subFolders = projFolder.getFolders();
          while (subFolders.hasNext()) {
            const sub = subFolders.next();
            const subName = sub.getName().normalize("NFC").toLowerCase();
            
            if (type === "PROPOSAL" && (subName.includes("đề xuất") || subName.includes("proposal"))) { targetFolder = sub; break; }
            else if (type === "UPDATE" && (subName.includes("cập nhật") || subName.includes("update"))) { targetFolder = sub; break; }
            else if (subName.includes("bộ môn") || subName.includes("bản vẽ 3") || subName.includes("bvtktc")) { originalParentFolder = sub; }
          }
          
          if (!targetFolder) {
            if (type === "PROPOSAL") targetFolder = projFolder.createFolder("Đề xuất");
            else if (type === "UPDATE") targetFolder = projFolder.createFolder("Cập nhật");
            else if (type === "ORIGINAL") {
              if (!originalParentFolder) originalParentFolder = projFolder.createFolder("Bộ môn");
              
              const branchFolders = originalParentFolder.getFolders();
              const targetBranchLower = branch.toLowerCase();
              while (branchFolders.hasNext()) {
                const bSub = branchFolders.next();
                if (bSub.getName().normalize("NFC").toLowerCase().includes(targetBranchLower)) { targetFolder = bSub; break; }
              }
              if (!targetFolder) {
                targetFolder = originalParentFolder.createFolder("Phần " + branch);
              }
            }
          }
          
          // Di chuyển file ngầm sang thư mục đích mới tương thích
          if (targetFolder) {
            const parent = file.getParents().next();
            if (parent.getId() !== targetFolder.getId()) {
              file.moveTo(targetFolder); // Di chuyển tệp tin cực kỳ nhanh bằng V8 engine chính chủ
            }
          }
        }
      }
    }
    return true;
  } catch (e) {
    throw new Error("Lỗi sửa tên bản vẽ: " + e.message);
  } finally {
    lock.releaseLock();
  }
}