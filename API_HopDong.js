// =========================================================================
// 3. LOGIC XUẤT FILE HỢP ĐỒNG GỐC (HDTCXD) & THÔNG BÁO KẾT QUẢ (TBKQ)
// =========================================================================

// ==========================================
// --- NHÓM HÀM HỖ TRỢ DÙNG CHUNG (HELPERS) ---
// ==========================================

function extractYearFromDateString(dateStr) {
  if (!dateStr) return new Date().getFullYear().toString();
  const match = dateStr.match(/\b(20\d{2})\b/);
  if (match) return match[1];
  return new Date().getFullYear().toString();
}

function getNextRowAfterLastData_SO(sheet, startRow, colB, colE) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return startRow;
  const maxCol = Math.max(colB, colE);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, maxCol).getValues();
  
  let lastDataRowOffset = -1;
  for (let i = 0; i < values.length; i++) {
    const valB = values[i][colB - 1].toString().trim();
    const valE = values[i][colE - 1].toString().trim();
    if (valB !== "" || valE !== "") {
      lastDataRowOffset = i; 
    }
  }
  return lastDataRowOffset === -1 ? startRow : startRow + lastDataRowOffset + 1;
}

function getContractTemplateId_HD(type) {
  const ids = {
    "BCONS": "1DghIQwP3P5YmsHPKjyw1Uw1ZnOskLKAN3yR18TAgkZM",
    "DBCONS": "1gQ1RqteS09IURX4O63KcQZ1BbpHMBMiEtD7jtO31l3Y"
  };
  return ids[type];
}

function createContractFile_HD(id, name) {
  const file = DriveApp.getFileById(id).makeCopy(name);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return file;
}

function escapeSpecialChars(s) { 
  return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); 
}

// ==========================================
// --- PHÂN HỆ: HỢP ĐỒNG GỐC (HDTCXD) ---
// ==========================================

function getLatestContractNumber_HD(targetYear) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("SO HDTCXD BCONS - NTP");
  if (!sheet) return "00";
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return "00";
  const data = sheet.getRange(3, 5, lastRow - 2, 1).getValues(); 
  let maxStt = 0;
  const regex = new RegExp("^(\\d+)\\/" + targetYear + "\\/HĐTCXD", "i");
  for (let i = 0; i < data.length; i++) {
    const val = data[i][0].toString().trim();
    const match = val.match(regex);
    if (match) {
      const stt = parseInt(match[1], 10);
      if (stt > maxStt) maxStt = stt;
    }
  }
  return String(maxStt).padStart(2, '0');
}

function handleFullExportProcess_HD(formData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    var targetYear = extractYearFromDateString(formData.date);
    var extractedField2 = formData.field2.includes(" | ") ? formData.field2.split(" | ")[0].trim() : formData.field2;
    var extractedField3 = formData.field3.includes(" | ") ? formData.field3.split(" | ")[0].trim() : formData.field3;

    if (!formData.draftContract) {
      var lastNumber = getLatestContractNumber_HD(targetYear); 
      var nextNo = String(parseInt(lastNumber, 10) + 1).padStart(2, '0');

      formData.field8 = `${nextNo}/${targetYear}/HĐTCXD-${extractedField2}/${formData.location}-${extractedField3}`;
      
      var packageNameRaw = formData.field0.includes("|") ? formData.field0.split("|")[1].trim() : formData.field0;
      var packageName = packageNameRaw.toUpperCase().replace(/[^A-Z0-9\sĐƯÁÀẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ]/g, "");
      formData.fileName = `${extractedField2}_${nextNo}_${targetYear}_${packageName}_${extractedField3}`;
    } else {
      formData.field8 = `.../${targetYear}/HĐTCXD-${extractedField2}/${formData.location}-${extractedField3}`;
      formData.fileName = "Dự thảo hợp đồng";
    }

    return writeToSheetAndExportDoc_HD(formData);
  } catch (e) {
    throw new Error(e.message);
  } finally {
    lock.releaseLock(); 
  }
}

