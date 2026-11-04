
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
 * ĐIỀU PHỐI PREVIEW DOCK: HIỂN THỊ TỨC THÌ, CHỐNG KẸT OFFLINE VÀ BẢO ĐẢM 100% MỞ KHUNG
 */
let currentPreviewFileId_PL = "";

// ==========================================================================
// STATE MANAGEMENT & CONTROLLER CHO VIEWPORT THAO TÁC PREVIEW (ZOOM & PAN)
// ==========================================================================
const DEFAULT_PRV_ZOOM = 1; // Tăng tỷ lệ zoom mặc định lên 118% loại bỏ lề thừa và phóng to chữ

let prvViewportState = {
    zoom: DEFAULT_PRV_ZOOM,
    panX: 0,
    panY: 0,
    minZoom: 1.0,
    maxZoom: 4.5,
    isDragging: false,
    startX: 0,
    startY: 0
};

let prvWheelYieldTimer = null;
let isPrvGlobalListenerBound = false;

/**
 * Cân đối 3 khoảng trống đều nhau tuyệt đối: Lề trái == Khe giữa == Lề phải
 */
function syncPrvSplitLayout_PL() {
    const tabPL = document.getElementById("tab-plhd");
    const panel = document.getElementById("pl-dock-preview-panel");
    const formContainer = tabPL ? tabPL.querySelector(".form-container") : null;
    if (!tabPL || !panel || !formContainer) return;

    if (window.innerWidth >= 1024) {
        const screenW = window.innerWidth;
        
        let prvW = Math.min(760, Math.max(520, Math.round(screenW * 0.38)));
        const minGap = 25;
        let dashW = Math.min(1100, screenW - prvW - (3 * minGap));
        if (dashW < 520) {
            prvW = Math.max(460, Math.round(screenW * 0.35));
            dashW = Math.max(500, screenW - prvW - (3 * minGap));
        }

        const G = Math.max(15, Math.floor((screenW - dashW - prvW) / 3));

        // 🚀 ĐỒNG BỘ ĐỈNH VÀ ĐÁY THẲNG HÀNG CHÍNH XÁC VỚI KHUNG DASHBOARD (BỎ VÙNG NGÀY THÁNG)
        const dashRect = formContainer.getBoundingClientRect();
        panel.style.top = `${dashRect.top}px`;
        panel.style.height = `${dashRect.height}px`;

        panel.style.width = `${prvW}px`;
        panel.style.right = `${G}px`;

        tabPL.style.setProperty('align-items', 'flex-start', 'important');
        formContainer.style.setProperty('margin-top', '90px', 'important');
        formContainer.style.setProperty('margin-bottom', '90px', 'important');
        formContainer.style.setProperty('margin-right', '0', 'important');
        formContainer.style.setProperty('margin-left', `${G}px`, 'important');
        formContainer.style.setProperty('width', `${dashW}px`, 'important');
        formContainer.style.setProperty('max-width', '1100px', 'important');
    } else {
        panel.style.removeProperty('top');
        panel.style.removeProperty('height');
        panel.style.removeProperty('width');
        panel.style.removeProperty('right');
        formContainer.style.removeProperty('width');
        formContainer.style.removeProperty('max-width');
        formContainer.style.removeProperty('margin-left');
    }
}

/**
 * Thuật toán chặn biên (Clamping): Triệt tiêu khoảng trống xanh/đen, giữ tài liệu luôn khít khung
 */
function clampPrvPan() {
    const bodyContainer = document.querySelector("#pl-dock-preview-panel .dock-preview-body");
    if (!bodyContainer) return;

    const W = bodyContainer.clientWidth;
    const H = bodyContainer.clientHeight;
    const minPanX = W * (1 - prvViewportState.zoom);
    const minPanY = H * (1 - prvViewportState.zoom);

    if (prvViewportState.zoom <= 1.0) {
        prvViewportState.panX = 0;
        prvViewportState.panY = 0;
        return;
    }

    prvViewportState.panX = Math.min(0, Math.max(minPanX, prvViewportState.panX));
    prvViewportState.panY = Math.min(0, Math.max(minPanY, prvViewportState.panY));
}

