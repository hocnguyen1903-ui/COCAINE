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
    let dept = fNameUpper.includes("STR") ? "STR" : fNameUpper.includes("ARC") ? "ARC" : fNameUpper.includes("MEP") ? "MEP" : "Khác";
    fileArray.push({ fileId: fId, fileName: fName, dateLabel, sortValue, type, branch, dept, url: f.getUrl() });
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

function extractDataOnly(base64, mimeType = "application/pdf", fileType = "UPDATE") {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    
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
    
    // GỌI HÀM BACKOFF THAY VÌ GỌI TRỰC TIẾP URLFETCHAPP
    const options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
    const response = fetchWithBackoff(url, options);
    
    const result = JSON.parse(response.getContentText());
    if (result.error) throw new Error(result.error.message);
    const text = result.candidates[0].content.parts[0].text.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(text);
  } catch (e) { return { error: e.toString() }; }
}

/**
 * Hàm gọi API có bọc lớp giáp Exponential Backoff
 * Time Complexity (Wait): O(2^n) với n là số lần retry.
 */
function fetchWithBackoff(url, options) {
    const maxRetries = 3; 
    const baseDelay = 2000; // Khởi điểm chờ 2 giây
    
    if (!options) options = {};
    options.muteHttpExceptions = true; 

    for (let i = 0; i <= maxRetries; i++) {
        try {
            const response = UrlFetchApp.fetch(url, options);
            const responseCode = response.getResponseCode();
            
            if (responseCode === 200) {
                return response;
            }
            
            if (responseCode === 429 || responseCode >= 500) {
                if (i === maxRetries) {
                    throw new Error("Lỗi API sau " + maxRetries + " lần thử: " + response.getContentText());
                }
                const waitTime = baseDelay * Math.pow(2, i); 
                console.warn(`[AI System] Kẹt Server (Lỗi ${responseCode}). Đang chờ ${waitTime}ms để thử lại lần ${i + 1}...`);
                Utilities.sleep(waitTime);
            } else {
                throw new Error(`Lỗi Logic API ${responseCode}: ` + response.getContentText());
            }
            
        } catch (e) {
            if (i === maxRetries) {
                throw new Error("Đứt kết nối API hoàn toàn: " + e.message);
            }
            const waitTime = baseDelay * Math.pow(2, i);
            console.warn(`[Network] Lỗi kết nối. Đang chờ ${waitTime}ms...`);
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
