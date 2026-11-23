// ==========================================
// --- PHÂN HỆ: PHỤ LỤC HỢP ĐỒNG (PLHD) ---
// ==========================================

function writeToSheetAndExportDoc_PL(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName("PLHD");
    if (!sheet) throw new Error("Không tìm thấy sheet PLHD!");

    // 1. GHI SHEET MỒI
    const dateVal = data.date || "Không có ngày";
    sheet.getRange("B3:E3").setValues([[dateVal, data.field8 || "Không có số HĐ", data.field2 || "", data.field9 || ""]]);
    sheet.getRange("BF3:BG3").setValues([[data.selectedBF3 || "", data.field10 || ""]]);
    const blCell = sheet.getRange("BL3");
    blCell.setNumberFormat("@"); 
    blCell.setValue(data.adjustmentIds || "");

    SpreadsheetApp.flush(); 

    const row3Data = sheet.getRange(3, 1, 1, 78).getValues()[0]; 

    // 2. GHI SỔ THEO DÕI
    const targetSheet = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    const targetRow = getNextRowAfterLastData_SO(targetSheet, 3, 2, 5);

    const jValue = getCurrentStaffName();
    const hasValue = (parseFloat((data.field2 || "").toString().replace(/\./g, '')) || 0) !== 0;

    const valuesToWrite = [[
      row3Data[1], row3Data[51], "", data.field8, "", row3Data[6], row3Data[21], 
      row3Data[31], jValue, row3Data[3], "", row3Data[57], row3Data[59],
      "", "", hasValue ? "x" : "", "", "" 
    ]];
    targetSheet.getRange(targetRow, 2, 1, 18).setValues(valuesToWrite);

    // 3. TẠO VÀ XỬ LÝ DOCS (CÓ BỘ BẢO VỆ QUYỀN TRUY CẬP DRIVEAPP)
    const docTemplateId = "1S02EAglGKBo55f4TT_oMKawDyZcNF-Wl2GZRjO-e5G4";
    const selectedNDs = data.selectedNDs || [];
    const fileName = generateFileName_PL(data.field8);

    let destinationFolder;
    try {
      destinationFolder = DriveApp.getFolderById(EXPORT_FOLDER_ID);
    } catch(e) {
      throw new Error("Tài khoản không có quyền truy cập Thư mục đích (EXPORT_FOLDER_ID).");
    }

    let copiedFile;
    try {
      copiedFile = DriveApp.getFileById(docTemplateId).makeCopy(fileName, destinationFolder);
    } catch(e) {
      throw new Error("Không thể nhân bản File Mẫu Phụ lục. Vui lòng kiểm tra quyền truy cập Template ID.");
    }

    // 🚀 BỌC AN TOÀN 1: Bỏ qua lỗi nếu Google Workspace chặn quyền bật Link Sharing Public
    try {
      copiedFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); 
    } catch(shareErr) {
      console.warn("Bỏ qua lỗi setSharing do chính sách bảo mật Workspace chặn: " + shareErr.message);
    }

    const copiedDoc = DocumentApp.openById(copiedFile.getId());
    const body = copiedDoc.getBody();

    const lastCol = sheet.getLastColumn();
    const dataRange = sheet.getRange(2, 2, 2, lastCol - 1).getDisplayValues();
    const placeholders = dataRange[0];
    const replaceVals = dataRange[1];

    placeholders.forEach((placeholder, i) => {
      if (placeholder && placeholder.trim().startsWith("[")) {
        body.replaceText(escapeSpecialChars(placeholder.trim()), replaceVals[i] || "");
      }
    });
    
    const rawIds = row3Data[63] || ""; 
    const computedIds = typeof computeAllActiveIds === "function" ? computeAllActiveIds(rawIds) : []; 
    const otherSections = row3Data.slice(64, 78).map(v => v.toString().trim()).filter(Boolean);
    
    const validSectionsSet = new Set([...computedIds, ...otherSections, ...selectedNDs].map(String));

    // Dùng hàm chung optimizeDocSections (thay cho vòng lặp cắt block trùng lặp)
    optimizeDocSections(body, validSectionsSet);

    copiedDoc.saveAndClose();

    // 🚀 BỌC AN TOÀN 2: Bỏ qua lỗi nếu Google Shared Drive không cho phép xóa file rỗng
    if (DocumentApp.openById(copiedFile.getId()).getBody().getText().trim() === "") {
      try {
        DriveApp.getFileById(copiedFile.getId()).setTrashed(true);
      } catch(trashErr) {
        console.warn("Bỏ qua lỗi setTrashed do giới hạn quyền Shared Drive: " + trashErr.message);
      }
      return { link: "" };
    }
    
    return { link: copiedFile.getUrl() };

  } catch (error) { 
    throw new Error("Lỗi xử lý Phụ lục: " + error.message); 
  } finally {
    lock.releaseLock(); 
  }
}

