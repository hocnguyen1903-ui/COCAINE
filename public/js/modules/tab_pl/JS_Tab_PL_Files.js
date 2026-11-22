
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
 * Mở trực tiếp file scan trên Google Drive (Tab mới trình duyệt)
 */
function handleViewMainFile_PL(maHD, rawScanData) {
    if (!rawScanData) return;
    const files = rawScanData.split(";;").filter(Boolean);
    if (files.length === 0) return;

    let mainFileId = files[0].split("|")[0].trim();
    if (files.length > 1) {
        if (maHD.startsWith("PL")) {
            const plPart = maHD.split(" - ")[0]; 
            const match = files.find(f => f.split("|")[1].toUpperCase().includes(plPart.toUpperCase()));
            if (match) mainFileId = match.split("|")[0].trim();
        } else {
            const parts = maHD.match(/(\d+)\/(\d+)\/HĐTCXD-(.*?)\//);
            if (parts) {
                const key = `${parts[3]}_${parts[1]}_${parts[2]}`.toUpperCase();
                const match = files.find(f => f.split("|")[1].toUpperCase().includes(key));
                if (match) mainFileId = match.split("|")[0].trim();
            }
        }
    }
    window.open(`https://drive.google.com/file/d/${mainFileId}/view`, '_blank');
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
                    <div class="existing-file-info" onclick="viewScanFile_PL('${id}', '${escapeStr(name)}')">
    <div class="file-note-pop">Click to preview</div>
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
 * ĐIỀU PHỐI PREVIEW DOCK: HIỂN THỊ TỨC THÌ, CHỐNG KẸT OFFLINE VÀ BẢO ĐẢM 100% MỞ KHUNG
 */
// ==========================================================================
// 6. ĐIỀU PHỐI DOCK PREVIEW & TÍCH HỢP BCONS NATIVE VIEWER
// ==========================================================================

let currentPreviewFileId_PL = "";

const UI_BASE_ZOOM = 0.8;

function getMasterPanelWidth_PL() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--master-panel-width').trim();
    return parseInt(raw, 10) || 1040;
}

function syncPrvSplitLayout_PL(skipViewerRefresh = false, prepareHiddenState = false) {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (!skipViewerRefresh && window.BconsViewer && typeof window.BconsViewer.refreshFitWidth === "function") {
            window.BconsViewer.refreshFitWidth();
        }
        return;
    }
    const tabPL = document.getElementById("tab-plhd");
    const panel = document.getElementById("pl-dock-preview-panel");
    const formContainer = tabPL ? tabPL.querySelector(".form-container") : null;
    if (!tabPL || !panel || !formContainer) return;

    const screenW = Math.round(window.innerWidth / UI_BASE_ZOOM);
    const masterW = getMasterPanelWidth_PL();
    const isVerticalOrMobile = (window.innerWidth <= 960) || (window.innerWidth < window.innerHeight);

    // ĐỌC LAYOUT TRƯỚC KHI GHI STYLE (Loại bỏ Forced Synchronous Layout)
    const fcTop = formContainer.offsetTop;
    const fcHeight = formContainer.offsetHeight;

    // TRƯỜNG HỢP 1: MÀN HÌNH DỌC / ĐIỆN THOẠI
    if (isVerticalOrMobile) {
        const screenH = Math.round(window.innerHeight / UI_BASE_ZOOM);
        const singleW = Math.min(masterW, Math.max(360, screenW - 30));
        const singleRight = Math.max(15, Math.round((screenW - singleW) / 2));
        const singleTop = 85;
        const singleH = Math.max(480, screenH - singleTop - 20);

        panel.style.setProperty('min-width', '320px', 'important');
        panel.style.setProperty('top', `${singleTop}px`, 'important');
        panel.style.setProperty('height', `${singleH}px`, 'important');
        panel.style.setProperty('width', `${singleW}px`, 'important');
        panel.style.setProperty('right', `${singleRight}px`, 'important');

        if (prepareHiddenState) {
            panel.style.setProperty('transform', 'translate3d(520px, 0, 0)', 'important');
            panel.style.setProperty('opacity', '0', 'important');
            panel.style.setProperty('pointer-events', 'none', 'important');
            return;
        }

        formContainer.style.setProperty('width', `${singleW}px`, 'important');
        formContainer.style.setProperty('max-width', `${singleW}px`, 'important');
        formContainer.style.setProperty('opacity', '0', 'important');
        formContainer.style.setProperty('pointer-events', 'none', 'important');

        panel.style.setProperty('transform', 'translate3d(0, 0, 0)', 'important');
        panel.style.setProperty('opacity', '1', 'important');
        panel.style.setProperty('pointer-events', 'auto', 'important');

        if (!skipViewerRefresh && window.BconsViewer && typeof window.BconsViewer.refreshFitWidth === "function") {
            window.BconsViewer.refreshFitWidth();
        }
        return;
    }

    // TRƯỜNG HỢP 2: MÀN HÌNH NGANG RỘNG (HIỂN THỊ SONG SONG 2 KHUNG 1000PX)
    const minGap = 20;
    const equalW = Math.min(masterW, Math.max(420, Math.floor((screenW - (3 * minGap)) / 2)));
    const G = Math.max(12, Math.floor((screenW - (2 * equalW)) / 3));

    panel.style.setProperty('min-width', '420px', 'important');
    panel.style.setProperty('top', `${fcTop}px`, 'important');
    panel.style.setProperty('height', `${fcHeight}px`, 'important');
    panel.style.setProperty('width', `${equalW}px`, 'important');
    panel.style.setProperty('right', `${G}px`, 'important');

    if (prepareHiddenState) {
        panel.style.setProperty('transform', 'translate3d(520px, 0, 0)', 'important');
        panel.style.setProperty('opacity', '0', 'important');
        panel.style.setProperty('pointer-events', 'none', 'important');
        return;
    }

    formContainer.style.setProperty('opacity', '1', 'important');
    formContainer.style.setProperty('pointer-events', 'auto', 'important');
    formContainer.style.setProperty('margin-left', `${G}px`, 'important');
    formContainer.style.setProperty('margin-right', 'auto', 'important');
    formContainer.style.setProperty('width', `${equalW}px`, 'important');
    formContainer.style.setProperty('max-width', `${equalW}px`, 'important');

    panel.style.setProperty('transform', 'translate3d(0, 0, 0)', 'important');
    panel.style.setProperty('opacity', '1', 'important');
    panel.style.setProperty('pointer-events', 'auto', 'important');

    if (!skipViewerRefresh && window.BconsViewer && typeof window.BconsViewer.refreshFitWidth === "function") {
        window.BconsViewer.refreshFitWidth();
    }
}

