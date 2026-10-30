
// ==========================================================================
// 6. HỆ THỐNG QUẢN LÝ FILE SCAN (VIEW, UPLOAD, RENDER)
// ==========================================================================

/**
 * Mở bảng quản lý file Scan cho một mã hợp đồng cụ thể
 */
function openScanPanel_PL(maHD) {
    closeContextMenu_PL();
    currentScanMaHD = maHD;

    // Cập nhật tiêu đề bảng Scan
    const title = document.getElementById('sp-header-title'); 
    if (title) {
        title.innerHTML = `
            <span style="color: #95A1AF; font-size: 10px; font-weight: 500; letter-spacing: 0.5px;">QUẢN LÝ FILE:</span><br>
            <span style="color: #FFBA08; font-size: 13px; font-weight: 700;">${maHD}</span>
        `;
    }

    renderExistingFiles_PL(maHD);

    const scanPanel = document.getElementById('scan-panel-pl');
    if (scanPanel) {
        scanPanel.classList.add('active');
        scanPanel.style.display = 'flex';
    }
    
    const list = document.getElementById('dropdown-field0-pl');
    if(list) list.classList.add('list-dashboard-locked');
    
    const searchContainer = document.getElementById('main-search-container-pl');
    if(searchContainer) searchContainer.style.zIndex = "2000";
}

/**
 * Đóng bảng Scan và dọn dẹp hàng chờ upload
 */
function closeScanPanel_PL() {
    removeScanFile_PL(); 
    const scanPanel = document.getElementById('scan-panel-pl');
    if (scanPanel) scanPanel.classList.remove('active');
    
    const list = document.getElementById('dropdown-field0-pl');
    if(list) list.classList.remove('list-dashboard-locked');
    
    const searchContainer = document.getElementById('main-search-container-pl');
    if(searchContainer) searchContainer.style.zIndex = "1000";
}

/**
 * Logic nhận diện và mở file chính từ Dashboard (Double click bên ngoài)
 */
function handleViewMainFile_PL(maHD, rawScanData) {
    if (!rawScanData) return;
    const files = rawScanData.split(";;");
    if (files.length === 1) return viewScanFile_PL(files[0].split("|")[0]);

    let mainFileId = files[0].split("|")[0]; 
    if (maHD.startsWith("PL")) {
        const plPart = maHD.split(" - ")[0]; 
        const match = files.find(f => f.split("|")[1].toUpperCase().includes(plPart.toUpperCase()));
        if (match) mainFileId = match.split("|")[0];
    } else {
        const parts = maHD.match(/(\d+)\/(\d+)\/HĐTCXD-(.*?)\//);
        if (parts) {
            const key = `${parts[3]}_${parts[1]}_${parts[2]}`.toUpperCase();
            const match = files.find(f => f.split("|")[1].toUpperCase().includes(key));
            if (match) mainFileId = match.split("|")[0];
        }
    }
    viewScanFile_PL(mainFileId);
}

/**
 * Hiển thị danh sách các file hiện có trên Server cho mã HĐ này
 */
function renderExistingFiles_PL(maHD) {
    if (!SYSTEM_DATA || !SYSTEM_DATA.pl || !SYSTEM_DATA.pl.field0) return;
    
    const itemData = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === maHD);
    const infoBox = document.getElementById('scan-current-file-info');
    if (!infoBox) return;

    if (itemData && itemData.scanId && itemData.scanId.trim() !== "") {
        infoBox.style.display = "block";
        const fileList = itemData.scanId.split(";;").filter(f => f && f.includes("|")); 
        
        let htmlResult = "";
        fileList.forEach(fileStr => {
            const parts = fileStr.split("|");
            const id = parts[0].trim();
            const name = (parts[1] && parts[1] !== "undefined") ? parts[1].trim() : "Untitled_Scan.pdf";
            const isExcel = name.toLowerCase().match(/\.(xls|xlsx)$/);
            const iconClass = isExcel ? 'bi-file-earmark-excel-fill file-excel' : 'bi-file-earmark-pdf-fill file-pdf';
            
            htmlResult += `
                <div class="existing-file-wrapper">
                    <div class="existing-file-info" onclick="handleDoubleTap_Scan(event, '${id}', '${escapeStr(name)}')">
                        <div class="file-note-pop">Double-click to view</div>
                        <i class="bi ${iconClass} file-icon-main"></i>
                        <span class="file-name-text">${name}</span>
                    </div>
                    <div class="existing-file-action">
                        <div class="trash-note-pop note-download-cyan">Download</div>
                        <button type="button" class="btn-trash-simple btn-download-cyan" onclick="downloadScanFile_PL('${id}', event)">
                            <i class="bi bi-download"></i>
                        </button>
                    </div>
                    <div class="existing-file-action">
                        <div class="trash-note-pop note-remove-red">Remove</div>
                        <button type="button" class="btn-trash-simple btn-trash-red" onclick="triggerDeleteConfirm_PL('${id}', '${escapeStr(name)}')">
                            <i class="bi bi-trash3"></i>
                        </button>
                    </div>
                </div>`;
        });
        infoBox.innerHTML = htmlResult;
    } else {
        infoBox.style.display = "none";
        infoBox.innerHTML = "";
    }
}