function updateContractData_PL(maHD, editType, newValue) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // Khóa luồng 20 giây tránh tranh chấp trượt dòng với lệnh xóa
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
  } catch (e) { 
    throw new Error("Lỗi Backend: " + e.message); 
  } finally {
    lock.releaseLock(); // Giải phóng khóa
  }
}

/**
 * Xuất dữ liệu ra Google Spreadsheet:
 * - Dùng dấu chấm phẩy (;) cho hàm =SUBTOTAL(9; ...)
 * - Sắp xếp cấp Dự án: Nhiều hợp đồng nhất xếp trên cùng, ít hợp đồng nhất xuống dưới cùng
 * - Sắp xếp cấp Hợp đồng nội bộ: Ngày ký từ cũ nhất đến mới nhất
 * - Hàng cuối cùng chèn "TỔNG GIÁ TRỊ" tính bằng =SUBTOTAL(9; ...)
 */
function exportToNewSpreadsheet_PL(payload) {
  try {
    let filteredA = [];
    let contractsOnly = false;
    let groupByProject = false;

    if (Array.isArray(payload)) {
      filteredA = payload;
    } else if (payload && typeof payload === 'object') {
      filteredA = payload.codes || [];
      contractsOnly = !!payload.contractsOnly;
      groupByProject = !!payload.groupByProject;
    }

    if (!filteredA || filteredA.length === 0) {
      throw new Error("Hệ thống không nhận được mảng dữ liệu xuất tệp Spreadsheet hợp lệ!");
    }

    let titleSS = "DATA HỢP ĐỒNG";
    if (contractsOnly && groupByProject) titleSS = "DATA HỢP ĐỒNG GỐC THEO DỰ ÁN";
    else if (contractsOnly) titleSS = "DATA HỢP ĐỒNG GỐC (CỘNG DỒN PL)";
    else if (groupByProject) titleSS = "DATA HỢP ĐỒNG THEO DỰ ÁN";

    const newSS = SpreadsheetApp.create(titleSS);
    const file = DriveApp.getFileById(newSS.getId());
    const destinationFolder = DriveApp.getFolderById(EXPORT_FOLDER_ID);
    file.moveTo(destinationFolder);

    // BẬT CHẾ ĐỘ: BẤT KỲ AI CÓ LINK ĐỀU CÓ THỂ CHỈNH SỬA
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
    } catch (shareErr) {
      console.warn("Bỏ qua cảnh báo setSharing do chính sách bảo mật Workspace: " + shareErr.message);
    }

    const sheet = newSS.getActiveSheet();
    sheet.appendRow(["NGÀY KÝ", "SỐ HỢP ĐỒNG / PLHĐ", "DỰ ÁN", "TÊN NHÀ THẦU", "TÊN GÓI THẦU", "GIÁ TRỊ (VND)", "NGƯỜI THỰC HIỆN"]);
    
    sheet.getRange("A1:G1").setFontWeight("bold").setBackground("#00B050").setFontColor("white").setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.setRowHeight(1, 35);

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sourceSheet = ss.getSheetByName("X");
    const data = sourceSheet.getRange(`A4:N${sourceSheet.getLastRow()}`).getValues();

    // Tra cứu danh mục Tên dự án từ Sheet DATABCONS
    const bconsSheet = ss.getSheetByName("DATABCONS");
    const bconsData = bconsSheet ? bconsSheet.getRange(3, 1, Math.max(1, bconsSheet.getLastRow() - 2), 2).getValues() : [];
    const projectNameMap = new Map();
    bconsData.forEach(r => {
      const pCode = (r[0] || "").toString().trim().toUpperCase();
      const pName = (r[1] || "").toString().trim();
      if (pCode) {
        projectNameMap.set(pCode, pName ? `Dự án ${pCode} - ${pName}` : `Dự án ${pCode}`);
      }
    });

    function parseDateToTime(val) {
      if (!val) return 0;
      if (val instanceof Date) return val.getTime();
      const s = val.toString().trim();
      const dmy = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (dmy) {
        return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10)).getTime();
      }
      const ymd = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (ymd) {
        return new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10)).getTime();
      }
      const parsed = Date.parse(s);
      return isNaN(parsed) ? 0 : parsed;
    }

    // 1. TRÍCH XUẤT DỮ LIỆU
    let extractedRows = [];

    if (!contractsOnly) {
      filteredA.forEach(valA => {
        const matchedRow = data.find(row => (row[0]?.toString().trim() || "") === valA.trim());
        if (matchedRow) {
          const giaTriRaw = matchedRow[2] || "";
          const projCode = (matchedRow[13] || "").toString().trim().toUpperCase();
          extractedRows.push({
            projCode: projCode,
            rowData: [
              matchedRow[7] || "", matchedRow[0] || "", matchedRow[13] || "", 
              matchedRow[10] || "", matchedRow[1] || "", 
              (giaTriRaw === "" || isNaN(giaTriRaw)) ? "" : Number(giaTriRaw), 
              matchedRow[12] || ""
            ]
          });
        }
      });
    } else {
      const uniqueParentCodes = [];
      const seenParents = new Set();

      filteredA.forEach(code => {
        let parentCode = code.trim();
        const plMatch = parentCode.match(/^PL\d+\s*-\s*(.*)$/i);
        if (plMatch && plMatch[1]) {
            parentCode = plMatch[1].trim();
        }
        if (!seenParents.has(parentCode.toUpperCase())) {
            seenParents.add(parentCode.toUpperCase());
            uniqueParentCodes.push(parentCode);
        }
      });

      uniqueParentCodes.forEach(parentCode => {
        const parentUpper = parentCode.toUpperCase();
        const parentRow = data.find(row => (row[0]?.toString().trim() || "").toUpperCase() === parentUpper);
        
        if (parentRow) {
          let totalContractValue = Number(parentRow[2]) || 0;
          data.forEach(r => {
            const rCode = (r[0] || "").toString().trim().toUpperCase();
            if (rCode.startsWith("PL") && rCode.includes(parentUpper)) {
              totalContractValue += (Number(r[2]) || 0);
            }
          });

          const projCode = (parentRow[13] || "").toString().trim().toUpperCase();
          extractedRows.push({
            projCode: projCode,
            rowData: [
              parentRow[7] || "", parentRow[0] || "", parentRow[13] || "",
              parentRow[10] || "", parentRow[1] || "",
              totalContractValue, parentRow[12] || ""
            ]
          });
        }
      });
    }

    // 2. TẠO CẤU TRÚC HÀNG VÀ CHÈN HÀM SUBTOTAL(9; ...)
    const rowsToAdd = [];
    const groupHeaderRowMeta = [];

    if (!groupByProject) {
      extractedRows.sort((a, b) => parseDateToTime(a.rowData[0]) - parseDateToTime(b.rowData[0]));
      extractedRows.forEach(item => rowsToAdd.push(item.rowData));
    } else {
      // Gom nhóm theo mã dự án
      const groupsMap = new Map();
      extractedRows.forEach(item => {
        const key = item.projCode || "KHAC";
        if (!groupsMap.has(key)) groupsMap.set(key, []);
        groupsMap.get(key).push(item.rowData);
      });

      // SẮP XẾP CÁC DỰ ÁN: NHIỀU HỢP ĐỒNG NHẤT XẾP TRÊN CÙNG, ÍT HỢP ĐỒNG NHẤT XUỐNG DƯỚI CÙNG
      const sortedProjectGroups = Array.from(groupsMap.entries()).sort((a, b) => {
        const countDiff = b[1].length - a[1].length; // Sắp xếp giảm dần theo số lượng hợp đồng
        if (countDiff !== 0) return countDiff;
        return a[0].localeCompare(b[0], 'vi', { numeric: true });
      });

      sortedProjectGroups.forEach(([pCode, rowsInGroup]) => {
        // A. Sắp xếp ngày ký từ cũ nhất đến mới nhất cho từng dự án
        rowsInGroup.sort((a, b) => {
          const tA = parseDateToTime(a[0]);
          const tB = parseDateToTime(b[0]);
          if (tA !== tB) return tA - tB;
          return (a[1] || "").toString().localeCompare((b[1] || "").toString(), 'vi', { numeric: true });
        });

        const headerTitle = projectNameMap.get(pCode) || (pCode === "KHAC" ? "Dự án khác" : `Dự án ${pCode}`);
        const headerRowIdx = rowsToAdd.length + 2; // Hàng 1 là tiêu đề cột chính
        const startRow = headerRowIdx + 1;
        const endRow = headerRowIdx + rowsInGroup.length;

        // B. Chèn hàm SUBTOTAL(9; ...) dùng dấu chấm phẩy (;)
        const projectFormula = rowsInGroup.length > 0 
          ? `=SUBTOTAL(9; F${startRow}:F${endRow})` 
          : 0;

        groupHeaderRowMeta.push({
          rowIdx: headerRowIdx,
          title: headerTitle
        });

        // Chèn dòng tiêu đề dự án chứa công thức SUBTOTAL tại Cột F
        rowsToAdd.push([headerTitle, "", "", "", "", projectFormula, ""]);

        // Chèn các hợp đồng thuộc dự án
        rowsInGroup.forEach(r => rowsToAdd.push(r));
      });
    }

    // C. HÀNG TỔNG GIÁ TRỊ TOÀN BỘ CÁC DỰ ÁN: SUBTOTAL(9; ...) dùng dấu chấm phẩy (;)
    let grandTotalRowIdx = 0;
    if (rowsToAdd.length > 0) {
      grandTotalRowIdx = rowsToAdd.length + 2;
      const grandTotalFormula = `=SUBTOTAL(9; F2:F${grandTotalRowIdx - 1})`;
      rowsToAdd.push(["TỔNG GIÁ TRỊ HỢP ĐỒNG TRƯỚC VAT", "", "", "", "", grandTotalFormula, ""]);
    }

    if (rowsToAdd.length > 0) {
      sheet.getRange(2, 1, rowsToAdd.length, 7).setValues(rowsToAdd);
    }

    const lastDataRow = sheet.getLastRow();
    if (lastDataRow >= 2) {
      const fullRange = sheet.getRange(1, 1, lastDataRow, 7);
      fullRange.setVerticalAlignment("middle")
               .setFontFamily("Arial")
               .setFontSize(11)
               .setWrap(true)
               .setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
      
      sheet.getRange("A2:A" + lastDataRow).setHorizontalAlignment("center");
      sheet.getRange("B2:B" + lastDataRow).setHorizontalAlignment("left");
      sheet.getRange("C2:C" + lastDataRow).setHorizontalAlignment("center");
      sheet.getRange("D2:E" + lastDataRow).setHorizontalAlignment("left");
      sheet.getRange("F2:F" + lastDataRow).setNumberFormat("#,##0").setHorizontalAlignment("right");
      sheet.getRange("G2:G" + lastDataRow).setHorizontalAlignment("center");

      // 3. ĐỊNH DẠNG DÒNG TIÊU ĐỀ DỰ ÁN VÀ CỘT F
      groupHeaderRowMeta.forEach(item => {
        const rIdx = item.rowIdx;
        sheet.getRange(rIdx, 1, 1, 5)
             .merge()
             .setValue(item.title)
             .setFontWeight("bold")
             .setBackground("#D9E1F2")
             .setFontColor("#1F4E79")
             .setHorizontalAlignment("left");

        sheet.getRange(rIdx, 6)
             .setFontWeight("bold")
             .setBackground("#D9E1F2")
             .setFontColor("#1F4E79")
             .setNumberFormat("#,##0")
             .setHorizontalAlignment("right");

        sheet.getRange(rIdx, 7).setBackground("#D9E1F2");
        sheet.setRowHeight(rIdx, 30);
      });

      // 4. ĐỊNH DẠNG HÀNG "TỔNG GIÁ TRỊ" CUỐI CÙNG
      if (grandTotalRowIdx > 0) {
        sheet.getRange(grandTotalRowIdx, 1, 1, 5)
             .merge()
             .setFontWeight("bold")
             .setBackground("#C6E0B4")
             .setFontColor("#274E13")
             .setHorizontalAlignment("left");

        sheet.getRange(grandTotalRowIdx, 6)
             .setFontWeight("bold")
             .setBackground("#C6E0B4")
             .setFontColor("#274E13")
             .setNumberFormat("#,##0")
             .setHorizontalAlignment("right");

        sheet.getRange(grandTotalRowIdx, 7).setBackground("#C6E0B4");
        sheet.setRowHeight(grandTotalRowIdx, 32);
      }
    }

    const colWidths = [110, 350, 75, 500, 800, 170, 170];
    colWidths.forEach((width, index) => {
        sheet.setColumnWidth(index + 1, width);
    });

    sheet.setFrozenRows(1);
    return newSS.getUrl();
  } catch (e) { 
    throw new Error("Lỗi xuất Sheet: " + e.message); 
  }
}