/**
 * Cập nhật tọa độ transform GPU của iframe
 */
function applyPrvTransform() {
    const iframe = document.getElementById("preview-file-iframe");
    const overlay = document.getElementById("preview-interaction-overlay");
    if (!iframe) return;

    if (prvViewportState.zoom <= 1.01) {
        prvViewportState.zoom = 1.0;
        prvViewportState.panX = 0;
        prvViewportState.panY = 0;
        iframe.style.transformOrigin = "0 0";
        iframe.style.transform = "none";

        if (overlay && !prvViewportState.isDragging) {
            overlay.style.pointerEvents = "none";
            overlay.style.cursor = "default";
        }
    } else {
        clampPrvPan();
        iframe.style.transformOrigin = "0 0";
        iframe.style.transform = `translate3d(${prvViewportState.panX}px, ${prvViewportState.panY}px, 0) scale(${prvViewportState.zoom})`;

        if (overlay) {
            overlay.style.pointerEvents = "auto";
            overlay.style.cursor = prvViewportState.isDragging ? "grabbing" : "grab";
        }
    }
}

/**
 * Reset vị trí hiển thị và hệ số zoom về 1.0x ban đầu
 */
function resetPrvTransform() {
    prvViewportState.zoom = DEFAULT_PRV_ZOOM;
    prvViewportState.panX = 0;
    prvViewportState.panY = 0;
    prvViewportState.isDragging = false;
    applyPrvTransform();
}

/**
 * Lõi tính toán tỷ lệ zoom theo tâm trỏ chuột (Focal-point Zoom)
 */
function executePrvZoom(deltaY, clientX, clientY) {
    const bodyContainer = document.querySelector("#pl-dock-preview-panel .dock-preview-body");
    const overlay = document.getElementById("preview-interaction-overlay");
    if (!bodyContainer) return;

    if (overlay) overlay.style.pointerEvents = "auto";

    const rect = bodyContainer.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const zoomFactor = deltaY < 0 ? 1.15 : (1 / 1.15);
    const prevZoom = prvViewportState.zoom;
    let nextZoom = Math.min(prvViewportState.maxZoom, Math.max(prvViewportState.minZoom, prevZoom * zoomFactor));

    if (nextZoom < 1.05) nextZoom = 1.0;

    prvViewportState.panX = mouseX - (mouseX - prvViewportState.panX) * (nextZoom / prevZoom);
    prvViewportState.panY = mouseY - (mouseY - prvViewportState.panY) * (nextZoom / prevZoom);
    prvViewportState.zoom = nextZoom;

    applyPrvTransform();
}

/**
 * Khởi tạo bộ điều khiển tương tác (Chặn zoom trình duyệt, hỗ trợ kéo chuột trái khi zoom và cuộn đa trang tự nhiên)
 */
