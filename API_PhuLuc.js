// 4. LOGIC XỬ LÝ PHỤ LỤC (PLHD) & BÀN GIAO HỒ SƠ
// =========================================================================
function updateTransferStatus_PL(contractNumber, isTransferred, docTypes) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheetX = ss.getSheetByName("X");
  const logSheet = ss.getSheetByName("CHUYEN HO SO");
  if (!sheetX || !logSheet) throw new Error("Hệ thống thiếu Sheet X hoặc CHUYEN HO SO");

  const lastRowX = sheetX.getLastRow();
  if (lastRowX < 4) return false;

  const rangeX = sheetX.getRange(4, 1, lastRowX - 3, 15);
  const dataX = rangeX.getValues(); 

  const targetMa = contractNumber.trim();
  let targetIndex = -1;
  let ngayKyStr = "";

  for (let i = 0; i < dataX.length; i++) {
    if (dataX[i][0]?.toString().trim() === targetMa) {
      targetIndex = i;
      let rawDate = dataX[i][7];
      if (rawDate instanceof Date) ngayKyStr = Utilities.formatDate(rawDate, "GMT+7", "dd/MM/yyyy");
      else ngayKyStr = rawDate ? rawDate.toString() : "";
      break;
    }
  }

  if (targetIndex === -1) return false;

  sheetX.getRange(targetIndex + 4, 15).setValue(isTransferred ? "x" : "");

  const lastRowLog = logSheet.getLastRow();
  
  if (isTransferred) {
    const senderName = getCurrentStaffName();
    const now = new Date();
    if (now.getHours() >= 17) now.setDate(now.getDate() + 1);
    if (now.getDay() === 6) now.setDate(now.getDate() + 2); 
    else if (now.getDay() === 0) now.setDate(now.getDate() + 1); 
    
    const timeString = Utilities.formatDate(now, "GMT+7", "dd/MM/yyyy");

    let loaiHoSo = "HỢP ĐỒNG";
    let soHopDongGoc = targetMa;
    let maDuAn = "";

    if (soHopDongGoc.match(/^PL\d{2}\s*-/)) {
      const parts = soHopDongGoc.split(" - ");
      loaiHoSo = parts[0].trim();
      soHopDongGoc = parts.slice(1).join(" - ").trim();
    }
    const projectMatch = soHopDongGoc.match(/-(.*?)\//);
    if (projectMatch && projectMatch[1]) maDuAn = projectMatch[1].trim();

    const newRowData = [["", maDuAn, loaiHoSo, soHopDongGoc, ngayKyStr, senderName, timeString, "", docTypes]];
    
    let nextRow = 4;
    if (lastRowLog >= 4) {
      const existingDValues = logSheet.getRange(1, 4, lastRowLog, 1).getValues();
      for (let i = existingDValues.length - 1; i >= 3; i--) {
        if (existingDValues[i][0].toString().trim() !== "") {
          nextRow = i + 2;
          break;
        }
      }
    }
    logSheet.getRange(nextRow, 1, 1, 9).setValues(newRowData);

  } else {
    if (lastRowLog >= 4) {
      const fullRangeLog = logSheet.getRange(4, 1, lastRowLog - 3, 9);
      const allLogData = fullRangeLog.getValues();
      
      let contractToFind = targetMa;
      if (contractToFind.match(/^PL\d{2}\s*-/)) {
        contractToFind = contractToFind.split(" - ").slice(1).join(" - ").trim();
      }

      let isRemoved = false;
      const filteredLogs = allLogData.filter(row => {
        const valD = row[3]?.toString().trim() || "";
        const loaiC = row[2]?.toString().trim() || "";
        
        const isMatchMa = (valD === contractToFind);
        const isMatchLoai = targetMa.match(/^PL\d{2}\s*-/) ? loaiC.startsWith("PL") : loaiC === "HỢP ĐỒNG";
        
        if (isMatchMa && isMatchLoai && !isRemoved) {
          isRemoved = true; 
          return false;
        }
        return true;
      });

      fullRangeLog.clearContent();
      if (filteredLogs.length > 0) {
        logSheet.getRange(4, 1, filteredLogs.length, 9).setValues(filteredLogs);
      }
    }
  }
  return true;
}