function updateTransferStatus_PL(contractNumber, isTransferred, docTypes) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const logSheet = ss.getSheetByName("CHUYEN HO SO");
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (!sheetLog || !logSheet) throw new Error("Hệ thống thiếu Sổ gốc hoặc CHUYEN HO SO");

    const lastRowLog = sheetLog.getLastRow();
    const dataE = sheetLog.getRange(1, 5, lastRowLog, 1).getValues(); // Cột E (Mã HĐ)
    const targetMa = contractNumber.trim().toUpperCase();
    let targetRow = -1;
    let ngayKyStr = "";

    for (let i = 0; i < dataE.length; i++) {
      if (dataE[i][0].toString().trim().toUpperCase() === targetMa) {
        targetRow = i + 1;
        let rawDate = sheetLog.getRange(targetRow, 2).getValue(); // Lấy ngày ký ở cột B
        if (rawDate instanceof Date) ngayKyStr = Utilities.formatDate(rawDate, "GMT+7", "dd/MM/yyyy");
        else ngayKyStr = rawDate ? rawDate.toString() : "";
        break;
      }
    }

    if (targetRow === -1) return false;

    // SỬA TẠI ĐÂY: Ghi dấu "x" bàn giao vào trực tiếp Cột O (Cột 15) trên Sổ Gốc
    sheetLog.getRange(targetRow, 15).setValue(isTransferred ? "x" : "");

    const lastRowLogChuyen = logSheet.getLastRow();
    
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
      
      const nextRow = getNextRowAfterLastData_SO(logSheet, 4, 2, 4);
      logSheet.getRange(nextRow, 1, 1, 9).setValues(newRowData);

    } else {
      // Xóa trực tiếp hàng vật lý: An toàn tuyệt đối 100% kể cả khi Sheet đang bị Filter/Sort
      if (lastRowLogChuyen >= 4) {
        const dataRange = logSheet.getRange(4, 1, lastRowLogChuyen - 3, 4).getValues();
        
        let contractToFind = targetMa;
        if (contractToFind.match(/^PL\d{2}\s*-/)) {
          contractToFind = contractToFind.split(" - ").slice(1).join(" - ").trim();
        }

        // Quét từ dưới lên để tìm đúng dòng cần hủy và xóa hàng vật lý
        for (let i = dataRange.length - 1; i >= 0; i--) {
          const loaiC = dataRange[i][2]?.toString().trim() || "";
          const valD = dataRange[i][3]?.toString().trim() || "";
          
          const isMatchMa = (valD === contractToFind);
          const isMatchLoai = targetMa.match(/^PL\d{2}\s*-/) ? loaiC.startsWith("PL") : loaiC === "HỢP ĐỒNG";
          
          if (isMatchMa && isMatchLoai) {
            logSheet.deleteRow(i + 4); // Xóa chính xác hàng, Google Sheets tự động cập nhật bộ lọc
            break; 
          }
        }
      }
    }

    return true;
  } finally {
    lock.releaseLock(); 
  }
}