function initPrvViewportInteraction() {
    const bodyContainer = document.querySelector("#pl-dock-preview-panel .dock-preview-body");
    const panel = document.getElementById("pl-dock-preview-panel");
    if (!bodyContainer || !panel) return;

    let overlay = document.getElementById("preview-interaction-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "preview-interaction-overlay";
        overlay.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; pointer-events: none; background: transparent; touch-action: none;";
        bodyContainer.appendChild(overlay);

        // 1. KÉO THẢ DI CHUYỂN BẰNG CHUỘT TRÁI (PAN)
        overlay.addEventListener("pointerdown", (e) => {
            if (e.button !== 0) return;
            e.preventDefault();

            prvViewportState.isDragging = true;
            prvViewportState.startX = e.clientX - prvViewportState.panX;
            prvViewportState.startY = e.clientY - prvViewportState.panY;

            overlay.setPointerCapture(e.pointerId);
            overlay.style.cursor = "grabbing";
        });

        overlay.addEventListener("pointermove", (e) => {
            if (!prvViewportState.isDragging) return;
            e.preventDefault();

            prvViewportState.panX = e.clientX - prvViewportState.startX;
            prvViewportState.panY = e.clientY - prvViewportState.startY;

            applyPrvTransform();
        });

        const stopDrag = (e) => {
            if (!prvViewportState.isDragging) return;
            prvViewportState.isDragging = false;
            try { overlay.releasePointerCapture(e.pointerId); } catch(err) {}
            applyPrvTransform();
        };

        overlay.addEventListener("pointerup", stopDrag);
        overlay.addEventListener("pointercancel", stopDrag);

        // Nhấp đúp chuột: Khôi phục lại 1x tức thì để cuộn tài liệu 13 trang tự nhiên
        overlay.addEventListener("dblclick", (e) => {
            e.preventDefault();
            resetPrvTransform();
        });

        // 2. ZOOM & CUỘN TRÊN LỚP OVERLAY
        overlay.addEventListener("wheel", (e) => {
            const isZoomKey = e.ctrlKey || e.metaKey;

            if (isZoomKey) {
                // Chặn zoom trình duyệt ngoài, chỉ zoom vùng prv
                e.preventDefault();
                e.stopPropagation();
                executePrvZoom(e.deltaY, e.clientX, e.clientY);
            } else {
                // LĂN CHUỘT THƯỜNG: Nhả overlay 350ms để luồng con lăn đi thẳng vào iframe cuộn qua các trang 1 -> 13
                overlay.style.pointerEvents = "none";
                clearTimeout(prvWheelYieldTimer);
                prvWheelYieldTimer = setTimeout(() => {
                    if (prvViewportState.zoom > 1.01) {
                        overlay.style.pointerEvents = "auto";
                    }
                }, 350);
            }
        }, { passive: false });
    }

    // 3. ĐĂNG KÝ HỆ THỐNG PHÒNG THỦ CHỐNG CƯỚP FOCUS & BẮT PHÍM TOÀN CỤC (CHỈ GÁN 1 LẦN)
    if (!isPrvGlobalListenerBound) {
        isPrvGlobalListenerBound = true;

        // Thu hồi focus về window chính ngay lập tức nếu iframe cố gắng cướp focus bàn phím
        window.addEventListener("blur", () => {
            setTimeout(() => {
                const activeEl = document.activeElement;
                if (activeEl && activeEl.id === "preview-file-iframe") {
                    activeEl.blur();
                    window.focus();
                }
            }, 0);
        });

        // Di chuột trên vùng khung preview tự động giải phóng focus của iframe
        bodyContainer.addEventListener("mousemove", () => {
            const activeEl = document.activeElement;
            if (activeEl && activeEl.id === "preview-file-iframe") {
                activeEl.blur();
                window.focus();
            }
        });

        // Bắt đầu giữ phím Ctrl/Cmd: Bật ngay lập tức overlay để đón đầu cử chỉ con lăn chuột
        window.addEventListener("keydown", (e) => {
            if (e.key === "Control" || e.key === "Meta" || e.ctrlKey || e.metaKey) {
                const currentPanel = document.getElementById("pl-dock-preview-panel");
                if (currentPanel && currentPanel.style.display !== "none") {
                    const currentOverlay = document.getElementById("preview-interaction-overlay");
                    if (currentOverlay) {
                        currentOverlay.style.pointerEvents = "auto";
                    }
                }
            }
        }, true);

        // Nhả phím Ctrl/Cmd: Trả lại trạng thái cuộn tự nhiên nếu đang ở 1x
        window.addEventListener("keyup", (e) => {
            if ((e.key === "Control" || e.key === "Meta") && prvViewportState.zoom <= 1.01) {
                const currentOverlay = document.getElementById("preview-interaction-overlay");
                if (currentOverlay && !prvViewportState.isDragging) {
                    currentOverlay.style.pointerEvents = "none";
                }
            }
        }, true);

        // Chặn đứng hoàn toàn Touchpad Pinch & Ctrl+Wheel toàn cục khi con trỏ nằm trong khung prv
        window.addEventListener("wheel", (e) => {
            if (e.ctrlKey || e.metaKey) {
                const currentPanel = document.getElementById("pl-dock-preview-panel");
                if (currentPanel && currentPanel.style.display !== "none") {
                    const rect = currentPanel.getBoundingClientRect();
                    const isInsidePrv = (
                        e.clientX >= rect.left && e.clientX <= rect.right &&
                        e.clientY >= rect.top && e.clientY <= rect.bottom
                    );

                    if (isInsidePrv) {
                        e.preventDefault();
                        e.stopPropagation();
                        executePrvZoom(e.deltaY, e.clientX, e.clientY);
                    }
                }
            }
        }, { passive: false, capture: true });
    }
}

