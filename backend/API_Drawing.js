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
 * 1. LẤY DỮ LIỆU MINDMAP TỪ GOOGLE SHEET (Nếu chưa có dữ liệu, tự động quét Drive lần đầu)
 */
function getMindmapData(projectCode) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("Drawing_Log") || ss.insertSheet("Drawing_Log");
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Mã dự án", "File_ID", "File_Name", "Date_Label", "Sort_Value", "Type", "Branch", "Dept", "URL"]);
    }
    
    // Sử dụng getDisplayValues() thay vì getValues() để giữ nguyên định dạng văn bản thuần dd/mm/yyyy của ô ngày tháng
    const data = sheet.getDataRange().getDisplayValues();
    const projectFiles = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString().toUpperCase() === projectCode.toUpperCase()) {
        projectFiles.push({
          fileId: data[i][1],
          fileName: data[i][2],
          dateLabel: data[i][3], // Đảm bảo chuỗi text dạng "dd/mm/yyyy" nguyên bản
          sortValue: parseInt(data[i][4]) || 0,
          type: data[i][5],
          branch: data[i][6],
          dept: data[i][7],
          url: data[i][8]
        });
      }
    }
    
    // Nếu chưa có dữ liệu lưu trên Sheet, tự động đồng bộ từ Drive sang lần đầu tiên
    if (projectFiles.length === 0) {
      return syncDrawingsToSheet_Backend(projectCode);
    }
    
    // Sắp xếp theo tên file để đồng bộ hoàn toàn với thứ tự hiển thị tự nhiên của Drive
    projectFiles.sort((a, b) => a.fileName.localeCompare(b.fileName, 'vi', { numeric: true, sensitivity: 'base' }));
    
    return { projectCode: projectCode, files: projectFiles };
  } catch (e) { 
    throw new Error("Lỗi đọc dữ liệu Bản vẽ từ Sheet: " + e.message); 
  }
}

/**
 * HÀM ĐỒNG BỘ: Quét Drive vật lý và ghi cấu trúc chuẩn hóa vào Sheet Drawing_Log
 */