let activePanelTransitionCancel_PL = null;

function viewScanFile_PL(id, name, targetRowElement = null) {
    if (!id || id === "undefined") return;
    let targetId = id;
    let targetName = (name && name !== "undefined") ? name.trim() : "";

    if (id.includes(";;")) {
        const fileEntries = id.split(";;").filter(Boolean);
        targetId = fileEntries[0].split("|")[0].trim();
        if (!targetName && fileEntries[0].includes("|")) targetName = fileEntries[0].split("|")[1].trim();
        if (name && name.startsWith("PL")) {
            const plNo = name.split(" - ")[0].toUpperCase(); 
            const match = fileEntries.find(f => f.toUpperCase().includes(plNo));
            if (match) {
                targetId = match.split("|")[0].trim();
                targetName = match.split("|")[1]?.trim() || targetName;
            }
        }
    } else if (id.includes("|")) {
        const parts = id.split("|");
        targetId = parts[0].trim();
        if (!targetName) targetName = parts[1]?.trim() || "";
    }

    if (!targetId) return;

    const tabPL = document.getElementById("tab-plhd");
    const panel = document.getElementById("pl-dock-preview-panel");
    const nameEl = document.getElementById("preview-file-name");

    if (!panel) return;

    const wasAlreadyOpen = Boolean(tabPL && tabPL.classList.contains("split-preview-active"));

    if (currentPreviewFileId_PL === targetId && wasAlreadyOpen) {
        document.querySelectorAll('#dropdown-field0-pl .hoc-tooltip').forEach(r => r.classList.remove('is-previewing-row'));
        if (targetRowElement) targetRowElement.classList.add('is-previewing-row');
        return;
    }

    currentPreviewFileId_PL = targetId;

    if (!targetName && typeof SYSTEM_DATA !== "undefined" && SYSTEM_DATA?.pl?.field0) {
        for (const item of SYSTEM_DATA.pl.field0) {
            const scanStr = String(item.scanId || "");
            if (scanStr.includes(targetId)) {
                const matchedEntry = scanStr.split(";;").find(entry => entry.startsWith(targetId + "|"));
                if (matchedEntry) { targetName = matchedEntry.split("|")[1]?.trim() || ""; break; }
            }
        }
    }
    if (!targetName) targetName = "Tệp đính kèm.pdf";

    if (nameEl) nameEl.textContent = targetName;

    document.querySelectorAll('#dropdown-field0-pl .hoc-tooltip').forEach(r => r.classList.remove('is-previewing-row'));
    if (targetRowElement) targetRowElement.classList.add('is-previewing-row');

    if (activePanelTransitionCancel_PL) {
        activePanelTransitionCancel_PL();
        activePanelTransitionCancel_PL = null;
    }

    if (!wasAlreadyOpen) {
        // BƯỚC 1: Đặt sẵn kích thước & trạng thái xuất phát offscreen trước khi bật transition
        panel.style.display = "flex";
        syncPrvSplitLayout_PL(true, true);
        void panel.offsetWidth;

        // Tạo cổng chờ transition (460ms) để CPU chỉ parse/render PDF sau khi trượt xong
        if (window.BconsViewer && typeof window.BconsViewer.setTransitionGate === "function") {
            const gatePromise = new Promise(resolve => {
                let done = false;
                let timer = null;
                const finish = () => {
                    if (done) return;
                    done = true;
                    panel.removeEventListener("transitionend", onEnd);
                    clearTimeout(timer);
                    if (activePanelTransitionCancel_PL === finish) activePanelTransitionCancel_PL = null;
                    resolve();
                };
                const onEnd = (e) => {
                    if (e.target === panel && e.propertyName === "transform") finish();
                };
                panel.addEventListener("transitionend", onEnd);
                timer = setTimeout(finish, 470);
                activePanelTransitionCancel_PL = finish;
            });
            window.BconsViewer.setTransitionGate(gatePromise);
        }

        // Khởi chạy I/O (IDB / Drive fetch) ngay tại t=0ms song song với animation
        if (window.BconsViewer) {
            window.BconsViewer.loadFile(targetId, targetName);
        }

        // BƯỚC 2: Kích hoạt animation trượt đồng bộ trên khung hình tiếp theo
        requestAnimationFrame(() => {
            if (currentPreviewFileId_PL !== targetId) return;
            if (tabPL) tabPL.classList.add("split-preview-active");
            syncPrvSplitLayout_PL(true, false);
        });
    } else {
        syncPrvSplitLayout_PL(true, false);
        if (window.BconsViewer) {
            if (typeof window.BconsViewer.setTransitionGate === "function") {
                window.BconsViewer.setTransitionGate(Promise.resolve());
            }
            window.BconsViewer.loadFile(targetId, targetName);
        }
    }
}