// --- 4.2 XUẤT FILE DOCS PHỤ LỤC ---
function generateFileName_PL(field8) {
  if (!field8) return "BDH_PLXX_XXX_TEN GOI THAU_XXX";
  const parts = field8.split(" - ");
  const annexNumber = parts[0]?.trim() || "PLXX"; 
  const contractPart = parts[1]?.trim() || "160/2025/HĐTCXD-BDH/BCONS-TĐT"; 
  const contractNumber = (contractPart.match(/^([^/]+)/) || [])[1] || "XXX";
  const contractType = (contractPart.match(/-(.*?)\//) || [])[1] || "BDH";
  const lastPart = (contractPart.match(/-([^/]+)$/) || [])[1] || "XXX";
  return `${contractType}_${annexNumber}_${contractNumber}_TEN GOI THAU_${lastPart}`;
}

function writeToSheetAndExportDoc_PL(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("PLHD");
    if (!sheet) throw new Error("Không tìm thấy sheet PLHD!");

    // 1. GHI SHEET MỒI
    const dateVal = data.date || "Không có ngày";
    sheet.getRange("B3:E3").setValues([[dateVal, data.field8 || "Không có số HĐ", data.field2 || "", data.field9 || ""]]);
    sheet.getRange("BF3:BG3").setValues([[data.selectedBF3 || "", data.field10 || ""]]);
    sheet.getRange("BL3").setValue(data.adjustmentIds || "");

    SpreadsheetApp.flush(); 

    const row3Data = sheet.getRange(3, 1, 1, 78).getValues()[0]; 

    // 2. GHI SỔ THEO DÕI
    const targetSheet = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    const targetRow = targetSheet.getRange("S1").getValue();

    const jValue = getCurrentStaffName();

    const valuesToWrite = [[
      row3Data[1], row3Data[51], "", data.field8, "", row3Data[6], row3Data[21], 
      row3Data[31], jValue, row3Data[3], "", row3Data[57], row3Data[59]
    ]];
    targetSheet.getRange(targetRow, 2, 1, 13).setValues(valuesToWrite);

    // 2.1 GHI ĐÈ INITIAL STATE VÀO SHEET X
    SpreadsheetApp.flush(); 
    const sheetX = ss.getSheetByName("X");
    const dataA = sheetX.getRange(4, 1, sheetX.getLastRow() - 3, 1).getValues().flat();
    const rowX = dataA.findIndex(val => val.toString().trim() === data.field8.trim());
    
    if (rowX !== -1) {
      const hasValue = (parseFloat(data.field2.toString().replace(/\./g, '')) || 0) !== 0;
      const plStatus = [['', '', hasValue ? 'x' : '', '', '']];
      sheetX.getRange(rowX + 4, 15, 1, 5).setValues(plStatus);
    }

    // 🚀 TỐI ƯU TỐC ĐỘ: Bắn tin realtime đồng bộ phụ lục mới lên Ably ngay khi ghi sheet thành công
    SpreadsheetApp.flush(); 
    publishAblyContractUpdate("CREATE_PL", data.field8);

    // 3. TẠO VÀ XỬ LÝ DOCS (Bắt đầu chạy ngầm tiến trình nhân bản và bóc tách chữ mất nhiều thời gian)
    const docTemplateId = "1u8zXn5BGzOtJkxtGvNIK__Sr225vM9CM3yElOY9Kybc";
    const selectedNDs = data.selectedNDs || [];
    const fileName = generateFileName_PL(data.field8);

    const copiedFile = DriveApp.getFileById(docTemplateId).makeCopy(fileName);
    copiedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 

    const copiedDoc = DocumentApp.openById(copiedFile.getId());
    const body = copiedDoc.getBody();

    // 3.1 Replace Data [FIELD]
    const lastCol = sheet.getLastColumn();
    const dataRange = sheet.getRange(2, 2, 2, lastCol - 1).getDisplayValues();
    const placeholders = dataRange[0];
    const replaceVals = dataRange[1];

    placeholders.forEach((placeholder, i) => {
      if (placeholder && placeholder.trim().startsWith("[")) {
        body.replaceText(escapeSpecialChars(placeholder.trim()), replaceVals[i] || "");
      }
    });
    
    // 3.2 Logic xử lý ID (Bóc tách O(N) DOM Bottleneck)
    const rawIds = row3Data[63] || ""; 
    const computedIds = typeof computeAllActiveIds === "function" ? computeAllActiveIds(rawIds) : []; 
    const otherSections = row3Data.slice(64, 78).map(v => v.toString().trim()).filter(Boolean);
    
    const validSectionsSet = new Set([...computedIds, ...otherSections, ...selectedNDs].map(String));

    const paragraphs = body.getParagraphs();
    let isDeleting = false;
    let deleteBuffer = [];
    let elementsToRemove = [];

    for (let i = 0; i < paragraphs.length; i++) {
      let p = paragraphs[i];
      let text = p.getText();

      if (text.includes("{") && !isDeleting) { 
        isDeleting = true; 
        deleteBuffer = [p]; 
      } else if (isDeleting) { 
        deleteBuffer.push(p); 
      }

      if (text.includes("}")) {
        let match = text.match(/\}\s*(\d+)/);
        if (match && match[1]) {
          if (!validSectionsSet.has(match[1])) {
            elementsToRemove.push(...deleteBuffer);
          }
        }
        isDeleting = false; 
        deleteBuffer = [];
      }
    }

    elementsToRemove.forEach(el => {
      try { el.removeFromParent(); } catch(e) {}
    });

    body.replaceText("\\{", "");
    body.replaceText("\\}\\s*\\d+", "");

    copiedDoc.saveAndClose();

    if (DocumentApp.openById(copiedFile.getId()).getBody().getText().trim() === "") {
      DriveApp.getFileById(copiedFile.getId()).setTrashed(true);
      return { link: "" };
    }
    
    return { link: copiedFile.getUrl() };

  } catch (error) { 
    throw new Error("Lỗi xử lý Phụ lục: " + error.message); 
  }
}