/**
 * Mở link Drive của file scan
 */
function viewScanFile_PL(id, name) {
    if (!id || id === "undefined") return;
    let targetId = id;
    if (id.includes(";;")) {
        const fileEntries = id.split(";;").filter(String);
        targetId = fileEntries[0].split("|")[0].trim();
        if (name && name.startsWith("PL")) {
            const plNo = name.split(" - ")[0].toUpperCase(); 
            const match = fileEntries.find(f => f.toUpperCase().includes(plNo));
            if (match) targetId = match.split("|")[0].trim();
        }
    } else if (id.includes("|")) {
        targetId = id.split("|")[0].trim();
    }
    if (targetId) window.open("https://drive.google.com/file/d/" + targetId + "/view", '_blank');
}

// ==========================================================================
// 7. UPLOAD LOGIC & QUEUE MANAGEMENT
// ==========================================================================

function updateScanQueueUI() {
    if (currentScanFiles.length === 0) { removeScanFile_PL(); return; }
    const totalMB = (currentScanFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2);
    document.getElementById('scan-state-empty').style.display = "none";
    document.getElementById('scan-state-file').style.display = "flex";
    const nameLabel = document.getElementById('scan-file-name');
    nameLabel.textContent = currentScanFiles.length === 1 ? currentScanFiles[0].name : `Queue: ${currentScanFiles.length} PDF/Excel files ready!`;
    document.getElementById('scan-file-size').textContent = `Total size: ${totalMB} MB`;
    document.getElementById('btn-upload-scan').disabled = false;
}

function removeScanFile_PL(event) {
    if(event) event.stopPropagation();
    currentScanFiles = []; 
    const fileInput = document.getElementById('scan-file-input');
    if (fileInput) fileInput.value = ""; 
    document.getElementById('scan-state-empty').style.display = "flex";
    document.getElementById('scan-state-file').style.display = "none";
    document.getElementById('btn-upload-scan').disabled = true;
}

/**
 * Bắt đầu tiến trình upload nhiều file (Kết hợp nén PDF và giữ kết nối)
 */