function syncDrawingsToSheet_Backend(projectCode) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    
    // 🚀 BẢO VỆ CHỐNG TRỄ PHÂN TÁN: Dừng nghỉ 1.2s để máy chủ Drive kịp lập chỉ mục file vừa upload
    Utilities.sleep(1200);
    
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("Drawing_Log") || ss.insertSheet("Drawing_Log");
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Mã dự án", "File_ID", "File_Name", "Date_Label", "Sort_Value", "Type", "Branch", "Dept", "URL"]);
    }
    
    const masterFolder = DriveApp.getFolderById(MASTER_FOLDER_ID);
    const projectFolders = masterFolder.getFoldersByName(projectCode);
    const allFiles = [];
    
    if (projectFolders.hasNext()) {
      const projectFolder = projectFolders.next();
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
    }
    
    // Xóa dữ liệu cũ của dự án này trong Sheet
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0].toString().toUpperCase() === projectCode.toUpperCase()) {
        sheet.deleteRow(i + 1);
      }
    }
    
    // Ghi mảng file vừa quét mới vào Sheet
    if (allFiles.length > 0) {
      allFiles.sort((a, b) => a.fileName.localeCompare(b.fileName, 'vi', { numeric: true, sensitivity: 'base' }));
      const rowsToInsert = allFiles.map(f => [
        projectCode.toUpperCase(),
        f.fileId,
        f.fileName,
        f.dateLabel,
        f.sortValue,
        f.type,
        f.branch,
        f.dept,
        f.url
      ]);
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToInsert.length, 9).setValues(rowsToInsert);
    }
    
    SpreadsheetApp.flush();
    return { projectCode: projectCode, files: allFiles };
  } catch (e) {
    throw new Error("Lỗi đồng bộ cấu trúc Drive sang Sheet: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 6. SỬA TÊN BẢN VẼ VÀ TỰ ĐỘNG TÁI ĐỊNH TUYẾN TRÊN DRIVE & CẬP NHẬT SHEET
 */
function renameAndRouteDrawingFile_Backend(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    
    const fileId = payload.fileId;
    const newFileName = (payload.newFileName || "").normalize("NFC");
    
    const nameWithoutExt = newFileName.replace(/\.(pdf|xlsx|xls)$/i, "").trim();
    if (nameWithoutExt.length > 58) {
      throw new Error("Tên tệp tin vượt quá độ dài quy định (tối đa 58 ký tự)!");
    }

    const file = DriveApp.getFileById(fileId);
    file.setName(newFileName);
    
    const cleanName = removeVietnameseDiacritics(nameWithoutExt);
    const nameParts = cleanName.split("_");
    const rawParts = nameWithoutExt.split("_");
    
    if (nameParts.length >= 3) {
      const projectCode = rawParts[1].trim().toUpperCase();
      let type = "";
      let branch = "";
      
      const cleanPart2 = nameParts[2].trim();
      const isOriginal = /^(bvtktc|tkbvtc|bo mon)$/.test(cleanPart2);
      const isUpdate = /^(cap nhat|update)(\s+.*)?$/.test(cleanPart2);
      const isProposal = /^(pdx|de xuat|proposal)$/.test(cleanPart2);
      
      if (isOriginal) {
        type = "ORIGINAL";
        const hasHầm = cleanName.includes("ham") || cleanName.includes("hầm");
        const hasThân = cleanName.includes("than") || cleanName.includes("thân");
        
        if ((hasHầm && hasThân) || (!hasHầm && !hasThân)) branch = "Chung";
        else if (hasHầm) branch = "Hầm";
        else branch = "Thân";
      } 
      else if (isUpdate) type = "UPDATE";
      else if (isProposal) type = "PROPOSAL";
      
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
          
          if (targetFolder) {
            const parent = file.getParents().next();
            if (parent.getId() !== targetFolder.getId()) {
              file.moveTo(targetFolder);
            }
          }
        }
      }
      
      syncDrawingsToSheet_Backend(projectCode);
    }
    return true;
  } catch (e) {
    throw new Error("Lỗi sửa tên bản vẽ: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * XÓA FILE DRIVE VÀ DỌN SẠCH TASK LIÊN QUAN TRÊN SHEET TASK_LOG & DRAWING_LOG
 */
function deleteDrawingFileAndTasks_Backend(fileId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    
    let projectCode = "";
    try {
      const file = DriveApp.getFileById(fileId);
      const name = file.getName();
      const parts = name.split("_");
      if (parts.length >= 2) {
        projectCode = parts[1].trim().toUpperCase();
      }
      file.setTrashed(true);
    } catch (driveError) {
      console.warn("Không tìm thấy file trên Drive hoặc đã bị xóa trước đó: " + driveError.message);
    }
    
    const ss = SpreadsheetApp.openById(SHEET_ID);
    
    // 1. Dọn dẹp Task_Log
    const taskSheet = ss.getSheetByName("Task_Log");
    if (taskSheet) {
      const data = taskSheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][2] === fileId) {
          taskSheet.deleteRow(i + 1);
        }
      }
    }
    
    // 2. Dọn dẹp Drawing_Log
    const drawSheet = ss.getSheetByName("Drawing_Log");
    if (drawSheet) {
      const data = drawSheet.getDataRange().getValues();
      for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][1] === fileId) {
          drawSheet.deleteRow(i + 1);
        }
      }
    }
    
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    throw new Error("Lỗi xử lý xóa bản vẽ từ máy chủ: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

function scanFilesForMindmap(folder, fileArray, type, branch) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const fId = f.getId(), fName = f.getName(), fNameUpper = fName.toUpperCase();
    let dateLabel = "", sortValue = 0; 
    const dateMatch = fName.match(/^(\d{2})(\d{2})(\d{2})/); 
    if (dateMatch) {
      dateLabel = dateMatch[3] + "-" + dateMatch[2] + "-20" + dateMatch[1]; 
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
    const fileSize = file.getSize();
    
    // Nếu file > 20MB, lập tức báo lỗi để Client chuyển sang luồng tải trực tiếp Stream
    if (fileSize > 20 * 1024 * 1024) {
      return { error: "FILE_TOO_LARGE", size: fileSize };
    }
    
    return Utilities.base64Encode(file.getBlob().getBytes());
  } catch (e) { 
    return { error: e.toString() }; 
  }
}