/**
 * ĐIỀU PHỐI PREVIEW DOCK: HIỂN THỊ TỨC THÌ, CHỐNG TẢI LẠI TRÙNG LẶP & ĐỒNG BỘ LAYOUT DASHBOARD
 */
function viewScanFile_PL(id, name, targetRowElement = null) {
    if (!id || id === "undefined") return;
    let targetId = id;
    let targetName = (name && name !== "undefined") ? name.trim() : "";

    // Bóc tách ID nếu chuỗi có định dạng tổng hợp
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
    const iframe = document.getElementById("preview-file-iframe");
    const nameEl = document.getElementById("preview-file-name");
    const extBtn = document.getElementById("preview-btn-external");
    const dlBtn = document.getElementById("preview-btn-download");
    const copyBtn = document.getElementById("preview-btn-copy");
    const formContainer = tabPL ? tabPL.querySelector(".form-container") : null;

    if (!panel || !iframe) return;

    // Khởi tạo và reset vị trí pan/zoom về gốc khi mở file
    initPrvViewportInteraction();
    resetPrvTransform();

    // CHỐNG TẢI LẠI TRÙNG LẶP: Nếu đang mở đúng file này và dock đang hiển thị thì chỉ cập nhật highlight
    if (currentPreviewFileId_PL === targetId && tabPL && tabPL.classList.contains("split-preview-active")) {
        document.querySelectorAll('#dropdown-field0-pl .hoc-tooltip').forEach(r => r.classList.remove('is-previewing-row'));
        if (targetRowElement) {
            targetRowElement.classList.add('is-previewing-row');
        }
        return;
    }

    // Tự động tìm lại tên file thực tế từ SYSTEM_DATA nếu chưa có
    if (!targetName && typeof SYSTEM_DATA !== "undefined" && SYSTEM_DATA?.pl?.field0) {
        for (const item of SYSTEM_DATA.pl.field0) {
            const scanStr = String(item.scanId || "");
            if (scanStr.includes(targetId)) {
                const matchedEntry = scanStr.split(";;").find(entry => entry.startsWith(targetId + "|"));
                if (matchedEntry) {
                    targetName = matchedEntry.split("|")[1]?.trim() || "";
                    break;
                }
            }
        }
    }
    if (!targetName) targetName = "Tệp đính kèm.pdf";

    const fileViewUrl = `https://drive.google.com/file/d/${targetId}/view`;

    // 1. Gán tiêu đề & cấu hình nút hành động
    if (nameEl) nameEl.textContent = targetName;
    if (extBtn) extBtn.onclick = () => window.open(fileViewUrl, '_blank');
    if (dlBtn) dlBtn.onclick = (e) => downloadScanFile_PL(targetId, e);

    if (copyBtn) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(fileViewUrl);
                showToast_PL("🔗 Đã sao chép liên kết file!", "success");
            } catch (err) {
                const tmp = document.createElement("input");
                tmp.value = fileViewUrl;
                document.body.appendChild(tmp);
                tmp.select();
                document.execCommand("copy");
                document.body.removeChild(tmp);
                showToast_PL("🔗 Đã sao chép liên kết file!", "success");
            }
        };
    }

    // 2. NGẮT HIỂN THỊ TỨC THỜI (0ms) & CHỜ DRIVE THU HỒI THANH CÔNG CỤ
    currentPreviewFileId_PL = targetId;
    const spinner = document.getElementById("preview-loading-spinner");
    if (spinner) spinner.style.display = "flex";

    iframe.style.transition = "none";
    iframe.style.opacity = "0";
    iframe.offsetHeight; // Kích hoạt reflow
    iframe.style.transition = "opacity 0.3s ease";

    let hasRendered = false;
    const revealIframe = () => {
        if (hasRendered) return;
        hasRendered = true;
        if (spinner) spinner.style.display = "none";
        iframe.style.opacity = "1";
    };

    iframe.onload = () => setTimeout(revealIframe, 950);
    setTimeout(revealIframe, 1400); // Chốt chặn an toàn

    iframe.src = `https://drive.google.com/file/d/${targetId}/preview`;

    // 3. Highlight dòng dữ liệu
    document.querySelectorAll('#dropdown-field0-pl .hoc-tooltip').forEach(r => r.classList.remove('is-previewing-row'));
    if (targetRowElement) {
        targetRowElement.classList.add('is-previewing-row');
    }

    // 4. CÂN ĐỐI ĐỒNG BỘ 3 KHE HỞ VÀ MỞ KHUNG PREVIEW
    panel.style.display = "flex";
    syncPrvSplitLayout_PL();

    panel.offsetHeight;
    panel.style.setProperty('transform', 'translate3d(0, 0, 0)', 'important');
    panel.style.setProperty('opacity', '1', 'important');
    panel.style.setProperty('pointer-events', 'auto', 'important');

    if (tabPL) tabPL.classList.add("split-preview-active");
}