function computeAllActiveIds(rawIdsString) {
  if (!rawIdsString) return [];
  
  const selected = rawIdsString.toString().split(",").map(id => id.trim());
  const set = new Set(selected);
  let finalIds = [...selected];

  const hasA = set.has("1") || set.has("2");
  // 🔥 Thêm ID 5 vào cụm logic của Bên B
  const hasB = set.has("3") || set.has("4") || set.has("5"); 

  if (hasA && hasB) finalIds.push("200");
  else if (hasA) finalIds.push("201");
  else if (hasB) finalIds.push("202");

  if (hasA) finalIds.push("300");
  if (hasB) finalIds.push("301");

  return finalIds;
}

// --- 4.3 XUẤT DATA SANG SHEET MỚI (CHỨC NĂNG BÔI ĐEN XUẤT) ---
function exportToNewSpreadsheet_PL(filteredA) {
  try {
    const newSS = SpreadsheetApp.create("DATA HỢP ĐỒNG");
    const sheet = newSS.getActiveSheet();
    sheet.appendRow(["NGÀY KÝ", "SỐ HỢP ĐỒNG / PLHĐ", "DỰ ÁN", "TÊN NHÀ THẦU", "TÊN GÓI THẦU", "GIÁ TRỊ (VND)", "NGƯỜI THỰC HIỆN"]);
    
    sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#00B050").setFontColor("white").setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.setRowHeight(1, 35);

    const sourceSheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("X");
    const data = sourceSheet.getRange(`A4:N${sourceSheet.getLastRow()}`).getValues();
    const rowsToAdd = [];

    filteredA.forEach(valA => {
      const matchedRow = data.find(row => (row[0]?.toString().trim() || "") === valA.trim());
      if (matchedRow) {
        const giaTriRaw = matchedRow[2] || "";   
        rowsToAdd.push([
          matchedRow[7] || "", matchedRow[0] || "", matchedRow[13] || "", 
          matchedRow[10] || "", matchedRow[1] || "", 
          (giaTriRaw === "" || isNaN(giaTriRaw)) ? "" : Number(giaTriRaw), 
          matchedRow[12] || ""
        ]);
      }
    });

    if (rowsToAdd.reverse().length > 0) sheet.getRange(2, 1, rowsToAdd.length, 7).setValues(rowsToAdd);

    const lastDataRow = sheet.getLastRow();
    const fullRange = sheet.getRange(1, 1, lastDataRow, 7);
    fullRange.setVerticalAlignment("middle").setFontFamily("Arial").setFontSize(11).setWrap(true).setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
    
    sheet.getRange("A2:A" + lastDataRow).setHorizontalAlignment("center");
    sheet.getRange("B2:B" + lastDataRow).setHorizontalAlignment("left");
    sheet.getRange("C2:C" + lastDataRow).setHorizontalAlignment("center");
    sheet.getRange("D2:E" + lastDataRow).setHorizontalAlignment("left");
    if (lastDataRow >= 2) sheet.getRange("F2:F" + lastDataRow).setNumberFormat("#,##0").setHorizontalAlignment("right");
    sheet.getRange("G2:G" + lastDataRow).setHorizontalAlignment("center");

    sheet.setColumnWidths(1, 7, [110, 350, 75, 500, 800, 170, 170]);
    sheet.setFrozenRows(1);
    return newSS.getUrl();
  } catch (e) { throw new Error("Lỗi xuất Sheet: " + e.message); }
}