/**
 * Lõi AI 2 giai đoạn (v2): Cloud Vision OCR (tối đa 6 trang) -> Sắp xếp khối bảng -> Gemini Text-only
 * (Kèm console tracking chi tiết từng mốc thời gian thực thi)
 */
function extractDataFromImages(imagesBase64Array, fileType = "UPDATE") {
  const tTotalStart = new Date().getTime();
  console.log(`[AI Extraction] >>> BẮT ĐẦU TIẾN TRÌNH: Nhận ${imagesBase64Array ? imagesBase64Array.length : 0} trang ảnh (Loại: ${fileType})`);

  try {
    enforceAiGuard_("EXTRACT", imagesBase64Array, 8, 10);

    const visionKey = (PropertiesService.getScriptProperties().getProperty("VISION_API_KEY") || "").trim();
    if (!visionKey) {
      throw new Error("Chưa cấu hình VISION_API_KEY trong Script Properties.");
    }

    // --- BƯỚC 1: CLOUD VISION OCR BATCH ---
    const tVisionStart = new Date().getTime();
    let pageTexts = fetchVisionTextBatch_(imagesBase64Array, visionKey);
    const tVisionDuration = ((new Date().getTime() - tVisionStart) / 1000).toFixed(2);
    console.log(`[AI Extraction] [1/3] Cloud Vision OCR hoàn tất: ${tVisionDuration}s (${pageTexts.length} trang)`);

    // --- CHỐT CHẶN BẢO VỆ: KIỂM CHUẨN TIÊU ĐỀ TRANG 1 TRƯỚC KHI GỌI GEMINI ---
    const page1Raw = pageTexts[0] || "";
    const page1Clean = removeVietnameseDiacritics(page1Raw);

    if (fileType === "UPDATE") {
      const hasDistributionHeader = page1Clean.includes("danh muc phan phoi");
      if (!hasDistributionHeader) {
        console.warn(`[AI Gatekeeper] ⛔ DỪNG TIẾN TRÌNH: Trang 1 không chứa tiêu đề 'Danh mục phân phối...'. Đã hủy gọi Gemini để tránh lãng phí tài nguyên!`);
        return {
          error: "Tệp tin không đúng định dạng: Trang đầu tiên không phải 'Danh mục phân phối...'. Đã dừng trích xuất!"
        };
      }
    } else if (fileType === "PROPOSAL") {
      const hasProposalHeader = page1Clean.includes("phieu de xuat") || page1Clean.includes("de xuat") || page1Clean.includes("pdx");
      if (!hasProposalHeader) {
        console.warn(`[AI Gatekeeper] ⛔ DỪNG TIẾN TRÌNH: Trang 1 không chứa tiêu đề 'Phiếu đề xuất...'. Đã hủy gọi Gemini!`);
        return {
          error: "Tệp tin không đúng định dạng: Trang đầu tiên không phải 'Phiếu đề xuất...'. Đã dừng trích xuất!"
        };
      }
    }

    // --- BỘ LỌC CẮT BỎ ĐÍNH KÈM CHO PHIẾU ĐỀ XUẤT (PĐX) ---
    if (fileType === "PROPOSAL") {
      let proposalEndIdx = -1;
      for (let idx = 0; idx < pageTexts.length; idx++) {
        const norm = removeVietnameseDiacritics(pageTexts[idx]);
        const hasSignatures = (norm.includes("phe duyet") && (norm.includes("giam doc") || norm.includes("ban qlda"))) ||
                              norm.includes("tran trong cam on") ||
                              (norm.includes("tong giam doc") && norm.includes("giam doc"));
        if (hasSignatures) {
          proposalEndIdx = idx;
          console.log(`[AI Gatekeeper] ✍️ Nhận diện khối ký tên PĐX tại Trang ${idx + 1}. Dừng quét và loại bỏ toàn bộ các trang đính kèm/bản vẽ phía sau!`);
          break;
        }
      }

      if (proposalEndIdx !== -1) {
        pageTexts = pageTexts.slice(0, proposalEndIdx + 1);
      }
    }

    const combinedText = pageTexts
      .map((txt, idx) => txt ? `=== TRANG ${idx + 1} ===\n${txt}` : "")
      .filter(Boolean)
      .join("\n\n");

    if (!combinedText.trim()) {
      console.warn(`[AI Extraction] Cảnh báo: Toàn bộ ảnh quét không phát hiện ký tự văn bản.`);
      return { notes: [] };
    }

    // --- BƯỚC 2: BUILD PROMPT CẤU TRÚC ---
    const tPromptStart = new Date().getTime();
    const promptProposal = `Role: Senior Construction Consultant.
Task: Extract distinct requested work scopes or physical items from this Proposal (Phiếu đề xuất - PĐX).

Semantic Extraction Principles:
1. TARGET IDENTIFICATION: Capture the primary operational scopes, physical components, or site activities requested.
   - Check the Subject line ('V/v: ...' or main header), sections ('Nội dung đề xuất', 'Phương án'), or summary tables.
2. HIERARCHICAL DEDUPLICATION (GRANULARITY OVER UMBRELLA):
   - If the text contains both a broad umbrella/parent scope (often from the title or general introduction) AND specific breakdown items (detailed by zone, system type, or sub-scope in breakdown tables/sections):
     + ALWAYS DROP the overarching generic parent item.
     + ONLY EXTRACT the specific child items that contain concrete zones, classifications, or detailed scopes.
     + Never output both a broad summary header and the detailed items it encompasses.
3. VERB FILTERING (CRITICAL):
   - STRIP purely administrative filler verbs: 'đề xuất', 'kính trình', 'xin phê duyệt', 'nhằm phục vụ', 'triển khai', 'báo cáo', 'kính gửi', 'cung cấp', 'thực hiện'.
   - PRESERVE technical/operational action verbs that define the actual site scope: 'vận hành', 'tháo dỡ', 'di dời', 'gia cố', 'gia công', 'lắp đặt', 'thay thế', 'thí nghiệm', 'kiểm định', 'sơn', 'hoàn thiện', 'thuê'.
4. LOCATION & SCOPE HANDLING:
   - If specific zones/floors/units/types are stated: Append and compress them (e.g., 'Tầng'='T', 'Hầm'='H', 'Mái'='MÁI', 'đến'='-'). Example: 'từ Hầm 1 đến Tầng 5' -> 'H1-T5'.
   - If the scope is project-wide or general: Output the clean scope without forcing floor abbreviations.
5. CONDENSATION: 2 to 9 words per item. Strip wordy prepositions (tại, ở, vị trí khu vực). No duplicate items.
6. DEPARTMENT (dept):
   - Mechanical, electrical, plumbing, equipment/machinery operations, temporary utilities -> 'MEP'.
   - Civil, structural, architectural finishes, doors, painting, landscape, earthworks, temporary civil structures -> 'XD'.
7. EXCLUSIONS:
   - Ignore contract references, company headers, signatures, routing slips, dates, and cost/manpower/schedule table headers (e.g., 'nhân công', 'thời gian', 'ghi chú').

Format: Strict JSON only.
{"notes":[{"note": "Action/Item + Zone/Type (if any)", "dept": "XD/MEP"}]}

OCR TEXT INPUT:
${combinedText}`;

    const promptOriginalUpdate = `Role: Senior Construction Data Architect.
Task: From the OCR text below (pages separated by "=== TRANG X ===", table cells separated by " | "), extract a consolidated list of "Target Construction Categories".

Data Source Anchoring (Flexible Table Matching):
1. PRIMARY SOURCES:
   - Table 1 (Thành phần hồ sơ): Extract from column 'Diễn giải' or 'Tên hồ sơ/bản vẽ'.
   - Table 2 (Danh mục thay đổi / danh mục bản vẽ): Synthesize from:
     + The Component Column (named 'Hạng mục thay đổi', 'Tên bản vẽ', 'Hạng mục', or similar).
     + The Scope/Detail Column (named 'Nội dung thay đổi', 'Diễn giải', 'Chi tiết', or similar).
2. EXCLUSIONS (MANDATORY):
   - STRICTLY EXCLUDE procurement/document nouns: 'vật tư', 'vật liệu', 'mẫu vật liệu', 'mẫu vật tư', 'danh mục vật tư', 'bảng kê', 'thiết bị', 'phụ kiện', 'bìa', 'ghi chú'.
   - IGNORE drawing/sheet codes entirely (e.g., 'BCT2.RFA.SD.NK.00', 'KT13-01', 'N-HD-200E', 'Đ-EL-200', 'KC-01').
   - IGNORE administrative columns: "Stt", "Lý do", "Trách nhiệm", "Mục đích", signatures, dates, and approvals.

Core Definition:
A "Target Construction Category" MUST be a tangible, physical component or functional system installed on-site (the "WHAT").

Generative & Normalization Rules:
1. STRIP DRAWING PREFIXES: Automatically drop all drawing-type prefixes and document words:
   - 'mặt bằng', 'mặt đứng', 'mặt cắt', 'chi tiết', 'định vị', 'bố trí', 'sơ đồ', 'tổng thể', 'bản vẽ', 'danh mục', 'hồ sơ', 'bìa', 'thống kê'.
   - Drop generic verbs: 'thay đổi', 'cập nhật', 'điều chỉnh', 'bổ sung', 'bỏ', 'vạt'.
   - Example: 'Mặt bằng hoàn thiện đường bộ' -> 'Hoàn thiện đường bộ'
   - Example: 'Mặt bằng định vị kicker sân vườn' -> 'Kicker sân vườn'
2. PARENT FAMILY GROUPING (ABSTRACTION): Group specific sub-instances or item codes into their parent architectural/structural family:
   - Door/Glass instances [Vách kính VK1, Chi tiết VK2, Cửa đi C1] -> 'Cửa và vách kính' (hoặc 'Vách kính').
   - Landscape instances [Cây lớn, Cây bụi, Thảm cỏ] -> 'Cây lớn, cây bụi và thảm'.
   - Civil/Structural instances [Kicker K1, Kicker K2] -> 'Kicker sân vườn'.
3. STANDARDIZED NAMING:
   - Civil / Architectural / Landscape (XD): Output the direct concise category name (2-6 words).
   - MEP / Fire Safety (MEP/PCCC): MUST start with prefix 'Hệ thống ' followed by function (e.g., 'Hệ thống thoát nước mưa', 'Hệ thống chiếu sáng', 'Hệ thống thông gió').
4. OUTPUT RESTRICTIONS: Vietnamese language, NO duplicate categories, 'XD' items listed first, then 'MEP'.

Format: Strict JSON only.
{"notes":[{"note": "Target Category Name", "dept": "XD/MEP"}]}

OCR TEXT INPUT:
${combinedText}`;

    const finalPrompt = (fileType === "PROPOSAL") ? promptProposal : promptOriginalUpdate;
    const payload = {
      "contents": [{ "parts": [{ "text": finalPrompt }] }],
      "generationConfig": {
        "response_mime_type": "application/json",
        "temperature": 0.1,
        "thinkingConfig": {
          "thinkingBudget": 0
        }
      }
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    // Chuỗi model ưu tiên phản hồi siêu tốc (< 2s), tắt reasoning ngầm
    const modelChain = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-3.7-flash",
      "gemini-2.5-pro"
    ];
    console.log(`[AI Extraction] [2/3] Dựng Prompt ngữ cảnh xong: ${new Date().getTime() - tPromptStart}ms`);

    // --- BƯỚC 3: GEMINI TEXT-ONLY PARSING ---
    const tGeminiStart = new Date().getTime();
    const responseText = fetchWithRobustFallback(payload, options, modelChain);
    const tGeminiDuration = ((new Date().getTime() - tGeminiStart) / 1000).toFixed(2);

    const cleanText = responseText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsedData = JSON.parse(cleanText);
    const countItems = (parsedData.notes && Array.isArray(parsedData.notes)) ? parsedData.notes.length : 0;

    const tTotalDuration = ((new Date().getTime() - tTotalStart) / 1000).toFixed(2);
    console.log(`[AI Extraction] [3/3] Gemini phân tích hoàn tất: ${tGeminiDuration}s | Bóc tách được: ${countItems} hạng mục`);
    console.log(`[AI Extraction] <<< TỔNG THỜI GIAN BACKEND: ${tTotalDuration}s (Vision: ${tVisionDuration}s + Gemini: ${tGeminiDuration}s)`);

    return parsedData;
  } catch (e) {
    console.error(`[AI Extraction Error] Thất bại sau ${((new Date().getTime() - tTotalStart) / 1000).toFixed(2)}s: ${e.message}`);
    return { error: e.toString() };
  }
}

