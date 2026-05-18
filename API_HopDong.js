// 3. LOGIC XUẤT FILE HỢP ĐỒNG GỐC (HDTCXD)
// =========================================================================
function getLatestContractNumber_HD() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName("SO HDTCXD BCONS - NTP");
  return sheet ? sheet.getRange("R1").getValue().toString().trim() : "01";
}

function handleFullExportProcess_HD(formData) {
  try {
    var currentYear = new Date().getFullYear();
    // field2 là Dự án
    var extractedField2 = formData.field2.includes(" | ") ? formData.field2.split(" | ")[0].trim() : formData.field2;
    // field3 là Nhà thầu (bản cũ là field0)
    var extractedField3 = formData.field3.includes(" | ") ? formData.field3.split(" | ")[0].trim() : formData.field3;

    if (!formData.draftContract) {
      var lastNumber = getLatestContractNumber_HD(); 
      var nextNo = String(parseInt(lastNumber, 10) + 1).padStart(2, '0');

      // field8 là Số hợp đồng (bản cũ là field1)
      formData.field8 = `${nextNo}/${currentYear}/HĐTCXD-${extractedField2}/${formData.location}-${extractedField3}`;
      
      // field0 là Gói thầu (bản cũ là field3)
      var packageNameRaw = formData.field0.includes("|") ? formData.field0.split("|")[1].trim() : formData.field0;
      var packageName = packageNameRaw.toUpperCase().replace(/[^A-Z0-9\sĐƯÁÀẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ]/g, "");
      formData.fileName = `${extractedField2}_${nextNo}_${currentYear}_${packageName}_${extractedField3}`;
    } else {
      formData.field8 = `.../${currentYear}/HĐTCXD-${extractedField2}/${formData.location}-${extractedField3}`;
      formData.fileName = "Dự thảo hợp đồng";
    }

    return writeToSheetAndExportDoc_HD(formData);
  } catch (e) {
    throw new Error(e.message);
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

        SpreadsheetApp.flush(); // Bắt buộc giữ lại để GS tính toán 78 cột công thức

        const lastCol = sourceSheet.getLastColumn();
        const allRow3Values = sourceSheet.getRange(3, 1, 1, lastCol).getValues()[0];
        const allRow3Displays = sourceSheet.getRange(3, 1, 1, lastCol).getDisplayValues()[0];
        const placeholders = sourceSheet.getRange(2, 1, 1, lastCol).getDisplayValues()[0];

        // 2. GHI SỔ THEO DÕI VÀ ĐÁNH DẤU SHEET X
        if (!data.draftContract) {
            const targetSheet = spreadsheet.getSheetByName("SO HDTCXD BCONS - NTP");
            const targetRow = targetSheet.getRange("S1").getValue();
            const jValue = getCurrentStaffName();

            const logValues = [[
                allRow3Values[49], allRow3Values[8], "", data.field8, "",
                allRow3Values[45], allRow3Values[21], allRow3Values[26], jValue,
                allRow3Values[5], allRow3Values[6], "", allRow3Values[18]
            ]];
            targetSheet.getRange(targetRow, 2, 1, 13).setValues(logValues);

            const valH3 = allRow3Values[7]; 
            const valBI3 = allRow3Values[60]; 
            const valBJ3 = allRow3Values[61]; 

            const tickQ = (valH3 !== "" && valH3 !== 0 && valH3 !== "0") ? "x" : "";
            const tickR = (valBI3 == 303) ? "x" : "";
            const tickS = (valBJ3 == 309) ? "x" : "";

            // XÓA BỎ SpreadsheetApp.flush() DƯ THỪA TẠI ĐÂY
            const sheetX = spreadsheet.getSheetByName("X");
            const dataA = sheetX.getRange(4, 1, sheetX.getLastRow() - 3, 1).getValues();
            
            // Tối ưu RAM: Bỏ .flat(), duyệt trực tiếp mảng 2 chiều để tìm kiếm
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

        // 3. TẠO VÀ XỬ LÝ DOCS (ĐÃ TỐI ƯU CỔ CHAI)
        const docTemplateId = getContractTemplateId_HD(data.location);
        if (!docTemplateId) throw new Error("Không tìm thấy mẫu hợp đồng: " + data.location);

        const copiedFile = createContractFile_HD(docTemplateId, data.fileName);
        const doc = DocumentApp.openById(copiedFile.getId());
        const body = doc.getBody();

        // 3.1 Replace Text
        const replaceKeys = placeholders.slice(1);
        const replaceVals = allRow3Displays.slice(1);

        replaceKeys.forEach((key, i) => {
            if (key && key.trim().startsWith("[")) {
                body.replaceText(escapeSpecialChars(key.trim()), replaceVals[i] || "");
            }
        });

        // 3.2 Remove Unused Sections (Sử dụng Engine Native thay vì lặp DOM)
        const sectionData = allRow3Values.slice(54, 76);
        const validSections = new Set(sectionData.map(v => v ? v.toString().trim() : null).filter(Boolean));
        
        optimizeDocSections(body, validSections);

        doc.saveAndClose();
        return { link: copiedFile.getUrl() };

    } catch (error) {
        Logger.log("Lỗi tại writeToSheetAndExportDoc_HD: " + error.stack);
        throw new Error("Hệ thống không thể xuất file: " + error.message);
    }
}

// --- HÀM HỖ TRỢ DÙNG CHUNG ---
function getContractTemplateId_HD(type) {
  const ids = {
    "BCONS": "1CogZ-5vyYQcsfp7tQsmclrcx7SNBJuI5bso2PrfZORE",
    "DBCONS": "1gQ1RqteS09IURX4O63KcQZ1BbpHMBMiEtD7jtO31l3Y"
  };
  return ids[type];
}

function createContractFile_HD(id, name) {
  const file = DriveApp.getFileById(id).makeCopy(name);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
  return file;
}

function escapeSpecialChars(s) { return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); }