async function startUploadScan_PL() {
    if (!currentScanFiles.length) return;
    const btn = document.getElementById('btn-upload-scan');
    const progressBar = document.getElementById('scan-progress-bar');
    const percentText = document.getElementById('scan-percent-text');
    const statusText = document.getElementById('scan-status-text');
    const progressContainer = document.getElementById('scan-progress-container');
    
    progressContainer.style.display = 'block';
    btn.disabled = true;
    
    progressBar.classList.remove('finished');
    progressBar.style.backgroundColor = "#FFBA08"; 
    progressBar.style.width = "0%";
    percentText.textContent = "0%";
    
    keepAliveAudio.play().catch(e => console.warn("Audio error:", e));

    try {
        for (let i = 0; i < currentScanFiles.length; i++) {
            const file = currentScanFiles[i];
            const baseProgress = (i / currentScanFiles.length) * 100;
            const fileWeight = 100 / currentScanFiles.length;
            let base64Data = "";

            statusText.textContent = `[${i+1}/${currentScanFiles.length}] READING ORIGINAL FILE...`;
            
            // Đọc trực tiếp tệp tin gốc nguyên bản sang Base64 không qua nén ảnh
            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = e => reject(e);
                reader.readAsDataURL(file);
            });

            let fakeP = Math.round(baseProgress + fileWeight * 0.5); // 50% hoàn tất tiến trình đọc tệp cục bộ
            progressBar.style.width = fakeP + "%";
            percentText.textContent = fakeP + "%";

            statusText.textContent = `[${i+1}/${currentScanFiles.length}] UPLOADING TO DRIVE...`;
            
            const res = await callBackend('uploadScanToDrive', [base64Data, currentScanMaHD, file.name]);
            if (res && res.success) {
                const item = SYSTEM_DATA.pl.field0.find(it => (it.display || "").split(" | ")[0].trim().toUpperCase() === currentScanMaHD.toUpperCase());
                if(item) {
                    const newEntry = res.id + "|" + res.fileName;
                    item.scanId = (item.scanId || "").trim() !== "" ? (item.scanId + ";;" + newEntry) : newEntry;
                    PRECOMPUTED_PL_DATA = null;
                    // BẬT CỜ preserveScroll = true ĐỂ GIỮ NGUYÊN VỊ TRÍ CUỘN DASHBOARD
                    executeFilter_PL(false, false, true);
                    renderExistingFiles_PL(currentScanMaHD);
                }
            } else {
                throw new Error(res ? res.error : "Lỗi Upload Server");
            }
            
            let stepP = Math.round(((i + 1) / currentScanFiles.length) * 100);
            progressBar.style.width = stepP + "%";
            percentText.textContent = stepP + "%";
        }
        
        statusText.textContent = "COMPLETE!";
        progressBar.classList.add('finished'); 
        progressBar.style.backgroundColor = "#2ECC71"; 
        
        showToast_PL(`🚀 UPLOADED ${currentScanFiles.length} FILE(S) SUCCESSFULLY!`, "success");
        removeScanFile_PL();
        setTimeout(() => { progressContainer.style.display = 'none'; }, 2000);
    } catch (e) {
        statusText.textContent = "FAILED!";
        progressBar.style.backgroundColor = "#ff4d4d"; 
        alert(`Upload Error: ${e.message || e}`);
    } finally {
        keepAliveAudio.pause(); 
        keepAliveAudio.currentTime = 0;
        // Khóa nút nếu đã upload xong sạch hàng chờ, chỉ bật lại nếu có lỗi cần upload lại
        if (btn) {
            btn.disabled = (currentScanFiles.length === 0);
        }
    }
}

// ==========================================================================
// 8. DELETE ENGINE (XÓA DÒNG DỮ LIỆU & FILE SCAN)
// ==========================================================================

/**
 * Modal xác nhận xóa toàn bộ dòng dữ liệu của hợp đồng
 */
function deleteContractRow_PL() {
    const overlay = document.getElementById('data-delete-confirm-overlay');
    const dialog = overlay ? overlay.querySelector('.scan-delete-dialog') : null;
    const maText = document.getElementById('delete-data-mahd');
    if (overlay && maText) {
        maText.textContent = editingMaHD_PL;
        overlay.style.display = 'flex';
        setTimeout(() => { 
            overlay.style.opacity = '1'; 
            if (dialog) dialog.style.transform = 'scale(1)';
        }, 10);
    }
}

function closeDataDeleteModal() {
    const overlay = document.getElementById('data-delete-confirm-overlay');
    const dialog = overlay ? overlay.querySelector('.scan-delete-dialog') : null;
    if (overlay) {
        overlay.style.opacity = '0';
        if (dialog) dialog.style.transform = 'scale(0.9)';
        setTimeout(() => { overlay.style.display = 'none'; }, 200);
    }
}

/**
 * Thực thi xóa dòng dữ liệu trên Sheet và cập nhật Dashboard
 */