// ==========================================
// --- NHÓM HÀM HỖ TRỢ PHỤ LỤC (HELPERS) ---
// ==========================================

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

function computeAllActiveIds(rawIdsString) {
  if (!rawIdsString) return [];
  
  const selected = rawIdsString.toString().split(",").map(id => id.trim());
  const set = new Set(selected);
  let finalIds = [...selected];

  const hasA = set.has("1") || set.has("2");
  const hasB = set.has("3") || set.has("4") || set.has("5"); 

  if (hasA && hasB) finalIds.push("200");
  else if (hasA) finalIds.push("201");
  else if (hasB) finalIds.push("202");

  if (hasA) finalIds.push("300");
  if (hasB) finalIds.push("301");

  return finalIds;
}

// ==========================================
// --- PHÂN HỆ: QUẢN LÝ FILE & SCAN UTILITIES ---
// ==========================================

const ROOT_FOLDER_ID = "1SmlwbdIfTTQAaGTl2sEtRU-KFEYmx9Xc";

function uploadScanToDrive(base64Data, maHD, fileName) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    let projectName = "DEFAULT";
    const match = maHD.match(/HĐTCXD-([^\/\s]+)/i); 
    if (match) {
        projectName = match[1].trim().toUpperCase();
    }

    const rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
    const folderIterator = rootFolder.getFoldersByName(projectName);
    
    let targetFolder;
    if (folderIterator.hasNext()) {
        targetFolder = folderIterator.next();
    } else {
        targetFolder = rootFolder.createFolder(projectName);
    }

    let mimeType = 'application/pdf'; 
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.xlsx')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (lowerName.endsWith('.xls')) {
        mimeType = 'application/vnd.ms-excel';
    }
    
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = targetFolder.createFile(blob);
    
    // Bảo vệ file gốc: chỉ cho phép xem (VIEW), không cho phép chỉnh sửa/xóa trực tiếp trên Drive
    try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(shareErr) {
        console.warn("Bỏ qua cảnh báo setSharing trên file Scan: " + shareErr.message);
    }
    
    const fileId = file.getId();

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    const lastRowLog = sheetLog.getLastRow();
    const dataE = sheetLog.getRange(1, 5, lastRowLog, 1).getValues().flat(); // Cột E (Mã HĐ)
    const targetIndex = dataE.findIndex(val => val.toString().trim().toUpperCase() === maHD.trim().toUpperCase());

    if (targetIndex !== -1) {
      const cell = sheetLog.getRange(targetIndex + 1, 16);
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
  } finally {
    lock.releaseLock(); 
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
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const maClean = maHD.toString().trim().toUpperCase();
    let fileIds = [];

    // 1. XỬ LÝ TRÊN SỔ GỐC (Tìm mã tại cột E để lấy file ID và xóa hàng)
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (sheetLog) {
      const lastRowLog = sheetLog.getLastRow();
      const dataE = sheetLog.getRange(1, 5, lastRowLog, 1).getValues();
      const dataP = sheetLog.getRange(1, 16, lastRowLog, 1).getValues(); // Cột P (Cột 16) chứa File Scan
      
      for (let j = dataE.length - 1; j >= 0; j--) {
        if (dataE[j][0].toString().trim().toUpperCase() === maClean && maClean !== "") {
          const scanData = dataP[j][0].toString();
          if (scanData.includes("|")) {
            scanData.split(";;").forEach(e => fileIds.push(e.split("|")[0]));
          }
          // Xóa hàng sổ gốc
          sheetLog.deleteRow(j + 1);
          break; 
        }
      }
    }

    // 2. DỌN DRIVE
    if (fileIds.length > 0) {
      fileIds.forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch(e) {} });
    }

    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    throw new Error("Lỗi Backend xóa Cột E: " + e.message);
  } finally {
    lock.releaseLock(); 
  }
}