function writeToSheetAndExportDoc_HD(data) {
    try {
        const spreadsheet = SpreadsheetApp.openById(SHEET_ID);
        const sourceSheet = spreadsheet.getSheetByName("HDTCXD");
        if (!sourceSheet) throw new Error("Không tìm thấy sheet HDTCXD.");

        // 1. GHI SHEET MỒI
        const inputValues = [[
            data.location || "", data.date || "", data.field8 || "", data.field2 || "",
            data.field0 || "", data.field4 || "", data.field6 || "", data.field5 || "",
            data.field7 || "", data.field3 || "", data.field1 || ""
        ]];
        sourceSheet.getRange("A3:K3").setValues(inputValues);

        const radioValues = [[
            data.radioOption2 || "", data.pl01 || "", data.radioOption || ""
        ]];
        sourceSheet.getRange("BH4:BJ4").setValues(radioValues);

        SpreadsheetApp.flush(); 

        const lastCol = sourceSheet.getLastColumn();
        const allRow3Values = sourceSheet.getRange(3, 1, 1, lastCol).getValues()[0];
        const allRow3Displays = sourceSheet.getRange(3, 1, 1, lastCol).getDisplayValues()[0];
        const placeholders = sourceSheet.getRange(2, 1, 1, lastCol).getDisplayValues()[0];

        // 2. GHI SỔ THEO DÕI VÀ ĐÁNH DẤU SHEET X
        if (!data.draftContract) {
            const targetSheet = spreadsheet.getSheetByName("SO HDTCXD BCONS - NTP");
            const targetRow = getNextRowAfterLastData_SO(targetSheet, 3, 2, 5);
            const jValue = getCurrentStaffName();

            // Sửa lỗi: Cung cấp đầy đủ 13 phần tử mảng khớp hoàn hảo với dải ô Range(13)
            const logValues = [[
                allRow3Values[49], allRow3Values[8], "", data.field8, "",
                allRow3Values[45], allRow3Values[21], allRow3Values[26], jValue,
                allRow3Values[5], allRow3Values[6], ""
            ]];
            targetSheet.getRange(targetRow, 2, 1, 12).setValues(logValues);

            const valH3 = allRow3Values[7]; 
            const valBI3 = allRow3Values[60]; 
            const valBJ3 = allRow3Values[61]; 

            const tickQ = (valH3 !== "" && valH3 !== 0 && valH3 !== "0") ? "x" : "";
            const tickR = (valBI3 == 303) ? "x" : "";
            const tickS = (valBJ3 == 309) ? "x" : "";

            const sheetX = spreadsheet.getSheetByName("X");
            const dataA = sheetX.getRange(4, 1, sheetX.getLastRow() - 3, 1).getValues();
            
            let rowX = -1;
            const targetMa = data.field8.trim();
            for (let i = 0; i < dataA.length; i++) {
                if (dataA[i][0].toString().trim() === targetMa) {
                    rowX = i;
                    break;
                }
            }

            if (rowX !== -1) {
                const hdStatus = [['', '', tickQ, tickR, tickS]];
                sheetX.getRange(rowX + 4, 15, 1, 5).setValues(hdStatus);
            }
        }

        // 3. TẠO VÀ XỬ LÝ DOCS
        const docTemplateId = getContractTemplateId_HD(data.location);
        if (!docTemplateId) throw new Error("Không tìm thấy mẫu hợp đồng: " + data.location);

        const copiedFile = createContractFile_HD(docTemplateId, data.fileName);
        const doc = DocumentApp.openById(copiedFile.getId());
        const body = doc.getBody();

        const replaceKeys = placeholders.slice(1);
        const replaceVals = allRow3Displays.slice(1);

        replaceKeys.forEach((key, i) => {
            if (key && key.trim().startsWith("[")) {
                body.replaceText(escapeSpecialChars(key.trim()), replaceVals[i] || "");
            }
        });

        const sectionData = allRow3Values.slice(54, 76);
        const validSections = new Set(sectionData.map(v => v ? v.toString().trim() : null).filter(Boolean));
        
        optimizeDocSections(body, validSections);

        doc.saveAndClose();
        
        publishAblyContractUpdate("CREATE_HD", data.field8);
        
        return { link: copiedFile.getUrl() };

    } catch (error) {
        throw new Error("Hệ thống không thể xuất file: " + error.message);
    }
}