// --- 4.4 HÀM MỚI: CẬP NHẬT DỮ LIỆU TỪ WEB (EDIT DATA VÀO SO HDTCXD) ---
function updateContractData_PL(maHD, editType, newValue) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (!sheetLog) throw new Error("Không tìm thấy Sổ gốc!");

    const lastRow = sheetLog.getLastRow();
    const dataE = sheetLog.getRange(1, 5, lastRow, 1).getValues(); 
    const maClean = maHD.trim().toUpperCase();
    
    let targetRow = -1;
    for (let i = dataE.length - 1; i >= 0; i--) {
        if (dataE[i][0].toString().trim().toUpperCase() === maClean) {
            targetRow = i + 1;
            break;
        }
    }

    if (targetRow === -1) return false; 

    if (editType === "DATE") {
        sheetLog.getRange(targetRow, 2).setValue(newValue); 
    } 
    else if (editType === "PACKAGE") {
        sheetLog.getRange(targetRow, 9).setValue(newValue); 
    } 
    else if (editType === "VALUE") {
        const num = Number(newValue.toString().replace(/\./g, ""));
        sheetLog.getRange(targetRow, 11).setValue(num); 
    }
    else if (editType === "CONTRACT_NO") {
        sheetLog.getRange(targetRow, 5).setValue(newValue.trim()); 
    }

    SpreadsheetApp.flush(); 
    return true;
  } catch (e) { throw new Error("Lỗi Backend: " + e.message); }
}

// =========================================================================
// QUẢN LÝ FILE DRIVE & SCAN UTILITIES
// =========================================================================

// CHỈ CẦN CUNG CẤP ID CỦA THƯ MỤC MẸ (Nơi chứa tất cả các thư mục dự án)
const ROOT_FOLDER_ID = "1SmlwbdIfTTQAaGTl2sEtRU-KFEYmx9Xc";

function uploadScanToDrive(base64Data, maHD, fileName) {
  try {
    // 1. Trích xuất Tên dự án từ maHD
    let projectName = "DEFAULT";
    const match = maHD.match(/HĐTCXD-([^\/\s]+)/i); 
    if (match) {
        projectName = match[1].trim().toUpperCase();
    }

    // 2. TÌM THƯ MỤC THEO TÊN BÊN TRONG THƯ MỤC MẸ
    const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const folderIterator = rootFolder.getFoldersByName(projectName);
    
    let targetFolder;
    if (folderIterator.hasNext()) {
        targetFolder = folderIterator.next();
    } else {
        targetFolder = rootFolder.createFolder(projectName);
    }

    // --- NHẬN DIỆN MIME TYPE TỰ ĐỘNG ---
    let mimeType = 'application/pdf'; // Mặc định là PDF
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.xlsx')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (lowerName.endsWith('.xls')) {
        mimeType = 'application/vnd.ms-excel';
    }
    
    // 3. Tạo Blob với MimeType tương ứng
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

    const file = targetFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    const fileId = file.getId();

    // 4. Cập nhật dữ liệu vào Sheet
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetX = ss.getSheetByName("X");
    const lastRow = sheetX.getLastRow();
    const dataA = sheetX.getRange(4, 1, lastRow - 3, 1).getValues().flat();
    const targetIndex = dataA.findIndex(val => val.toString().trim() === maHD.trim());

    if (targetIndex !== -1) {
      const cell = sheetX.getRange(targetIndex + 4, 16);
      SpreadsheetApp.flush(); 
      const currentVal = cell.getValue().toString();
      const newEntry = fileId + "|" + fileName;
      const newVal = (currentVal && currentVal.trim() !== "") ? (currentVal + ";;" + newEntry) : newEntry;
      cell.setValue(newVal);
      SpreadsheetApp.flush(); 
    }
    
    return { success: true, id: fileId, fileName: fileName };
  } catch (e) { 
    return { success: false, error: e.toString() }; 
  }
}