function deleteScanFilePermanently(maHD, fileIdToDelete) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    if (!fileIdToDelete || !maHD) throw new Error("Thông tin yêu cầu không hợp lệ.");

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (!sheetLog) throw new Error("Không tìm thấy Sổ gốc!");

    const lastRowLog = sheetLog.getLastRow();
    const dataE = sheetLog.getRange(1, 5, lastRowLog, 1).getValues().flat();
    const targetIndex = dataE.findIndex(val => val.toString().trim().toUpperCase() === maHD.trim().toUpperCase());

    if (targetIndex === -1) {
      throw new Error("Không tìm thấy hồ sơ hợp đồng tương ứng.");
    }

    // CHỐNG IDOR: Kiểm tra fileIdToDelete có thực sự nằm trong danh sách file scan của mã HĐ này không
    const cell = sheetLog.getRange(targetIndex + 1, 16);
    const currentVal = cell.getValue().toString();
    const isFileBelongsToContract = currentVal.includes(fileIdToDelete + "|");

    if (!isFileBelongsToContract) {
      throw new Error("BẢO MẬT: File không thuộc hồ sơ hợp đồng này, từ chối xóa!");
    }

    // Sau khi xác thực hợp lệ mới thực hiện xóa vật lý trên Drive
    try {
      Drive.Files.remove(fileIdToDelete);
    } catch (driveErr) {
      console.warn("File đã bị xóa trước đó trên Drive: " + driveErr.message);
    }

    const updatedFiles = currentVal.split(";;").filter(f => f && !f.startsWith(fileIdToDelete + "|"));
    if (updatedFiles.length > 0) {
      cell.setValue(updatedFiles.join(";;"));
    } else {
      cell.clearContent();
    }

    SpreadsheetApp.flush();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock(); 
  }
}