function fetchVisionTextBatch_(imagesBase64Array, apiKey) {
  const url = "https://vision.googleapis.com/v1/images:annotate?key=" + apiKey;
  const MAX_VISION_BATCH = 16;
  let allResponses = [];

  for (let i = 0; i < imagesBase64Array.length; i += MAX_VISION_BATCH) {
    const slice = imagesBase64Array.slice(i, i + MAX_VISION_BATCH);
    const requests = slice.map(b64 => ({
      image: { content: String(b64).replace(/^data:image\/\w+;base64,/, "") },
      features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      imageContext: { languageHints: ["vi", "en"] }
    }));

    const res = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ requests: requests }),
      muteHttpExceptions: true
    });

    const resJson = JSON.parse(res.getContentText());
    if (resJson.error) {
      throw new Error("Vision API Error: " + resJson.error.message);
    }
    if (resJson.responses) {
      allResponses = allResponses.concat(resJson.responses);
    }
  }

  return allResponses.map(resp => extractStructuredPageText_(resp));
}

function extractStructuredPageText_(resp) {
  if (!resp || !resp.fullTextAnnotation || !resp.fullTextAnnotation.pages || !resp.fullTextAnnotation.pages.length) {
    return "";
  }

  const pObj = resp.fullTextAnnotation.pages[0];
  const imgW = pObj.width || 0;
  const imgH = pObj.height || 0;

  let angle0 = 0, angle90 = 0, angle180 = 0, angle270 = 0;
  (pObj.blocks || []).forEach(b => {
    (b.paragraphs || []).forEach(p => {
      (p.words || []).forEach(w => {
        const v = (w.boundingBox && w.boundingBox.vertices) || [];
        if (v.length >= 2 && v[0] && v[1]) {
          const dx = (v[1].x || 0) - (v[0].x || 0);
          const dy = (v[1].y || 0) - (v[0].y || 0);
          if (Math.abs(dx) >= Math.abs(dy)) {
            if (dx >= 0) angle0++; else angle180++;
          } else {
            if (dy > 0) angle90++; else angle270++;
          }
        }
      });
    });
  });

  let pdfRotation = 0;
  const maxVotes = Math.max(angle0, angle90, angle180, angle270);
  if (maxVotes > 0) {
    if (maxVotes === angle90) pdfRotation = 270;
    else if (maxVotes === angle270) pdfRotation = 90;
    else if (maxVotes === angle180) pdfRotation = 180;
  }

  const blockItems = [];
  (pObj.blocks || []).forEach(b => {
    const paraTexts = [];
    (b.paragraphs || []).forEach(p => {
      let lineBuf = "";
      (p.words || []).forEach(w => {
        const syms = w.symbols || [];
        let wordStr = "";
        let lastBreak = "";
        for (let s = 0; s < syms.length; s++) {
          wordStr += syms[s].text || "";
          if (s === syms.length - 1 && syms[s].property && syms[s].property.detectedBreak) {
            lastBreak = syms[s].property.detectedBreak.type || "";
          }
        }
        lineBuf += wordStr;
        if (lastBreak === "EOL_SURE_SPACE" || lastBreak === "LINE_BREAK") {
          lineBuf += "\n";
        } else if (lastBreak !== "HYPHEN") {
          lineBuf += " ";
        }
      });
      const cleanPara = lineBuf.replace(/[ \t]+\n/g, "\n").trim();
      if (cleanPara) paraTexts.push(cleanPara);
    });

    const blockText = paraTexts.join("\n").trim();
    if (!blockText) return;

    const bv = (b.boundingBox && b.boundingBox.vertices) || [];
    let minX = null, minY = null, maxX = null, maxY = null;
    for (let i = 0; i < bv.length; i++) {
      const vx = bv[i].x || 0;
      const vy = bv[i].y || 0;
      if (minX === null || vx < minX) minX = vx;
      if (minY === null || vy < minY) minY = vy;
      if (maxX === null || vx > maxX) maxX = vx;
      if (maxY === null || vy > maxY) maxY = vy;
    }

    let bx = minX || 0, by = minY || 0;
    const bw = Math.max(1, (maxX || 0) - bx);
    const bh = Math.max(1, (maxY || 0) - by);

    if (pdfRotation === 270) {
      const nx = by;
      const ny = Math.max(0, imgW - (bx + bw));
      bx = nx; by = ny;
    } else if (pdfRotation === 90) {
      const nx = Math.max(0, imgH - (by + bh));
      const ny = bx;
      bx = nx; by = ny;
    } else if (pdfRotation === 180) {
      bx = Math.max(0, imgW - (bx + bw));
      by = Math.max(0, imgH - (by + bh));
    }

    blockItems.push({ bx, by, text: blockText });
  });

  if (blockItems.length === 0) return "";
  blockItems.sort((a, b) => (a.by - b.by) || (a.bx - b.bx));

  const rows = [];
  let currentRow = [blockItems[0]];
  let anchorY = blockItems[0].by;

  for (let i = 1; i < blockItems.length; i++) {
    const item = blockItems[i];
    if (Math.abs(item.by - anchorY) <= 24) {
      currentRow.push(item);
    } else {
      rows.push(currentRow);
      currentRow = [item];
      anchorY = item.by;
    }
  }
  rows.push(currentRow);

  return rows.map(row => {
    row.sort((a, b) => a.bx - b.bx);
    return row.map(cell => cell.text).join(" | ");
  }).join("\n");
}