/**
 * ĐÓNG DOCK PREVIEW: TRƯỢT THẲNG HÀNG TRÊN TRỤC NGANG VỀ TÂM VỚI MAX-WIDTH 1100PX
 */
function closePreviewModal_PL() {
    const tabPL = document.getElementById("tab-plhd");
    const panel = document.getElementById("pl-dock-preview-panel");
    const iframe = document.getElementById("preview-file-iframe");
    const formContainer = tabPL ? tabPL.querySelector(".form-container") : null;

    currentPreviewFileId_PL = "";
    resetPrvTransform();

    document.querySelectorAll('#dropdown-field0-pl .hoc-tooltip').forEach(r => r.classList.remove('is-previewing-row'));

    if (panel) {
        panel.style.setProperty('transform', 'translate3d(calc(100% + 60px), 0, 0)', 'important');
        panel.style.setProperty('opacity', '0', 'important');
        panel.style.setProperty('pointer-events', 'none', 'important');
    }

    if (formContainer && tabPL && tabPL.classList.contains("split-preview-active")) {
        const defaultWidth = Math.min(1100, window.innerWidth - 30);
        const centerLeft = Math.max(15, (window.innerWidth - defaultWidth) / 2);

        formContainer.style.setProperty('width', `${defaultWidth}px`, 'important');
        formContainer.style.setProperty('max-width', '1100px', 'important');
        formContainer.style.setProperty('margin-left', `${centerLeft}px`, 'important');

        setTimeout(() => {
            formContainer.style.removeProperty('max-width');
            formContainer.style.removeProperty('width');
            formContainer.style.removeProperty('margin-top');
            formContainer.style.removeProperty('margin-bottom');
            formContainer.style.removeProperty('margin-right');
            formContainer.style.removeProperty('margin-left');
            tabPL.style.removeProperty('align-items');
            if (panel && !tabPL.classList.contains("split-preview-active")) {
                panel.style.display = "none";
                panel.style.removeProperty('top');
                panel.style.removeProperty('height');
                panel.style.removeProperty('right');
                panel.style.removeProperty('width');
                if (iframe) {
                    iframe.src = "";
                    iframe.style.opacity = "0";
                }
            }
        }, 400);
    } else if (panel) {
        setTimeout(() => {
            panel.style.display = "none";
            panel.style.removeProperty('top');
            panel.style.removeProperty('height');
            panel.style.removeProperty('right');
            panel.style.removeProperty('width');
            if (iframe) {
                iframe.src = "";
                iframe.style.opacity = "0";
            }
        }, 400);
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