function executeActualDeleteData_PL() {
    closeDataDeleteModal(); 
    const maToDelete = editingMaHD_PL;
    
    const backupItem = SYSTEM_DATA.pl.field0.find(item => (item.display || "").split(" | ")[0].trim() === maToDelete);
    const backupIndex = SYSTEM_DATA.pl.field0.indexOf(backupItem);

    if (backupItem) {
        SYSTEM_DATA.pl.field0 = SYSTEM_DATA.pl.field0.filter(item => (item.display || "").split(" | ")[0].trim() !== maToDelete);
        PRECOMPUTED_PL_DATA = null;
        
        executeFilter_PL(false); 
        if (typeof updateContractNo_PL === 'function') updateContractNo_PL();
        closeEditPanel_PL();
        
        showToast_PL(`🗑️ Đã xóa dữ liệu: <b style="color:white">${maToDelete}`, "success");

        callBackend("deleteContractRow_Backend", maToDelete)
            .then(() => {
                // Kích hoạt phát tin cập nhật ngay tại Client khi hoàn tất xóa thành công
                publishAblyContractUpdate_Client("DELETE_DATA", maToDelete);
                
                loadSystemData(true); 
            })
            .catch(err => {
                if (backupIndex !== -1) {
                    SYSTEM_DATA.pl.field0.splice(backupIndex, 0, backupItem);
                }
                PRECOMPUTED_PL_DATA = null;
                executeFilter_PL(false);
                if (typeof updateContractNo_PL === 'function') updateContractNo_PL();
                showToast_PL(`⚠️ Thao tác xóa ${maToDelete} thất bại! Đã khôi phục dữ liệu.`, "error");
                loadSystemData(true);
            });
    }
}

/**
 * Modal xác nhận xóa file Scan riêng lẻ
 */
function triggerDeleteConfirm_PL(id, fileName) {
    if (!id || id === "undefined") return showToast_PL("⚠️ ID không hợp lệ!", "error");
    fileIdToProcess = id; 
    const overlay = document.getElementById('scan-delete-confirm-overlay');
    const dialog = overlay.querySelector('.scan-delete-dialog');
    const nameDisplay = document.getElementById('delete-scan-filename');
    if (overlay && nameDisplay) {
        nameDisplay.textContent = fileName;
        overlay.style.display = "flex";
        setTimeout(() => { overlay.style.opacity = "1"; if(dialog) dialog.style.transform = "scale(1)"; }, 10);
    }
}

function cancelDeleteScan_PL() {
    const overlay = document.getElementById('scan-delete-confirm-overlay');
    const dialog = overlay.querySelector('.scan-delete-dialog');
    if (overlay) {
        overlay.style.opacity = "0";
        if(dialog) dialog.style.transform = "scale(0.9)";
        setTimeout(() => { overlay.style.display = "none"; }, 200);
    }
}

/**
 * THỰC THI XÓA FILE SCAN RIÊNG LẺ CHẠY NGẦM (OPTIMISTIC BACKGROUND DELETION)
 */
function executeActualDelete_PL() {
    if (!fileIdToProcess) return;
    
    const targetFileId = fileIdToProcess;
    fileIdToProcess = ""; // Giải phóng biến toàn cục ngay lập tức
    cancelDeleteScan_PL(); // Đóng nhanh hộp thoại xác nhận xóa

    // 1. SAO LƯU DỮ LIỆU ĐỂ PHỤC VỤ HOÀN TÁC (ROLLBACK) NẾU LỖI MẠNG
    const item = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === currentScanMaHD);
    if (!item) return;

    const originalScanId = item.scanId; // Bản sao lưu danh sách file scan thô gốc

    // 2. XÓA GIẢ ĐỊNH NGAY LẬP TỨC TRÊN GIAO DIỆN (0.1 GIÂY - KHÔNG KHÓA MÀN HÌNH)
    const updatedFiles = item.scanId.split(";;").filter(f => f && !f.startsWith(targetFileId + "|"));
    item.scanId = updatedFiles.join(";;");
    PRECOMPUTED_PL_DATA = null;
    
    renderExistingFiles_PL(currentScanMaHD); // Vẽ lại danh sách file trong khung scan ngay lập tức
    executeFilter_PL(false, false, true);    // Bật preserveScroll = true để giữ nguyên vị trí cuộn               // Cập nhật lại icon xanh/vàng trên dashboard ngay lập tức

    // Hiển thị duy nhất 1 thông báo thành công
    showToast_PL("🗑️ Đã xóa file scan thành công!", "success");

    // 3. GỌI BACKEND CHẠY NGẦM LẶNG LẼ TRÊN SPREADSHEET VÀ DRIVE
    callBackend("deleteScanFilePermanently", [currentScanMaHD, targetFileId])
        .then(res => {
            if (res && res.success) {
                // Thành công lặng lẽ, không cần thông báo lần 2
            } else {
                throw new Error(res ? res.error : "Không xác nhận được từ máy chủ");
            }
        })
        .catch(err => {
            console.error("Lỗi xóa file scan ngầm:", err);
            showToast_PL("⚠️ Lỗi mạng! Không thể xóa file trên Drive, đang khôi phục...", "error");
            
            // 🚀 BƯỚC PHÒNG VỆ (ROLLBACK): Khôi phục lại tệp tin cũ nếu xóa ngầm bị thất bại
            const restoreItem = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === currentScanMaHD);
            if (restoreItem) {
                restoreItem.scanId = originalScanId;
                PRECOMPUTED_PL_DATA = null;
                renderExistingFiles_PL(currentScanMaHD);
                executeFilter_PL(false);
            }
        });
}