function closePreviewModal_PL(isInstant = false) {
    const tabPL = document.getElementById("tab-plhd");
    const panel = document.getElementById("pl-dock-preview-panel");
    const formContainer = tabPL ? tabPL.querySelector(".form-container") : null;

    currentPreviewFileId_PL = "";

    if (activePanelTransitionCancel_PL) {
        activePanelTransitionCancel_PL();
        activePanelTransitionCancel_PL = null;
    }

    document.querySelectorAll('#dropdown-field0-pl .hoc-tooltip').forEach(r => r.classList.remove('is-previewing-row'));

    if (isInstant) {
        if (panel) {
            panel.style.display = "none";
            panel.style.removeProperty('top');
            panel.style.removeProperty('height');
            panel.style.removeProperty('right');
            panel.style.removeProperty('width');
        }
        if (formContainer) {
            formContainer.style.removeProperty('width');
            formContainer.style.removeProperty('max-width');
            formContainer.style.removeProperty('margin-left');
            formContainer.style.removeProperty('margin-right');
            formContainer.style.removeProperty('opacity');
            formContainer.style.removeProperty('pointer-events');
        }
        if (tabPL) tabPL.classList.remove("split-preview-active");

        setTimeout(() => {
            if (window.BconsViewer) window.BconsViewer.close();
        }, 500);
        return;
    }

    // Dừng mọi fetch/render đang chạy nhưng dời việc giải phóng DOM & PDF sang sau khi trượt đóng xong
    if (window.BconsViewer && typeof window.BconsViewer.abortActiveTasks === "function") {
        window.BconsViewer.abortActiveTasks();
    }

    if (panel) {
        panel.style.setProperty('transform', 'translate3d(calc(100% + 60px), 0, 0)', 'important');
        panel.style.setProperty('opacity', '0', 'important');
        panel.style.setProperty('pointer-events', 'none', 'important');
    }

    if (formContainer && tabPL && tabPL.classList.contains("split-preview-active")) {
        formContainer.style.setProperty('opacity', '1', 'important');
        formContainer.style.setProperty('pointer-events', 'auto', 'important');

        const virtualW = Math.round(window.innerWidth / UI_BASE_ZOOM);
        const masterW = getMasterPanelWidth_PL();
        const defaultWidth = Math.min(masterW, virtualW - 30);
        const centerLeft = Math.max(15, Math.round((virtualW - defaultWidth) / 2));

        formContainer.style.setProperty('width', `${defaultWidth}px`, 'important');
        formContainer.style.setProperty('max-width', `${masterW}px`, 'important');
        formContainer.style.setProperty('margin-left', `${centerLeft}px`, 'important');

        setTimeout(() => {
            if (tabPL.classList.contains("split-preview-active")) return;
            if (window.BconsViewer) window.BconsViewer.close();

            formContainer.style.removeProperty('max-width');
            formContainer.style.removeProperty('width');
            formContainer.style.removeProperty('margin-left');
            formContainer.style.removeProperty('margin-right');

            if (panel) {
                panel.style.display = "none";
                panel.style.removeProperty('top');
                panel.style.removeProperty('height');
                panel.style.removeProperty('right');
                panel.style.removeProperty('width');
            }
        }, 420);
    } else if (panel) {
        setTimeout(() => {
            if (tabPL && tabPL.classList.contains("split-preview-active")) return;
            if (window.BconsViewer) window.BconsViewer.close();
            panel.style.display = "none";
            panel.style.removeProperty('top');
            panel.style.removeProperty('height');
            panel.style.removeProperty('right');
            panel.style.removeProperty('width');
        }, 420);
    }

    if (tabPL) tabPL.classList.remove("split-preview-active");
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

    // 2. KÍCH HOẠT TOOLTIP NOTE KHI HOVER (DÒNG DỮ LIỆU + 2 DẤU CHẤM HĐ / PĐG)
    const dashboardContainer = document.getElementById('dropdown-field0-pl');
    if (dashboardContainer && typeof globalTooltip !== 'undefined') {
        let activeTooltipTarget = null;

        dashboardContainer.addEventListener('mouseover', function(e) {
            const fileDot = e.target.closest('.file-icon');
            const row = e.target.closest('.hoc-tooltip');
            if (!row) return;

            const targetEl = fileDot || row;
            if (activeTooltipTarget === targetEl) return;
            activeTooltipTarget = targetEl;

            clearTimeout(tooltipTimeout);
            tooltipTimeout = setTimeout(() => {
                if (fileDot) {
                    const dotTitle = fileDot.getAttribute('data-dot-title');
                    const dotDesc = fileDot.getAttribute('data-dot-desc');
                    if (!dotTitle) return;

                    const isActiveDot = fileDot.classList.contains('active');
const isPendingDot = fileDot.classList.contains('pending');
const descColor = isActiveDot ? '#2ECC71' : (isPendingDot ? '#FFBA08' : '#95A1AF');

// Đổi sang dạng Micro-Chip 1 dòng
                    globalTooltip.classList.add('tooltip-compact');
                    globalTooltip.innerHTML = `
                        <span style="color: #95A1AF; font-weight: 600;">${dotTitle}</span>
                        <span style="color: rgba(255, 255, 255, 0.2); font-size: 7px; margin: 0 2px;">|</span>
                        <span style="color: ${descColor}; font-weight: 500;">${dotDesc}</span>
                    `;

                    const rect = fileDot.getBoundingClientRect();
                    const halfW = (globalTooltip.offsetWidth || 120) / 2;
                    const safeLeft = Math.min(window.innerWidth - halfW - 10, rect.left + (rect.width / 2));

                    globalTooltip.style.top = (rect.top - 10) + 'px';
                    globalTooltip.style.left = safeLeft + 'px';
                    globalTooltip.classList.add('show-tooltip');
                    return;
                }

                const hoverText = row.getAttribute('data-hovertext');
                if (!hoverText) return;

                globalTooltip.classList.remove('tooltip-compact');
                globalTooltip.innerHTML = `
                    <b>RIGHT-CLICK / HOLD TO OPEN</b>
                    ${hoverText}
                `;

                const rect = row.getBoundingClientRect();
                globalTooltip.style.top = (rect.top - 8) + 'px';
                globalTooltip.style.left = (rect.left + (rect.width / 2)) + 'px';
                globalTooltip.classList.add('show-tooltip');
            }, fileDot ? 60 : 100);
        });

        dashboardContainer.addEventListener('mouseout', function(e) {
            const currentRow = e.target.closest('.hoc-tooltip');
            const relatedRow = e.relatedTarget ? e.relatedTarget.closest('.hoc-tooltip') : null;
            const fromDot = e.target.closest('.file-icon');
            const toDot = e.relatedTarget ? e.relatedTarget.closest('.file-icon') : null;

            // Chỉ giữ nguyên tooltip khi chuột di chuyển trong cùng dòng VÀ không ra/vào 2 dấu chấm
            if (currentRow && relatedRow === currentRow && fromDot === toDot) {
                return;
            }

            activeTooltipTarget = null;
            clearTimeout(tooltipTimeout);
            globalTooltip.classList.remove('show-tooltip');
        });

        dashboardContainer.addEventListener('scroll', () => {
            activeTooltipTarget = null;
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

window.markScanFileDigitized_PL = function(fileId) {
    if (!fileId || !SYSTEM_DATA?.pl?.field0) return;

    let changedInRam = false;
    SYSTEM_DATA.pl.field0.forEach(item => {
        const scanStr = String(item.scanId || "");
        if (!scanStr.includes(fileId + "|")) return;

        const entries = scanStr.split(";;").filter(Boolean);
        let itemChanged = false;
        const updatedEntries = entries.map(entry => {
            const parts = entry.split("|");
            if (parts[0].trim() === fileId && (parts[2] || "").trim() !== "1") {
                itemChanged = true;
                return `${parts[0].trim()}|${(parts[1] || "").trim()}|1`;
            }
            return entry;
        });

        if (itemChanged) {
            item.scanId = updatedEntries.join(";;");
            changedInRam = true;
        }
    });

    if (changedInRam) {
        PRECOMPUTED_PL_DATA = null;
        localStorage.setItem('bcons_cached_system_data', JSON.stringify(SYSTEM_DATA));
        if (typeof executeFilter_PL === "function") {
            executeFilter_PL(false, false, true); // Giữ nguyên vị trí cuộn
        }
        callBackend("markScanDigitized_PL", fileId).catch(() => {});
    }
};