// =========================================================================
// 5. LOGIC XUẤT FILE THÔNG BÁO KẾT QUẢ (TBKQ)
// =========================================================================

function getLatestContractNumber_TB() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME_SO_TB);
  if (!sheet) return "01";
  return sheet.getRange("R1").getValue().toString().trim() || "01";
}

function handleFullExportProcess_TB(formData) {
  try {
    const currentYear = new Date().getFullYear();
    const lastNumber = getLatestContractNumber_TB();
    const nextNo = String(parseInt(lastNumber, 10) + 1).padStart(2, '0');

    // Tạo số TBKQ chuẩn (Sử dụng field6)
    formData.field6 = `${nextNo}/${currentYear}/TB/KĐT-BCONS`;
    
    // Tạo tên file chuẩn (Sử dụng field1 - Dự án 1)
    const projectName = formData.field1.includes(" | ") ? formData.field1.split(" | ")[0] : formData.field1;
    formData.fileName = `TBKQTT_${formData.field6.replace(/\//g, '-')}_${projectName}`;

    return writeToSheetAndExportDoc_TB(formData);
  } catch (e) { throw new Error(e.message); }
}

function writeToSheetAndExportDoc_TB(data) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sourceSheet = ss.getSheetByName(SHEET_NAME_TBKQ);
    
    // 1. GHI SHEET MỒI (Né ô J3 để sếp đặt công thức hoặc giữ dữ liệu)
    sourceSheet.getRange("A3:I3").setValues([[
      data.location, data.date, data.field6, data.field1, 
      data.field2, data.field3, data.field0, data.field4, data.field5
    ]]);
    
    // Ghi tên hạng mục đầy đủ vào ô K3
    sourceSheet.getRange("K3").setValue(data.fieldPkgName);

    // Ép hệ thống tính toán để ô J3 cập nhật kết quả mới nhất
    SpreadsheetApp.flush(); 

    // LẤY DỮ LIỆU BATCH
    const lastCol = sourceSheet.getLastColumn();
    const batchData = sourceSheet.getRange(2, 2, 2, lastCol - 1).getDisplayValues();
    const placeholders = batchData[0];
    const rowValues = batchData[1];

    // 2. GHI SỔ THEO DÕI (SO THONG BAO)
    const targetSheet = ss.getSheetByName(SHEET_NAME_SO_TB);
    const targetRow = targetSheet.getRange("S1").getValue();
    const sender = getCurrentStaffName();

    // Gộp danh sách các dự án (Dự án 1, 2, 3)
    const combinedProjects = [rowValues[15], rowValues[18], rowValues[21]].filter(Boolean).join(", ");
    
    // 🔥 LOGIC MỚI: Thêm tiền tố cố định vào trước giá trị lấy từ ô J3 (rowValues[8])
    const logContent = "TB TRÚNG THẦU + THƯ CẢM ƠN VÀ THÔNG BÁO KẾT QUẢ GÓI THẦU: " + rowValues[8];

    targetSheet.getRange(targetRow, 2, 1, 5).setValues([[
      rowValues[13],        // Cột B (Sổ): Ngày ký (lấy từ O3)
      data.field6,          // Cột C (Sổ): Số TBKQ
      combinedProjects,     // Cột D (Sổ): Mã các dự án
      logContent,           // Cột E (Sổ): Đầu ngữ + Nội dung ô J3
      sender                // Cột F (Sổ): Người thực hiện
    ]]);

    // 3. TẠO VÀ XỬ LÝ DOCS
    const docTemplateId = "1oyp4fMSu-AJuLY6Dvb7zZX6R1FjYLDreLBaoOsEDhEc";
    const copiedFile = DriveApp.getFileById(docTemplateId).makeCopy(data.fileName);
    copiedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    
    const doc = DocumentApp.openById(copiedFile.getId());
    const body = doc.getBody();

    // 3.1 Replace các thẻ [FIELD] trong văn bản
    placeholders.forEach((key, i) => {
      if (key && key.trim().startsWith("[")) {
        body.replaceText(escapeSpecialChars(key.trim()), rowValues[i] || "");
      }
    });

    // Xử lý ẩn/hiện các đoạn văn bản (nếu có)
    const validSectionsArray = rowValues.slice(24, 28).map(v => v ? v.toString().trim() : null).filter(Boolean);
    const validSections = new Set(validSectionsArray);
    
    if (validSections.size > 0) {
      optimizeDocSections(body, validSections);
    }

    doc.saveAndClose();
    return { link: copiedFile.getUrl() };

  } catch (e) { 
    throw new Error("Lỗi Backend TBKQ: " + e.message); 
  }}