// ==========================================================================
// KÍCH HOẠT SEARCH & TOOLTIP NOTE (DÁN CUỐI FILE JS_Tab_PL.html)
// ==========================================================================
document.addEventListener("DOMContentLoaded", function() {
    // 1. KÍCH HOẠT SEARCH ENGINE CHO Ô FIELD0-PL (ĐÃ KHÔI PHỤC)
    const inputField0PL = document.getElementById("field0-pl");
    if (inputField0PL) {
        inputField0PL.addEventListener("input", debounce(() => {
            const val = inputField0PL.value.trim();
            // Nếu người dùng đang chủ động gõ tìm kiếm thì xóa vết hợp đồng cũ
            if (val.toUpperCase() !== (window.selectedContractMaHD_PL || "").toUpperCase()) {
                window.selectedContractMaHD_PL = ""; 
                window.selectedRowDisplay_PL = "";
                window.activeSearchQuery_PL = val;
            }
            if (typeof filterField0_PL === "function") {
                filterField0_PL(true);
            }
        }, 150));
    }

    // 2. KÍCH HOẠT TOOLTIP NOTE KHI HOVER (CHỐNG CHỚP TẮT KHI RÊ QUA THẺ CON)
    const dashboardContainer = document.getElementById('dropdown-field0-pl');
    if (dashboardContainer && typeof globalTooltip !== 'undefined') {
        let activeTooltipRow = null;

        dashboardContainer.addEventListener('mouseover', function(e) {
            const row = e.target.closest('.hoc-tooltip');
            if (!row) return;

            // Nếu con trỏ vẫn đang nằm trong cùng 1 dòng đã mở chú thích thì giữ nguyên
            if (activeTooltipRow === row) return;
            activeTooltipRow = row;

            clearTimeout(tooltipTimeout);
            tooltipTimeout = setTimeout(() => {
                const hoverText = row.getAttribute('data-hovertext');
                if (!hoverText) return;

                globalTooltip.innerHTML = `
                    <b style="color:white; border-bottom:1.5px solid #FFBA08; padding-bottom: 4px; margin-bottom: 6px; display:block; font-size:11px;">RIGHT-CLICK / HOLD TO OPEN</b>
                    ${hoverText}
                `;
                
                const rect = row.getBoundingClientRect();
                globalTooltip.style.top = (rect.top - 8) + 'px';
                globalTooltip.style.left = (rect.left + (rect.width / 2)) + 'px';
                globalTooltip.classList.add('show-tooltip');
            }, 100); 
        });

        dashboardContainer.addEventListener('mouseout', function(e) {
            const currentRow = e.target.closest('.hoc-tooltip');
            const relatedRow = e.relatedTarget ? e.relatedTarget.closest('.hoc-tooltip') : null;

            // Nếu chuột chỉ di chuyển giữa các phần tử con (icon, text, nút upload, badge H|G) trong cùng 1 dòng -> BỎ QUA
            if (currentRow && relatedRow === currentRow) {
                return;
            }

            activeTooltipRow = null;
            clearTimeout(tooltipTimeout);
            globalTooltip.classList.remove('show-tooltip');
        });

        dashboardContainer.addEventListener('scroll', () => {
            activeTooltipRow = null;
            clearTimeout(tooltipTimeout);
            globalTooltip.classList.remove('show-tooltip');
        }, { passive: true });
    }

    // 3. KHU VỰC THẢ FILE TRONG BẢNG SCAN PANEL
    const dropZone = document.getElementById('scan-drop-zone');
    const fileInput = document.getElementById('scan-file-input');
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            handleFilesSelected(e.target.files);
            fileInput.value = "";
        });
        dropZone.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            dropZone.classList.add('dragover'); 
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); 
            dropZone.classList.remove('dragover');
            handleFilesSelected(e.dataTransfer.files);
        });
    }

    // 4. KÉO THẢ FILE TRỰC TIẾP VÀO TỪNG DÒNG MÃ HĐ/PL TRÊN DASHBOARD
    if (dashboardContainer) {
        let currentDragTargetRow = null;

        dashboardContainer.addEventListener('dragenter', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            const row = e.target.closest('.hoc-tooltip');
            if (row && row !== currentDragTargetRow) {
                if (currentDragTargetRow) currentDragTargetRow.classList.remove('row-file-dragover');
                currentDragTargetRow = row;
                currentDragTargetRow.classList.add('row-file-dragover');
            }
        });

        dashboardContainer.addEventListener('dragover', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const row = e.target.closest('.hoc-tooltip');
            if (row && row !== currentDragTargetRow) {
                if (currentDragTargetRow) currentDragTargetRow.classList.remove('row-file-dragover');
                currentDragTargetRow = row;
                currentDragTargetRow.classList.add('row-file-dragover');
            }
        });

        dashboardContainer.addEventListener('dragleave', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            if (!dashboardContainer.contains(e.relatedTarget)) {
                if (currentDragTargetRow) {
                    currentDragTargetRow.classList.remove('row-file-dragover');
                    currentDragTargetRow = null;
                }
            }
        });

        dashboardContainer.addEventListener('drop', (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();

            if (currentDragTargetRow) {
                currentDragTargetRow.classList.remove('row-file-dragover');
                currentDragTargetRow = null;
            }

            const row = e.target.closest('.hoc-tooltip');
            if (!row) return;

            const displayVal = row.getAttribute('data-display') || "";
            const maHD = displayVal.split(" | ")[0].trim();
            if (!maHD) return;

            const droppedFiles = e.dataTransfer.files;
            if (!droppedFiles || droppedFiles.length === 0) return;

            removeScanFile_PL();
            openScanPanel_PL(maHD);
            handleFilesSelected(droppedFiles);
        });
    }

    // 5. CHẶN TRÌNH DUYỆT TỰ Ý MỞ FILE TOÀN TRANG KHI THẢ TRƯỢT
    window.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
        }
    });
    window.addEventListener('drop', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
            e.preventDefault();
        }
    });
});