function getOrCreateSubFolder(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parentFolder.createFolder(folderName);
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

function markScanDigitized_PL(fileId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (!fileId) return false;
    const targetId = fileId.toString().trim();
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (!sheetLog) return false;

    const lastRow = sheetLog.getLastRow();
    if (lastRow < 3) return false;

    const valuesP = sheetLog.getRange(3, 16, lastRow - 2, 1).getValues();
    let updated = false;

    for (let i = 0; i < valuesP.length; i++) {
      const raw = (valuesP[i][0] || "").toString().trim();
      if (!raw || !raw.includes(targetId + "|")) continue;

      const entries = raw.split(";;").filter(Boolean);
      let rowChanged = false;
      const newEntries = entries.map(entry => {
        const parts = entry.split("|");
        if (parts[0].trim() === targetId && (parts[2] || "").trim() !== "1") {
          rowChanged = true;
          return `${parts[0].trim()}|${(parts[1] || "").trim()}|1`;
        }
        return entry;
      });

      if (rowChanged) {
        sheetLog.getRange(i + 3, 16).setValue(newEntries.join(";;"));
        updated = true;
      }
    }

    if (updated) SpreadsheetApp.flush();
    return updated;
  } catch (e) {
    console.warn("Lỗi markScanDigitized_PL: " + e.message);
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * HÀM CHẠY TAY 1 LẦN TRONG APPS SCRIPT:
 * Tự động quét các file đã có "[Số hóa] *.json" từ trước để chuyển chấm sang Xanh lá
 */
function syncExistingDigitizedFlags_PL() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
  if (!sheetLog) return;

  const lastRow = sheetLog.getLastRow();
  if (lastRow < 3) return;

  const valuesP = sheetLog.getRange(3, 16, lastRow - 2, 1).getValues();
  for (let i = 0; i < valuesP.length; i++) {
    const raw = (valuesP[i][0] || "").toString().trim();
    if (!raw || !raw.includes("|")) continue;

    const entries = raw.split(";;").filter(Boolean);
    let rowChanged = false;

    const newEntries = entries.map(entry => {
      const parts = entry.split("|");
      const fId = parts[0].trim();
      const fName = (parts[1] || "").trim();
      if ((parts[2] || "").trim() === "1") return entry;

      try {
        const file = DriveApp.getFileById(fId);
        const parents = file.getParents();
        if (parents.hasNext()) {
          const folder = parents.next();
          const cleanBase = fName.replace(/\.pdf$/i, "").trim();
          const hasJson = folder.getFilesByName(`[Số hóa] ${cleanBase}.json`).hasNext() ||
                          folder.getFilesByName(`${cleanBase}.json`).hasNext();
          if (hasJson) {
            rowChanged = true;
            return `${fId}|${fName}|1`;
          }
        }
      } catch (e) {}
      return entry;
    });

    if (rowChanged) {
      sheetLog.getRange(i + 3, 16).setValue(newEntries.join(";;"));
    }
  }
  SpreadsheetApp.flush();
}

/**
 * Ghi đè nội dung nhị phân PDF sạch lên đúng fileId gốc trên Drive (giữ nguyên ID & quyền chia sẻ)
 */
function overwritePdfFile_Backend(fileId, base64Data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    if (!fileId || !base64Data) throw new Error("Thiếu fileId hoặc dữ liệu PDF.");

    const targetId = String(fileId).trim();
    const ss = SpreadsheetApp.openById(SHEET_ID);

    // CHỐNG IDOR: Xác minh fileId có tồn tại trong hệ thống quản lý trước khi ghi đè
    let isPermitted = false;

    // 1. Kiểm tra trong Sổ Hợp Đồng (Cột P)
    const sheetLog = ss.getSheetByName("SO HDTCXD BCONS - NTP");
    if (sheetLog && sheetLog.getLastRow() >= 3) {
      const scans = sheetLog.getRange(3, 16, sheetLog.getLastRow() - 2, 1).getValues().flat();
      if (scans.some(v => v && String(v).includes(targetId + "|"))) {
        isPermitted = true;
      }
    }

    // 2. Kiểm tra trong Drawing_Log (Cột B) nếu chưa thấy ở Sổ HĐ
    if (!isPermitted) {
      const drawSheet = ss.getSheetByName("Drawing_Log");
      if (drawSheet && drawSheet.getLastRow() >= 2) {
        const drawFiles = drawSheet.getRange(2, 2, drawSheet.getLastRow() - 1, 1).getValues().flat();
        if (drawFiles.some(v => v && String(v).trim() === targetId)) {
          isPermitted = true;
        }
      }
    }

    if (!isPermitted) {
      throw new Error("BẢO MẬT: Tệp tin không thuộc phạm vi hồ sơ được quản lý!");
    }

    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), "application/pdf");
    Drive.Files.update({}, targetId, blob, { supportsAllDrives: true });
    return { success: true };
  } catch (e) {
    throw new Error("Không thể ghi đè file PDF trên Drive: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Khởi tạo phiên Resumable PATCH dùng 1 lần để Client ghi đè trực tiếp PDF sạch lên Drive
 * (Không lộ OAuth Token + Kiểm tra IDOR siêu tốc bằng Sheets REST API)
 */
function getPdfOverwriteSession_Backend(fileId, fileSize, clientOrigin) {
  try {
    if (!fileId || !fileSize) throw new Error("Thiếu fileId hoặc kích thước tệp.");
    const targetId = String(fileId).trim();

    // 1. CHỐNG IDOR SIÊU TỐC (~150ms) qua Google Sheets REST API v4
    const resSheets = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, {
      ranges: ["SO HDTCXD BCONS - NTP!P3:P", "Drawing_Log!B2:B"]
    });
    const ranges = resSheets.valueRanges || [];
    const scanRows = (ranges[0]?.values || []).flat();
    const drawRows = (ranges[1]?.values || []).flat();

    const isPermitted =
      scanRows.some(v => v && String(v).includes(targetId + "|")) ||
      drawRows.some(v => v && String(v).trim() === targetId);

    if (!isPermitted) {
      throw new Error("BẢO MẬT: Tệp tin không thuộc phạm vi hồ sơ được quản lý!");
    }

    // 2. Xin phiên Resumable PATCH chỉ áp dụng cho đúng targetId
    const apiURL = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(targetId)}?uploadType=resumable&supportsAllDrives=true`;
    const headers = {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/pdf",
      "X-Upload-Content-Length": String(fileSize)
    };
    if (clientOrigin) {
      headers["Origin"] = String(clientOrigin).trim();
    }

    const response = UrlFetchApp.fetch(apiURL, {
      method: "patch",
      headers: headers,
      payload: "{}",
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error("Drive từ chối phiên ghi đè (" + response.getResponseCode() + "): " + response.getContentText());
    }

    const respHeaders = response.getHeaders();
    const uploadUrl = respHeaders["Location"] || respHeaders["location"];
    if (!uploadUrl) throw new Error("Không nhận được đường dẫn Resumable PATCH.");

    return { success: true, uploadUrl: uploadUrl };
  } catch (e) {
    throw new Error("Lỗi khởi tạo phiên ghi đè PDF: " + e.message);
  }
}