/**
 * Điều phối gọi API: Tự động trượt model khi gặp bất kỳ mã lỗi nào
 */
function fetchWithRobustFallback(payloadBody, options, modelChain) {
    const maxRetries = 3; 
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
            
            // Trượt model ngay lập tức nếu gặp bất kỳ lỗi gì (kể cả 400, 404, 429, 500)
            if (currentModelIndex < modelChain.length - 1) {
                currentModelIndex++;
                console.warn(`[AI System] Lỗi ${responseCode}. Chuyển sang model: ${modelChain[currentModelIndex]}`);
                continue;
            }
            
            if (i === maxRetries) throw new Error(`Lỗi API ${responseCode}: ` + responseText);
            Utilities.sleep(1500);
            
        } catch (e) {
            if (currentModelIndex < modelChain.length - 1) {
                currentModelIndex++;
                continue;
            }
            if (i === maxRetries) throw new Error("Đứt kết nối AI hoàn toàn: " + e.message);
            Utilities.sleep(1500);
        }
    }
}

function getActiveProjectFolders_Backend() {
  try {
    const response = Sheets.Spreadsheets.Values.get(SHEET_ID, "Drawing_Log!A2:A");
    const rows = response.values || [];
    const projectSet = new Set();
    
    for (let j = 0; j < rows.length; j++) {
      const code = rows[j][0] ? rows[j][0].toString().toUpperCase().trim() : "";
      if (code) projectSet.add(code);
    }
    
    return Array.from(projectSet).sort();
  } catch (e) { 
    console.error("Lỗi lấy danh sách dự án từ Drawing_Log: " + e.message);
    return []; 
  } 
}