function handleFilesSelected(files) {
    if (!files || !files.length) return;
    
    const MAX_SIZE = 20 * 1024 * 1024; // Giới hạn trần 20MB
    let oversizedFiles = [];

    // 1. Chỉ chấp nhận định dạng PDF và Excel (.xls, .xlsx)
    const incomingFiles = Array.from(files).filter(f => {
        const name = f.name.toLowerCase();
        return f.type === "application/pdf" || name.endsWith(".xls") || name.endsWith(".xlsx");
    });
    
    if (incomingFiles.length === 0) {
        showToast_PL("⚠️ Sếp chỉ được chọn định dạng PDF hoặc Excel!", "error");
        return;
    }

    // 2. Kiểm tra dung lượng và lọc trùng lặp
    incomingFiles.forEach(newFile => {
        if (newFile.size > MAX_SIZE) {
            const sizeMB = (newFile.size / (1024 * 1024)).toFixed(1);
            oversizedFiles.push(`${newFile.name} (${sizeMB}MB)`);
            return; // Chặn không đưa vào hàng chờ upload
        }

        const isDuplicate = currentScanFiles.some(oldFile => 
            oldFile.name === newFile.name && oldFile.size === newFile.size
        );
        if (!isDuplicate) currentScanFiles.push(newFile);
    });

    // 3. Cảnh báo nếu phát hiện file > 20MB
    if (oversizedFiles.length > 0) {
        showToast_PL(`⚠️ File vượt quá dung lượng tối đa. Vui lòng nén file < 20MB trước khi tải lên.`, "error");
    }

    updateScanQueueUI();
}