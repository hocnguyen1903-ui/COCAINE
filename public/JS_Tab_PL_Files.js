
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
            <span style="color: #95A1AF; font-size: 10px; font-weight: 500; letter-spacing: 0.5px;">QUẢN LÝ FILE MỀM:</span><br>
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
                    executeFilter_PL(false);
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
        keepAliveAudio.pause(); keepAliveAudio.currentTime = 0;
        btn.disabled = false;
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
    const maText = document.getElementById('delete-data-mahd');
    if (overlay && maText) {
        maText.textContent = editingMaHD_PL;
        overlay.style.display = 'flex';
        setTimeout(() => { overlay.style.opacity = '1'; }, 10);
    }
}

function closeDataDeleteModal() {
    const overlay = document.getElementById('data-delete-confirm-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
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
 * Thực thi xóa file vĩnh viễn trên Drive và cập nhật hiển thị
 */
function executeActualDelete_PL() {
    if (!fileIdToProcess) return;
    cancelDeleteScan_PL(); 
    const loading = document.getElementById("contractLoading");
    if(loading) {
        loading.style.display = "flex";
        loading.querySelector('p').textContent = "SYSTEM DELETING SCAN FILE...";
    }
    callBackend("deleteScanFilePermanently", [currentScanMaHD, fileIdToProcess])
        .then(res => {
            if(loading) loading.style.display = "none";
            if (res && res.success) {
                const item = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === currentScanMaHD);
                if (item) {
                    const files = item.scanId.split(";;").filter(f => f && !f.startsWith(fileIdToProcess + "|"));
                    item.scanId = files.join(";;");
                    PRECOMPUTED_PL_DATA = null;
                    renderExistingFiles_PL(currentScanMaHD); 
                    executeFilter_PL(false);
                }
                showToast_PL("🗑️ Đã xóa file thành công", "success");
                fileIdToProcess = ""; 
            } else alert("Lỗi xóa file: " + (res ? res.error : "Unknown"));
        })
        .catch(err => {
            if(loading) loading.style.display = "none";
            alert("Lỗi kết nối Server: " + (err.message || err));
        });
}

// ==========================================================================
// KÍCH HOẠT SEARCH & TOOLTIP NOTE (DÁN CUỐI FILE JS_Tab_PL.html)
// ==========================================================================
document.addEventListener("DOMContentLoaded", function() {
    // 1. Kích hoạt Search Engine
    const inputField0PL = document.getElementById("field0-pl");
    if (inputField0PL) {
        inputField0PL.addEventListener("input", debounce(() => {
            filterField0_PL(true); 
        }, 200));
    }

    // 2. Kích hoạt Tooltip Note (Hover hiện ghi chú)
    // Biến globalTooltip và tooltipTimeout đã lấy từ file JS_Variables
    const dashboardContainer = document.getElementById('dropdown-field0-pl');
    if (dashboardContainer) {
        dashboardContainer.addEventListener('mouseover', function(e) {
            const row = e.target.closest('.hoc-tooltip');
            if (!row) return;

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

        dashboardContainer.addEventListener('mouseout', () => {
            clearTimeout(tooltipTimeout);
            globalTooltip.classList.remove('show-tooltip');
        });

        dashboardContainer.addEventListener('scroll', () => {
            globalTooltip.classList.remove('show-tooltip');
        }, { passive: true });
    }
    const dropZone = document.getElementById('scan-drop-zone');
    const fileInput = document.getElementById('scan-file-input');

    if (dropZone && fileInput) {
        // 1. Click vào vùng zone -> Bật hộp thoại chọn file
        dropZone.addEventListener('click', () => fileInput.click());

        // 2. Lắng nghe khi file được chọn từ hộp thoại
        fileInput.addEventListener('change', (e) => {
            handleFilesSelected(e.target.files);
            fileInput.value = ""; // Reset để có thể chọn lại cùng 1 file nếu muốn
        });

        // 3. Hiệu ứng khi kéo file lơ lửng trên vùng drop
        dropZone.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            dropZone.classList.add('dragover'); 
        });

        // 4. Khi kéo file ra khỏi vùng drop
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

        // 5. Khi thả file vào vùng drop
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault(); 
            dropZone.classList.remove('dragover');
            handleFilesSelected(e.dataTransfer.files);
        });
    }
});

function handleFilesSelected(files) {
    if (!files || !files.length) return;
    
    // CHỈ CHO PHÉP PDF VÀ EXCEL (.xls, .xlsx)
    const incomingFiles = Array.from(files).filter(f => {
        const name = f.name.toLowerCase();
        return f.type === "application/pdf" || name.endsWith(".xls") || name.endsWith(".xlsx");
    });
    
    if (incomingFiles.length === 0) {
        showToast_PL("⚠️ Sếp chỉ được chọn định dạng PDF hoặc Excel!", "error");
        return;
    }

    incomingFiles.forEach(newFile => {
        const isDuplicate = currentScanFiles.some(oldFile => 
            oldFile.name === newFile.name && oldFile.size === newFile.size
        );
        if (!isDuplicate) currentScanFiles.push(newFile);
    });

    updateScanQueueUI();
}