// ==========================================
// --- PHÂN HỆ: THÔNG BÁO KẾT QUẢ (TBKQ) ---
// ==========================================

function getLatestContractNumber_TB(targetYear) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME_SO_TB);
  if (!sheet) return "00";
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return "00";
  const data = sheet.getRange(3, 3, lastRow - 2, 1).getValues(); 
  let maxStt = 0;
  const regex = new RegExp("^(\\d+)\\/" + targetYear + "\\/TB", "i");
  for (let i = 0; i < data.length; i++) {
    const val = data[i][0].toString().trim();
    const match = val.match(regex);
    if (match) {
      const stt = parseInt(match[1], 10);
      if (stt > maxStt) maxStt = stt;
    }
  }
  return String(maxStt).padStart(2, '0');
}

function handleFullExportProcess_TB(formData) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    const targetYear = extractYearFromDateString(formData.date);
    const lastNumber = getLatestContractNumber_TB(targetYear);
    const nextNo = String(parseInt(lastNumber, 10) + 1).padStart(2, '0');

    formData.field6 = `${nextNo}/${targetYear}/TB/KĐT-BCONS`;
    
    const projectName = formData.field1.includes(" | ") ? formData.field1.split(" | ")[0] : formData.field1;
    formData.fileName = `TBKQTT_${formData.field6.replace(/\//g, '-')}_${projectName}`;

    return writeToSheetAndExportDoc_TB(formData);
  } catch (e) { 
    throw new Error(e.message); 
  } finally {
    lock.releaseLock(); 
  }
}

function writeToSheetAndExportDoc_TB(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sourceSheet = ss.getSheetByName(SHEET_NAME_TBKQ);
    
    sourceSheet.getRange("A3:I3").setValues([[
      data.location, data.date, data.field6, data.field1, 
      data.field2, data.field3, data.field0, data.field4, data.field5
    ]]);
    
    sourceSheet.getRange("K3").setValue(data.fieldPkgName);

    SpreadsheetApp.flush(); 

    const lastCol = sourceSheet.getLastColumn();
    const batchData = sourceSheet.getRange(2, 2, 2, lastCol - 1).getDisplayValues();
    const placeholders = batchData[0];
    const rowValues = batchData[1];

    // GHI SỔ THEO DÕI (SO THONG BAO)
    const targetSheet = ss.getSheetByName(SHEET_NAME_SO_TB);
    const targetRow = getNextRowAfterLastData_SO(targetSheet, 3, 2, 3);
    const sender = getCurrentStaffName();

    const combinedProjects = [rowValues[15], rowValues[18], rowValues[21]].filter(Boolean).join(", ");
    const logContent = "TB TRÚNG THẦU + THƯ CẢM ƠN VÀ THÔNG BÁO KẾT QUẢ GÓI THẦU: " + rowValues[8];

    targetSheet.getRange(targetRow, 2, 1, 5).setValues([[
      rowValues[13],
      data.field6,
      combinedProjects,
      logContent,
      sender
    ]]);

    // TẠO VÀ XỬ LÝ DOCS
    const docTemplateId = "1oyp4fMSu-AJuLY6Dvb7zZX6R1FjYLDreLBaoOsEDhEc";
    const copiedFile = DriveApp.getFileById(docTemplateId).makeCopy(data.fileName);
    copiedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    
    const doc = DocumentApp.openById(copiedFile.getId());
    const body = doc.getBody();

    placeholders.forEach((key, i) => {
      if (key && key.trim().startsWith("[")) {
        body.replaceText(escapeSpecialChars(key.trim()), rowValues[i] || "");
      }
    });

    const validSectionsArray = rowValues.slice(24, 28).map(v => v ? v.toString().trim() : null).filter(Boolean);
    const validSections = new Set(validSectionsArray);
    
    if (validSections.size > 0) {
      optimizeDocSections(body, validSections);
    }

    doc.saveAndClose();
    return { link: copiedFile.getUrl() };

  } catch (e) { 
    throw new Error("Lỗi Backend TBKQ: " + e.message); 
  }
}