function getFileFromDrive(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    return Utilities.base64Encode(bytes);
  } catch (e) {
    throw new Error("Không thể truy cập file trên Drive: " + e.toString());
  }
}

function deleteContractRow_Backend(maHD) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const maClean = maHD.toString().trim().toUpperCase();
    let fileIds = [];

    // 1. XỬ LÝ TRÊN SHEET X (Tìm mã tại cột A để dọn static data và lấy file ID)
    const sheetX = ss.getSheetByName("X");
    if (sheetX) {
      const dataX = sheetX.getRange(1, 1, sheetX.getLastRow(), 16).getValues(); 
      for (let i = dataX.length - 1; i >= 3; i--) {
        if (dataX[i][0].toString().trim().toUpperCase() === maClean) {
          const scanData = dataX[i][15].toString();
          if (scanData.includes("|")) {
            scanData.split(";;").forEach(e => fileIds.push(e.split("|")[0]));
          }
          sheetX.getRange(i + 1, 15, 1, 5).clearContent();
          break; // EARLY EXIT: Đã tìm thấy và xử lý xong, dừng loop
        }
      }
    }

    // 2. XỬ LÝ TRÊN SỔ GỐC (Tìm mã tại cột E để xóa hàng)
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (sheetLog) {
      const lastRowLog = sheetLog.getLastRow();
      const dataE = sheetLog.getRange(1, 5, lastRowLog, 1).getValues();
      for (let j = dataE.length - 1; j >= 0; j--) {
        if (dataE[j][0].toString().trim().toUpperCase() === maClean && maClean !== "") {
          sheetLog.deleteRow(j + 1);
          break; // EARLY EXIT: Đã xóa dòng, dừng loop
        }
      }
    }

    // 3. DỌN DRIVE (Chạy sau cùng)
    if (fileIds.length > 0) {
      fileIds.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch(e) {} });
    }

    SpreadsheetApp.flush();
    
    // Kích hoạt đồng bộ realtime khi xóa dữ liệu hợp đồng thành công
    publishAblyContractUpdate("DELETE_DATA", maHD);
    
    return true;
  } catch (e) {
    throw new Error("Lỗi Backend xóa Cột E: " + e.message);
  }
}

function getOrCreateSubFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(folderName);
}

function deleteScanFilePermanently(maHD, fileIdToDelete) {
  try {
    if (!fileIdToDelete) throw new Error("ID không hợp lệ");
    Drive.Files.remove(fileIdToDelete);

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetX = ss.getSheetByName("X");
    const dataA = sheetX.getRange(4, 1, sheetX.getLastRow() - 3, 1).getValues().flat();
    const targetIndex = dataA.findIndex(val => val.toString().trim() === maHD.trim());

    if (targetIndex !== -1) {
      const cell = sheetX.getRange(targetIndex + 4, 16);
      const currentVal = cell.getValue().toString();
      const updatedFiles = currentVal.split(";;").filter(f => f && !f.startsWith(fileIdToDelete + "|"));
      
      if (updatedFiles.length > 0) {
        cell.setValue(updatedFiles.join(";;"));
      } else {
        cell.clearContent();
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function optimizeDocSections(body, validSections) {
    const paragraphs = body.getParagraphs();
    let isDeleting = false;
    let currentBlock = [];
    let elementsToRemove = [];

    for (let i = 0; i < paragraphs.length; i++) {
        let p = paragraphs[i];
        let text = p.getText().trim();

        if (!isDeleting && text.includes("{")) {
            isDeleting = true;
            currentBlock = [p];
        } 
        else if (isDeleting) {
            currentBlock.push(p);
        }

        if (isDeleting && text.includes("}")) {
            let match = text.match(/\}\s*(\d+)/);
            if (match && match[1]) {
                if (!validSections.has(match[1].toString())) {
                    elementsToRemove.push(...currentBlock);
                }
            }
            isDeleting = false;
            currentBlock = [];
        }
    }

    elementsToRemove.forEach(el => {
        try { el.removeFromParent(); } catch(e) {}
    });

    body.replaceText("\\{", "");
    body.replaceText("\\}\\s*\\d+", "");
  }