/**
 * 4. KHỞI TẠO PHIÊN TẢI FILE PHÂN MẢNH VỚI GOOGLE DRIVE (CHỐNG TRỄ PHÂN TÁN 1.5s)
 */
function getDrawingUploadSession_Backend(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    
    const fileName = (payload.fileName || "").normalize("NFC");
    const fileSize = payload.fileSize;
    
    const nameWithoutExt = fileName.replace(/\.(pdf|xlsx|xls)$/i, "").trim();
    if (nameWithoutExt.length > 58) {
      throw new Error("Tên tệp tin vượt quá độ dài quy định (tối đa 58 ký tự)!");
    }

    const cleanName = removeVietnameseDiacritics(nameWithoutExt);
    const nameParts = cleanName.split("_");
    const rawParts = nameWithoutExt.split("_");
    
    if (nameParts.length < 3) {
      throw new Error("Tên tệp không đúng định dạng chuẩn! Cú pháp chuẩn: [YYMMDD]_[MÃ_DỰ_ÁN]_[TẢI_LÊN]_[NỘI_DUNG].pdf");
    }
    
    const projectCode = rawParts[1].trim().toUpperCase();
    let type = "";
    let branch = "";
    
    const cleanPart2 = nameParts[2].trim();
    const isOriginal = /^(bvtktc|tkbvtc|bo mon)$/.test(cleanPart2);
    const isUpdate = /^(cap nhat|update)(\s+.*)?$/.test(cleanPart2);
    const isProposal = /^(pdx|de xuat|proposal)$/.test(cleanPart2);
    
    if (isOriginal) {
      type = "ORIGINAL";
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
    else if (isUpdate) type = "UPDATE";
    else if (isProposal) type = "PROPOSAL";
    else throw new Error("Không thể nhận diện loại bản vẽ! Từ khóa phân loại (phần thứ 3 sau dấu '_') không đúng: phải là 'BVTKTC', 'Cập nhật', hoặc 'PĐX'.");
    
    const masterFolder = DriveApp.getFolderById(MASTER_FOLDER_ID);
    const projectFolders = masterFolder.getFoldersByName(projectCode);
    let projFolder = null;
    let isNewlyCreated = false;
    
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
 * TRUY VẤN SIÊU TỐC: Đọc đồng thời Drawing_Log và Task_Log bằng Google Sheets REST API v4
 */
function getProjectDrawingFullData(projectCode) {
  try {
    const cleanCode = (projectCode || "").toString().toUpperCase().trim();
    
    // Đọc đồng thời 2 bảng Drawing_Log và Task_Log trong 1 lệnh duy nhất
    const response = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, {
      ranges: ["Drawing_Log!A2:I", "Task_Log!A2:E"],
      valueRenderOption: "FORMATTED_VALUE"
    });
    
    const valueRanges = response.valueRanges || [];
    const drawingRows = valueRanges[0]?.values || [];
    const taskRows = valueRanges[1]?.values || [];
    
    const projectFiles = [];
    for (let i = 0; i < drawingRows.length; i++) {
      const r = drawingRows[i];
      if ((r[0] || "").toString().toUpperCase().trim() === cleanCode) {
        projectFiles.push({
          fileId: r[1] || "",
          fileName: r[2] || "",
          dateLabel: r[3] || "",
          sortValue: parseInt(r[4]) || 0,
          type: r[5] || "",
          branch: r[6] || "",
          dept: r[7] || "",
          url: r[8] || ""
        });
      }
    }
    
    // Nếu chưa có file nào trong Sheet cho dự án này -> Tự động quét Drive lần đầu
    if (projectFiles.length === 0) {
      const syncResult = syncDrawingsToSheet_Backend(cleanCode);
      return {
        files: syncResult.files,
        tasks: getAllTasksByProject(cleanCode)
      };
    }
    
    projectFiles.sort((a, b) => (a.fileName || "").localeCompare(b.fileName || "", 'vi', { numeric: true, sensitivity: 'base' }));
    
    const projectTasks = [];
    for (let j = 0; j < taskRows.length; j++) {
      const tr = taskRows[j];
      if ((tr[0] || "").toString().toUpperCase().trim() === cleanCode) {
        projectTasks.push({
          taskId: tr[1] || "",
          fileId: tr[2] || "",
          description: tr[3] || "",
          team: tr[4] || "XD"
        });
      }
    }
    
    return {
      files: projectFiles,
      tasks: projectTasks
    };
  } catch (e) {
    throw new Error("Lỗi tải dữ liệu Bản vẽ & Task: " + e.message);
  }
}

function enforceAiGuard_(actionKey, imagesArray, maxImages, maxPerMinute) {
  if (!Array.isArray(imagesArray) || imagesArray.length === 0) {
    throw new Error("Dữ liệu ảnh đầu vào không hợp lệ.");
  }
  if (imagesArray.length > maxImages) {
    throw new Error(`Vượt giới hạn số trang cho phép (tối đa ${maxImages} trang/lần).`);
  }
  const staff = (typeof GLOBAL_STAFF_NAME === "string" && GLOBAL_STAFF_NAME) ? GLOBAL_STAFF_NAME : "UNKNOWN";
  if (staff === "UNKNOWN") {
    throw new Error("UNAUTHORIZED: Yêu cầu xác thực người dùng trước khi gọi AI.");
  }
  const cache = CacheService.getScriptCache();
  const rateKey = `AI_RATE_${actionKey}_${staff}`;
  const curCount = parseInt(cache.get(rateKey) || "0", 10);
  if (curCount >= maxPerMinute) {
    throw new Error(`Bạn đã vượt giới hạn tần suất AI (${maxPerMinute} lượt/phút). Vui lòng đợi 1 phút.`);
  }
  cache.put(rateKey, String(curCount + 1), 60);
}