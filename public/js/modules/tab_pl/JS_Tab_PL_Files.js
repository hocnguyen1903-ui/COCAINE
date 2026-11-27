// ==========================================================================
// 6. HỆ THỐNG QUẢN LÝ FILE SCAN (VIEW, UPLOAD, RENDER)
// ==========================================================================

let currentScanMode = "single"; // "single" (chuột phải vào 1 HĐ) | "batch" (kéo thả trực tiếp vào Dashboard)
let scanCollapseTimer_PL = null;
let scanProgressHideTimer_PL = null;

function showScanProgress_PL() {
    const progressContainer = document.getElementById("scan-progress-container");
    if (!progressContainer) return;
    if (scanProgressHideTimer_PL) {
        clearTimeout(scanProgressHideTimer_PL);
        scanProgressHideTimer_PL = null;
    }
    progressContainer.style.display = "block";
    void progressContainer.offsetHeight;
    progressContainer.classList.add("is-visible");
}

function hideScanProgress_PL(immediate = false) {
    const progressContainer = document.getElementById("scan-progress-container");
    if (!progressContainer) return;
    if (scanProgressHideTimer_PL) {
        clearTimeout(scanProgressHideTimer_PL);
        scanProgressHideTimer_PL = null;
    }
    progressContainer.classList.remove("is-visible");
    if (immediate) {
        progressContainer.style.display = "none";
        return;
    }
    scanProgressHideTimer_PL = setTimeout(() => {
        scanProgressHideTimer_PL = null;
        if (!progressContainer.classList.contains("is-visible")) {
            progressContainer.style.display = "none";
        }
    }, 340);
}

/**
 * Mở bảng quản lý file Scan cho một mã hợp đồng cụ thể
 */
function openScanPanel_PL(maHD) {
    closeContextMenu_PL();
    currentScanMode = "single";
    currentScanMaHD = maHD;

    const fileInput = document.getElementById("scan-file-input");
    if (fileInput) fileInput.setAttribute("accept", ".pdf, .xls, .xlsx");

    // Cập nhật tiêu đề bảng Scan
    const title = document.getElementById("sp-header-title");
    if (title) {
        title.innerHTML = `
            <span style="color: #95A1AF; font-size: 10px; font-weight: 500; letter-spacing: 0.5px;">QUẢN LÝ FILE:</span><br>
            <span style="color: #FFBA08; font-size: 13px; font-weight: 700;">${maHD}</span>
        `;
    }

    renderExistingFiles_PL(maHD);

    const scanPanel = document.getElementById("scan-panel-pl");
    if (scanPanel) {
        scanPanel.classList.add("active");
        scanPanel.style.display = "flex";
    }

    const list = document.getElementById("dropdown-field0-pl");
    if (list) list.classList.add("list-dashboard-locked");

    const searchContainer = document.getElementById("main-search-container-pl");
    if (searchContainer) searchContainer.style.zIndex = "2000";
}

/**
 * Mở bảng upload hàng loạt khi kéo thả file trực tiếp vào Dashboard (Contract only)
 */
function openBatchScanPanel_PL(droppedFiles) {
    closeContextMenu_PL();
    removeScanFile_PL(null, true);
    hideScanProgress_PL(true);
    currentScanMode = "batch";
    currentScanMaHD = "";

    const fileInput = document.getElementById("scan-file-input");
    if (fileInput) fileInput.setAttribute("accept", ".pdf");

    const title = document.getElementById("sp-header-title");
    if (title) {
        title.innerHTML = `
            <span style="color: #95A1AF; font-size: 10px; font-weight: 500; letter-spacing: 0.5px;">BATCH UPLOAD (CONTRACT ONLY):</span><br>
            <span style="color: #FFBA08; font-size: 13px; font-weight: 700;">AUTO-UPLOAD FILE</span>
        `;
    }

    const infoBox = document.getElementById("scan-current-file-info");
    if (infoBox) {
        infoBox.style.display = "none";
        infoBox.innerHTML = "";
    }

    const scanPanel = document.getElementById("scan-panel-pl");
    if (scanPanel) {
        scanPanel.classList.add("active");
        scanPanel.style.display = "flex";
    }

    const list = document.getElementById("dropdown-field0-pl");
    if (list) list.classList.add("list-dashboard-locked");

    const searchContainer = document.getElementById("main-search-container-pl");
    if (searchContainer) searchContainer.style.zIndex = "2000";

    if (droppedFiles && droppedFiles.length > 0) {
        handleFilesSelected(droppedFiles);
    }
}

/**
 * Đóng bảng Scan và dọn dẹp hàng chờ upload
 */
function closeScanPanel_PL() {
    removeScanFile_PL(null, true);
    hideScanProgress_PL(true);
    currentScanMode = "single";
    currentScanMaHD = "";
    const fileInput = document.getElementById("scan-file-input");
    if (fileInput) fileInput.setAttribute("accept", ".pdf, .xls, .xlsx");

    const scanPanel = document.getElementById("scan-panel-pl");
    if (scanPanel) scanPanel.classList.remove("active");

    const list = document.getElementById("dropdown-field0-pl");
    if (list) list.classList.remove("list-dashboard-locked");

    const searchContainer = document.getElementById("main-search-container-pl");
    if (searchContainer) searchContainer.style.zIndex = "1000";
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
            const match = files.find((f) => f.split("|")[1].toUpperCase().includes(plPart.toUpperCase()));
            if (match) mainFileId = match.split("|")[0].trim();
        } else {
            const parts = maHD.match(/(\d+)\/(\d+)\/HĐTCXD-(.*?)\//);
            if (parts) {
                const key = `${parts[3]}_${parts[1]}_${parts[2]}`.toUpperCase();
                const match = files.find((f) => f.split("|")[1].toUpperCase().includes(key));
                if (match) mainFileId = match.split("|")[0].trim();
            }
        }
    }
    window.open(`https://drive.google.com/file/d/${mainFileId}/view`, "_blank");
}

/**
 * Hiển thị danh sách các file hiện có trên Server cho mã HĐ này
 */
function renderExistingFiles_PL(maHD) {
    if (!SYSTEM_DATA || !SYSTEM_DATA.pl || !SYSTEM_DATA.pl.field0) return;

    const itemData = SYSTEM_DATA.pl.field0.find((i) => (i.display || "").split(" | ")[0].trim() === maHD);
    const infoBox = document.getElementById("scan-current-file-info");
    if (!infoBox) return;

    if (itemData && itemData.scanId && itemData.scanId.trim() !== "") {
        infoBox.style.display = "block";
        const fileList = itemData.scanId.split(";;").filter((f) => f && f.includes("|"));

        let htmlResult = "";
        fileList.forEach((fileStr) => {
            const parts = fileStr.split("|");
            const id = parts[0].trim();
            const name = parts[1] && parts[1] !== "undefined" ? parts[1].trim() : "Untitled_Scan.pdf";
            const isExcel = name.toLowerCase().match(/\.(xls|xlsx)$/);
            const iconClass = isExcel ? "bi-file-earmark-excel-fill file-excel" : "bi-file-earmark-pdf-fill file-pdf";

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

// ==========================================================================
// 6. ĐIỀU PHỐI DOCK PREVIEW & TÍCH HỢP BCONS NATIVE VIEWER
// ==========================================================================

let currentPreviewFileId_PL = "";
let activePanelTransitionCancel_PL = null;
let closePreviewTimer_PL = null;

const UI_BASE_ZOOM = 0.8;

function getMasterPanelWidth_PL() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--master-panel-width").trim();
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
    const isVerticalOrMobile = window.innerWidth <= 960 || window.innerWidth < window.innerHeight;

    // TRƯỜNG HỢP 1: MÀN HÌNH DỌC / ĐIỆN THOẠI
    if (isVerticalOrMobile) {
        const screenH = Math.round(window.innerHeight / UI_BASE_ZOOM);
        const singleW = Math.min(masterW, Math.max(360, screenW - 30));
        const singleRight = Math.max(15, Math.round((screenW - singleW) / 2));
        const singleTop = 85;
        const singleH = Math.max(480, screenH - singleTop - 20);

        panel.style.setProperty("min-width", "320px", "important");
        panel.style.setProperty("top", `${singleTop}px`, "important");
        panel.style.setProperty("height", `${singleH}px`, "important");
        panel.style.setProperty("width", `${singleW}px`, "important");
        panel.style.setProperty("right", `${singleRight}px`, "important");

        if (prepareHiddenState) {
            panel.style.setProperty("transform", "translate3d(520px, 0, 0)", "important");
            panel.style.setProperty("opacity", "0", "important");
            panel.style.setProperty("pointer-events", "none", "important");
            return;
        }

        formContainer.style.setProperty("width", `${singleW}px`, "important");
        formContainer.style.setProperty("max-width", `${singleW}px`, "important");
        formContainer.style.setProperty("opacity", "0", "important");
        formContainer.style.setProperty("pointer-events", "none", "important");

        panel.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
        panel.style.setProperty("opacity", "1", "important");
        panel.style.setProperty("pointer-events", "auto", "important");

        if (!skipViewerRefresh && window.BconsViewer && typeof window.BconsViewer.refreshFitWidth === "function") {
            window.BconsViewer.refreshFitWidth();
        }
        return;
    }

    // TRƯỜNG HỢP 2: MÀN HÌNH NGANG RỘNG
    const minGap = 20;
    const equalW = Math.min(masterW, Math.max(420, Math.floor((screenW - 3 * minGap) / 2)));
    const G = Math.max(12, Math.floor((screenW - 2 * equalW) / 3));

    if (prepareHiddenState) {
        const startW = formContainer.offsetWidth;
        const startLeft = formContainer.offsetLeft;
        const fcTop = formContainer.offsetTop;
        const fcHeight = formContainer.offsetHeight;

        formContainer.style.setProperty("animation", "none", "important");
        formContainer.style.setProperty("opacity", "1", "important");
        formContainer.style.setProperty("pointer-events", "auto", "important");
        formContainer.style.setProperty("transition", "none", "important");

        if (Math.abs(startW - equalW) <= 1) {
            formContainer.dataset.splitAnimMode = "gpu";
            formContainer.style.setProperty("margin-left", `${G}px`, "important");
            formContainer.style.setProperty("margin-right", "auto", "important");
            formContainer.style.setProperty("width", `${equalW}px`, "important");
            formContainer.style.setProperty("max-width", `${equalW}px`, "important");
            formContainer.style.setProperty(
                "transform",
                `translate3d(${Math.round(startLeft - G)}px, 0, 0)`,
                "important"
            );
        } else {
            formContainer.dataset.splitAnimMode = "width";
            formContainer.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
            formContainer.style.setProperty("margin-left", `${startLeft}px`, "important");
            formContainer.style.setProperty("margin-right", "auto", "important");
            formContainer.style.setProperty("width", `${startW}px`, "important");
            formContainer.style.setProperty("max-width", `${Math.max(startW, equalW)}px`, "important");
        }

        panel.style.setProperty("min-width", "420px", "important");
        panel.style.setProperty("top", `${fcTop}px`, "important");
        panel.style.setProperty("height", `${fcHeight}px`, "important");
        panel.style.setProperty("width", `${equalW}px`, "important");
        panel.style.setProperty("right", `${G}px`, "important");
        panel.style.setProperty("transform", "translate3d(520px, 0, 0)", "important");
        panel.style.setProperty("opacity", "0", "important");
        panel.style.setProperty("pointer-events", "none", "important");
        return;
    }

    const isOpeningPlay = Boolean(skipViewerRefresh && formContainer.dataset.splitAnimMode);

    if (isOpeningPlay) {
        const mode = formContainer.dataset.splitAnimMode;
        delete formContainer.dataset.splitAnimMode;

        if (mode === "gpu") {
            formContainer.style.setProperty(
                "transition",
                "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                "important"
            );
            formContainer.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
        } else {
            formContainer.style.setProperty(
                "transition",
                "width 0.45s cubic-bezier(0.22, 1, 0.36, 1), margin-left 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                "important"
            );
            formContainer.style.setProperty("width", `${equalW}px`, "important");
            formContainer.style.setProperty("margin-left", `${G}px`, "important");
        }

        panel.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
        panel.style.setProperty("opacity", "1", "important");
        panel.style.setProperty("pointer-events", "auto", "important");
        return;
    }

    const fcTop = formContainer.offsetTop;
    const fcHeight = formContainer.offsetHeight;

    formContainer.style.setProperty("animation", "none", "important");
    formContainer.style.setProperty("opacity", "1", "important");
    formContainer.style.setProperty("pointer-events", "auto", "important");
    formContainer.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
    formContainer.style.setProperty("margin-left", `${G}px`, "important");
    formContainer.style.setProperty("margin-right", "auto", "important");
    formContainer.style.setProperty("width", `${equalW}px`, "important");
    formContainer.style.setProperty("max-width", `${equalW}px`, "important");

    panel.style.setProperty("min-width", "420px", "important");
    panel.style.setProperty("top", `${fcTop}px`, "important");
    panel.style.setProperty("height", `${fcHeight}px`, "important");
    panel.style.setProperty("width", `${equalW}px`, "important");
    panel.style.setProperty("right", `${G}px`, "important");
    panel.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
    panel.style.setProperty("opacity", "1", "important");
    panel.style.setProperty("pointer-events", "auto", "important");

    if (!skipViewerRefresh && window.BconsViewer && typeof window.BconsViewer.refreshFitWidth === "function") {
        window.BconsViewer.refreshFitWidth();
    }
}

function viewScanFile_PL(id, name, targetRowElement = null) {
    if (!id || id === "undefined") return;
    let targetId = id;
    let targetName = name && name !== "undefined" ? name.trim() : "";

    if (id.includes(";;")) {
        const fileEntries = id.split(";;").filter(Boolean);
        targetId = fileEntries[0].split("|")[0].trim();
        if (!targetName && fileEntries[0].includes("|")) targetName = fileEntries[0].split("|")[1].trim();
        if (name && name.startsWith("PL")) {
            const plNo = name.split(" - ")[0].toUpperCase();
            const match = fileEntries.find((f) => f.toUpperCase().includes(plNo));
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

    if (closePreviewTimer_PL) {
        clearTimeout(closePreviewTimer_PL);
        closePreviewTimer_PL = null;
    }

    let pl01Context = null;
    if (window.activeHashContext_PL && window.activeHashContext_PL.byFileId) {
        pl01Context = window.activeHashContext_PL.byFileId.get(targetId) || null;
    }

    const wasAlreadyOpen = Boolean(tabPL && tabPL.classList.contains("split-preview-active"));

    if (currentPreviewFileId_PL === targetId && wasAlreadyOpen) {
        document
            .querySelectorAll("#dropdown-field0-pl .hoc-tooltip")
            .forEach((r) => r.classList.remove("is-previewing-row"));
        if (targetRowElement) targetRowElement.classList.add("is-previewing-row");
        if (window.BconsViewer && typeof window.BconsViewer.applyPl01Context === "function") {
            window.BconsViewer.applyPl01Context(pl01Context);
        }
        return;
    }

    currentPreviewFileId_PL = targetId;

    if (!targetName && typeof SYSTEM_DATA !== "undefined" && SYSTEM_DATA?.pl?.field0) {
        for (const item of SYSTEM_DATA.pl.field0) {
            const scanStr = String(item.scanId || "");
            if (scanStr.includes(targetId)) {
                const matchedEntry = scanStr.split(";;").find((entry) => entry.startsWith(targetId + "|"));
                if (matchedEntry) {
                    targetName = matchedEntry.split("|")[1]?.trim() || "";
                    break;
                }
            }
        }
    }
    if (!targetName) targetName = "Tệp đính kèm.pdf";

    if (nameEl) nameEl.textContent = targetName;

    document
        .querySelectorAll("#dropdown-field0-pl .hoc-tooltip")
        .forEach((r) => r.classList.remove("is-previewing-row"));
    if (targetRowElement) targetRowElement.classList.add("is-previewing-row");

    if (activePanelTransitionCancel_PL) {
        activePanelTransitionCancel_PL();
        activePanelTransitionCancel_PL = null;
    }

    if (!wasAlreadyOpen) {
        panel.style.display = "flex";
        syncPrvSplitLayout_PL(true, true);
        void panel.offsetWidth;

        if (window.BconsViewer && typeof window.BconsViewer.setTransitionGate === "function") {
            const gatePromise = new Promise((resolve) => {
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
                timer = setTimeout(finish, 480);
                activePanelTransitionCancel_PL = finish;
            });
            window.BconsViewer.setTransitionGate(gatePromise);
        }

        if (window.BconsViewer) {
            window.BconsViewer.loadFile(targetId, targetName, undefined, pl01Context);
        }

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
            window.BconsViewer.loadFile(targetId, targetName, undefined, pl01Context);
        }
    }
}

function closePreviewModal_PL(isInstant = false) {
    const tabPL = document.getElementById("tab-plhd");
    const panel = document.getElementById("pl-dock-preview-panel");
    const formContainer = tabPL ? tabPL.querySelector(".form-container") : null;

    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
        currentPreviewFileId_PL = "";
        if (activePanelTransitionCancel_PL) {
            activePanelTransitionCancel_PL();
            activePanelTransitionCancel_PL = null;
        }
        if (closePreviewTimer_PL) {
            clearTimeout(closePreviewTimer_PL);
            closePreviewTimer_PL = null;
        }
        document
            .querySelectorAll("#dropdown-field0-pl .hoc-tooltip")
            .forEach((r) => r.classList.remove("is-previewing-row"));
        if (tabPL) tabPL.classList.remove("split-preview-active");
        if (window.BconsViewer && typeof window.BconsViewer.abortActiveTasks === "function") {
            window.BconsViewer.abortActiveTasks();
        }

        const finishCloseAfterFs = () => {
            if (window.BconsViewer) window.BconsViewer.close();
            if (panel) {
                panel.style.display = "none";
                panel.style.removeProperty("top");
                panel.style.removeProperty("height");
                panel.style.removeProperty("right");
                panel.style.removeProperty("width");
                panel.style.removeProperty("transform");
                panel.style.removeProperty("opacity");
                panel.style.removeProperty("pointer-events");
            }
            if (formContainer) {
                delete formContainer.dataset.splitAnimMode;
                formContainer.style.setProperty("transition", "none", "important");
                formContainer.style.removeProperty("width");
                formContainer.style.removeProperty("max-width");
                formContainer.style.removeProperty("margin-left");
                formContainer.style.removeProperty("margin-right");
                formContainer.style.removeProperty("opacity");
                formContainer.style.removeProperty("pointer-events");
                formContainer.style.removeProperty("animation");
                formContainer.style.removeProperty("transform");
                formContainer.style.removeProperty("transform-origin");
                void formContainer.offsetWidth;
                formContainer.style.removeProperty("transition");
            }
        };

        if (document.exitFullscreen) {
            document
                .exitFullscreen()
                .catch(() => {})
                .finally(() => setTimeout(finishCloseAfterFs, 40));
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
            setTimeout(finishCloseAfterFs, 80);
        } else {
            finishCloseAfterFs();
        }
        return;
    }

    currentPreviewFileId_PL = "";

    if (activePanelTransitionCancel_PL) {
        activePanelTransitionCancel_PL();
        activePanelTransitionCancel_PL = null;
    }
    if (closePreviewTimer_PL) {
        clearTimeout(closePreviewTimer_PL);
        closePreviewTimer_PL = null;
    }

    document
        .querySelectorAll("#dropdown-field0-pl .hoc-tooltip")
        .forEach((r) => r.classList.remove("is-previewing-row"));

    if (isInstant) {
        if (panel) {
            panel.style.display = "none";
            panel.style.removeProperty("top");
            panel.style.removeProperty("height");
            panel.style.removeProperty("right");
            panel.style.removeProperty("width");
        }
        if (formContainer) {
            delete formContainer.dataset.splitAnimMode;
            formContainer.style.removeProperty("width");
            formContainer.style.removeProperty("max-width");
            formContainer.style.removeProperty("margin-left");
            formContainer.style.removeProperty("margin-right");
            formContainer.style.removeProperty("opacity");
            formContainer.style.removeProperty("pointer-events");
            formContainer.style.removeProperty("animation");
            formContainer.style.removeProperty("transition");
            formContainer.style.removeProperty("transform");
            formContainer.style.removeProperty("transform-origin");
        }
        if (tabPL) tabPL.classList.remove("split-preview-active");

        setTimeout(() => {
            if (window.BconsViewer) window.BconsViewer.close();
        }, 500);
        return;
    }

    if (window.BconsViewer && typeof window.BconsViewer.abortActiveTasks === "function") {
        window.BconsViewer.abortActiveTasks();
    }

    const wasOpen = Boolean(tabPL && tabPL.classList.contains("split-preview-active"));
    const isVerticalOrMobile = window.innerWidth <= 960 || window.innerWidth < window.innerHeight;

    if (tabPL) tabPL.classList.remove("split-preview-active");

    if (formContainer && wasOpen && !isVerticalOrMobile) {
        const curW = formContainer.offsetWidth;
        const curLeft = formContainer.offsetLeft;
        const screenW = Math.round(window.innerWidth / UI_BASE_ZOOM);
        const masterW = getMasterPanelWidth_PL();
        const targetW = Math.min(masterW, screenW - 30);
        const targetLeft = Math.max(15, Math.round((screenW - targetW) / 2));

        formContainer.style.setProperty("animation", "none", "important");
        formContainer.style.setProperty("opacity", "1", "important");
        formContainer.style.setProperty("pointer-events", "auto", "important");
        formContainer.style.setProperty("transition", "none", "important");

        const isSameWidth = Math.abs(curW - targetW) <= 1;

        if (isSameWidth) {
            formContainer.style.setProperty("margin-left", `${targetLeft}px`, "important");
            formContainer.style.setProperty("width", `${targetW}px`, "important");
            formContainer.style.setProperty("max-width", `${masterW}px`, "important");
            formContainer.style.setProperty(
                "transform",
                `translate3d(${Math.round(curLeft - targetLeft)}px, 0, 0)`,
                "important"
            );
        } else {
            formContainer.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
            formContainer.style.setProperty("margin-left", `${curLeft}px`, "important");
            formContainer.style.setProperty("width", `${curW}px`, "important");
            formContainer.style.setProperty("max-width", `${Math.max(curW, targetW)}px`, "important");
        }

        void formContainer.offsetWidth;

        requestAnimationFrame(() => {
            if (isSameWidth) {
                formContainer.style.setProperty(
                    "transition",
                    "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                    "important"
                );
                formContainer.style.setProperty("transform", "translate3d(0, 0, 0)", "important");
            } else {
                formContainer.style.setProperty(
                    "transition",
                    "width 0.45s cubic-bezier(0.22, 1, 0.36, 1), margin-left 0.45s cubic-bezier(0.22, 1, 0.36, 1)",
                    "important"
                );
                formContainer.style.setProperty("width", `${targetW}px`, "important");
                formContainer.style.setProperty("margin-left", `${targetLeft}px`, "important");
            }

            if (panel) {
                panel.style.setProperty("transform", "translate3d(calc(100% + 60px), 0, 0)", "important");
                panel.style.setProperty("opacity", "0", "important");
                panel.style.setProperty("pointer-events", "none", "important");
            }
        });
    } else {
        if (formContainer) {
            formContainer.style.setProperty("opacity", "1", "important");
            formContainer.style.setProperty("pointer-events", "auto", "important");
            formContainer.style.removeProperty("width");
            formContainer.style.removeProperty("max-width");
            formContainer.style.removeProperty("margin-left");
            formContainer.style.removeProperty("margin-right");
        }
        if (panel) {
            panel.style.setProperty("transform", "translate3d(calc(100% + 60px), 0, 0)", "important");
            panel.style.setProperty("opacity", "0", "important");
            panel.style.setProperty("pointer-events", "none", "important");
        }
    }

    closePreviewTimer_PL = setTimeout(() => {
        closePreviewTimer_PL = null;
        if (tabPL && tabPL.classList.contains("split-preview-active")) return;
        if (window.BconsViewer) window.BconsViewer.close();

        if (formContainer) {
            formContainer.style.setProperty("transition", "none", "important");
            formContainer.style.removeProperty("width");
            formContainer.style.removeProperty("max-width");
            formContainer.style.removeProperty("margin-left");
            formContainer.style.removeProperty("margin-right");
            formContainer.style.removeProperty("transform");
            formContainer.style.removeProperty("transform-origin");
            void formContainer.offsetWidth;
            formContainer.style.removeProperty("transition");
        }
        if (panel) {
            panel.style.display = "none";
            panel.style.removeProperty("top");
            panel.style.removeProperty("height");
            panel.style.removeProperty("right");
            panel.style.removeProperty("width");
        }
    }, 460);
}

// ==========================================================================
// 7. UPLOAD LOGIC & QUEUE MANAGEMENT
// ==========================================================================

function escapeHtmlAttr_PL(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function formatScanBytes_PL(bytes) {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function isExcludedPlOrPdgFile_PL(fileName) {
    const raw = String(fileName || "")
        .normalize("NFC")
        .trim();
    if (!raw || !/\.pdf$/i.test(raw)) {
        return { excluded: true, reason: "Contract PDF only (non-PDF excluded)" };
    }
    const baseNoExt = raw.replace(/\.pdf$/i, "").trim();
    const norm = typeof normalizeText_PL === "function" ? normalizeText_PL(baseNoExt) : baseNoExt.toLowerCase();

    const isPl = /(^|[^a-z0-9])pl\s*\d+([^a-z0-9]|$)|(^|[_\s-])pl([_\s-]|$)|phu\s*luc/i.test(norm);
    if (isPl) {
        return { excluded: true, reason: "Contract only (PL excluded)" };
    }

    const isPdg = /pdg|phe\s*duyet\s*gia/i.test(norm) || /(^|_)gia(_|$)/i.test(norm);
    if (isPdg) {
        return { excluded: true, reason: "Contract only (PDG excluded)" };
    }

    return { excluded: false, reason: "" };
}

function parseContractMaHD_PL(maHD) {
    const raw = String(maHD || "").trim();
    if (!raw || /^PL\d+/i.test(raw)) return null;
    const m = raw.match(/^(\d+)\s*\/\s*(\d{4})\s*\/\s*H[ĐD]TCXD\s*-\s*([^\/\s]+)(?:\/(.*))?$/i);
    if (!m) return null;

    const normProj =
        typeof normalizeText_PL === "function" ? normalizeText_PL(m[3]).toUpperCase() : m[3].trim().toUpperCase();
    const normSuffix =
        typeof normalizeText_PL === "function"
            ? normalizeText_PL(m[4] || "").toUpperCase()
            : String(m[4] || "")
                  .trim()
                  .toUpperCase();
    const contractNo = String(parseInt(m[1], 10));
    const year = m[2].trim();

    return {
        maHD: raw,
        project: normProj,
        contractNo: contractNo,
        year: year,
        suffix: normSuffix,
        key: `${normProj}|${contractNo}|${year}`
    };
}

function parseContractFileName_PL(fileName) {
    const excl = isExcludedPlOrPdgFile_PL(fileName);
    if (excl.excluded) {
        return { valid: false, reason: excl.reason };
    }

    const baseName = String(fileName || "")
        .normalize("NFC")
        .replace(/\.pdf$/i, "")
        .trim();
    const parts = baseName
        .split("_")
        .map((s) => s.trim())
        .filter(Boolean);

    let rawProject = "";
    let rawNo = "";
    let rawYear = "";

    if (parts.length >= 3 && /^\d+$/.test(parts[1]) && /^(19|20)\d{2}$/.test(parts[2])) {
        rawProject = parts[0];
        rawNo = parts[1];
        rawYear = parts[2];
    } else {
        const m = baseName.match(/^([A-Za-z0-9À-ỹ-]+?)[_\s-]+(\d{1,5})[_\s-]+((?:19|20)\d{2})(?:[_\s._-]|$)/);
        if (m) {
            rawProject = m[1];
            rawNo = m[2];
            rawYear = m[3];
        }
    }

    if (!rawProject || !rawNo || !rawYear) {
        return { valid: false, reason: "Filename missing Project / No / Year" };
    }

    const project =
        typeof normalizeText_PL === "function"
            ? normalizeText_PL(rawProject).toUpperCase()
            : rawProject.trim().toUpperCase();
    const contractNo = String(parseInt(rawNo, 10));
    const year = rawYear.trim();

    return {
        valid: true,
        project: project,
        contractNo: contractNo,
        year: year,
        key: `${project}|${contractNo}|${year}`
    };
}

function getExistingContractFilesForItem_PL(item) {
    if (!item || !item.scanId) return [];
    const entries = String(item.scanId)
        .split(";;")
        .filter((f) => f && f.includes("|"));
    const result = [];
    entries.forEach((entry) => {
        const parts = entry.split("|");
        const fId = (parts[0] || "").trim();
        const fName = (parts[1] || "").trim();
        if (!fId) return;
        const excl = isExcludedPlOrPdgFile_PL(fName);
        if (!excl.excluded) {
            result.push({ id: fId, name: fName || "Contract.pdf" });
        }
    });
    return result;
}

function evaluateBatchScanQueue_PL() {
    const rows =
        typeof SYSTEM_DATA !== "undefined" && SYSTEM_DATA && SYSTEM_DATA.pl && Array.isArray(SYSTEM_DATA.pl.field0)
            ? SYSTEM_DATA.pl.field0
            : [];

    const contractsByKey = new Map();
    rows.forEach((item) => {
        const maHD = (item.maHD || (item.display || "").split(" | ")[0] || "").trim();
        const parsed = parseContractMaHD_PL(maHD);
        if (!parsed) return;
        if (!contractsByKey.has(parsed.key)) contractsByKey.set(parsed.key, []);
        contractsByKey.get(parsed.key).push({ item, parsed });
    });

    const claimedKeysInQueue = new Set();

    currentScanFiles.forEach((entry) => {
        const fileObj = entry.file;
        const parsedFile = parseContractFileName_PL(fileObj.name);
        if (!parsedFile.valid) {
            entry.status = "NOT_FOUND";
            entry.targetMaHD = "";
            entry.matchKey = "";
            entry.existingFiles = [];
            entry.reason = parsedFile.reason || "No matching contract";
            return;
        }

        let candidates = contractsByKey.get(parsedFile.key) || [];
        if (candidates.length > 1) {
            const normFileName =
                typeof normalizeText_PL === "function"
                    ? normalizeText_PL(fileObj.name).toUpperCase()
                    : fileObj.name.toUpperCase();
            const disambiguated = candidates.filter((c) => {
                const suffixTokens = c.parsed.suffix.split(/[-/\s]+/).filter((t) => t.length >= 2);
                const lastToken = suffixTokens[suffixTokens.length - 1];
                return lastToken && normFileName.includes(lastToken);
            });
            if (disambiguated.length === 1) candidates = disambiguated;
        }

        if (candidates.length === 0) {
            entry.status = "NOT_FOUND";
            entry.targetMaHD = "";
            entry.matchKey = parsedFile.key;
            entry.existingFiles = [];
            entry.reason = `No contract for ${parsedFile.project} • #${parsedFile.contractNo} • ${parsedFile.year}`;
            return;
        }

        if (candidates.length > 1) {
            entry.status = "NOT_FOUND";
            entry.targetMaHD = "";
            entry.matchKey = parsedFile.key;
            entry.existingFiles = [];
            entry.reason = `Multiple contracts matched (${candidates.length})`;
            return;
        }

        const matched = candidates[0];
        const targetMaHD = matched.parsed.maHD;

        if (claimedKeysInQueue.has(parsedFile.key)) {
            entry.status = "DUPLICATE";
            entry.targetMaHD = targetMaHD;
            entry.matchKey = parsedFile.key;
            entry.existingFiles = [];
            entry.reason = "Duplicate in upload queue";
            return;
        }
        claimedKeysInQueue.add(parsedFile.key);

        const existingFiles = getExistingContractFilesForItem_PL(matched.item);
        if (existingFiles.length > 0) {
            entry.status = "DUPLICATE";
            entry.targetMaHD = targetMaHD;
            entry.matchKey = parsedFile.key;
            entry.existingFiles = existingFiles;
            entry.reason = `Existing: ${existingFiles.map((x) => x.name).join(", ")}`;
            return;
        }

        entry.status = "OK";
        entry.targetMaHD = targetMaHD;
        entry.matchKey = parsedFile.key;
        entry.existingFiles = [];
        entry.reason = targetMaHD;
    });
}

function syncScanDropZoneHeight_PL() {
    const dropZone = document.getElementById("scan-drop-zone");
    const stateFile = document.getElementById("scan-state-file");
    if (!dropZone) return;

    const BASE_H = 114;
    if (!currentScanFiles || currentScanFiles.length === 0 || !stateFile) {
        dropZone.style.height = BASE_H + "px";
        return;
    }

    const targetH = Math.max(BASE_H, stateFile.offsetHeight + 26);
    dropZone.style.height = targetH + "px";
}

function updateScanQueueUI() {
    if (currentScanFiles.length === 0) {
        removeScanFile_PL();
        return;
    }

    const isBatch = currentScanMode === "batch";
    if (isBatch) evaluateBatchScanQueue_PL();

    const dropZone = document.getElementById("scan-drop-zone");
    const stateEmpty = document.getElementById("scan-state-empty");
    const stateFile = document.getElementById("scan-state-file");
    const countBadge = document.getElementById("scan-queue-count");
    const sizeLabel = document.getElementById("scan-file-size");
    const queueList = document.getElementById("scan-queue-list");
    const uploadBtn = document.getElementById("btn-upload-scan");

    if (scanCollapseTimer_PL) {
        clearTimeout(scanCollapseTimer_PL);
        scanCollapseTimer_PL = null;
    }

    const totalBytes = currentScanFiles.reduce((sum, entry) => sum + (entry.file ? entry.file.size : 0), 0);
    if (dropZone) dropZone.classList.add("has-files");
    if (stateEmpty) {
        stateEmpty.style.display = "none";
        stateEmpty.style.opacity = "1";
    }
    if (stateFile) {
        stateFile.style.display = "flex";
        stateFile.style.opacity = "1";
    }

    let allReady = currentScanFiles.length > 0;
    if (isBatch) {
        const notFoundCount = currentScanFiles.filter((e) => e.status === "NOT_FOUND").length;
        const dupCount = currentScanFiles.filter((e) => e.status === "DUPLICATE").length;
        allReady = notFoundCount === 0 && dupCount === 0;

        if (countBadge) {
            countBadge.classList.remove("is-warn", "is-error");
            if (notFoundCount > 0 && dupCount > 0) {
                countBadge.textContent = `STATUS: ${dupCount} DUPLICATE • ${notFoundCount} NOT FOUND`;
                countBadge.classList.add("is-error");
            } else if (notFoundCount > 0) {
                countBadge.textContent = `STATUS: ${notFoundCount} NOT FOUND`;
                countBadge.classList.add("is-error");
            } else if (dupCount > 0) {
                countBadge.textContent = `STATUS: ${dupCount} DUPLICATE`;
                countBadge.classList.add("is-warn");
            } else {
                countBadge.textContent = `STATUS: OK (${currentScanFiles.length} ${currentScanFiles.length > 1 ? "FILES" : "FILE"})`;
            }
        }
    } else if (countBadge) {
        countBadge.classList.remove("is-warn", "is-error");
        countBadge.textContent = `STATUS: OK (${currentScanFiles.length} ${currentScanFiles.length > 1 ? "FILES" : "FILE"})`;
    }

    if (sizeLabel) sizeLabel.textContent = `Total: ${formatScanBytes_PL(totalBytes)}`;
    if (uploadBtn) {
        uploadBtn.disabled = !allReady;
        uploadBtn.innerHTML = `<i class="bi bi-cloud-upload-fill"></i> UPLOAD`;
    }

    if (queueList) {
        queueList.innerHTML = currentScanFiles
            .map((entry, idx) => {
                const f = entry.file;
                const isExcel = /\.(xls|xlsx)$/i.test(f.name);
                const iconClass = isExcel ? "bi-file-earmark-excel-fill" : "bi-file-earmark-pdf-fill";
                const typeClass = isExcel ? "is-excel" : "is-pdf";
                const extTag = isExcel ? "EXCEL" : "PDF";
                const safeName = escapeHtmlAttr_PL(f.name);

                let rowClass = "";
                let subInfo = `<span>${extTag}</span><span style="opacity:0.35;">•</span><span>${formatScanBytes_PL(f.size)}</span>`;
                let rightControls = "";

                if (isBatch) {
                    const subText =
                        entry.status === "OK"
                            ? `${entry.targetMaHD}`
                            : entry.status === "DUPLICATE"
                              ? `${entry.targetMaHD} — ${entry.reason}`
                              : entry.reason;
                    const safeSub = escapeHtmlAttr_PL(subText);
                    subInfo = `<span>${formatScanBytes_PL(f.size)}</span><span style="opacity:0.35;">•</span><span class="scan-queue-sub-text" title="${safeSub}">${safeSub}</span>`;

                    if (entry.status === "OK") {
                        rightControls = `<span class="scan-status-pill is-ok"><i class="bi bi-check-circle-fill"></i> OK</span>`;
                    } else if (entry.status === "DUPLICATE") {
                        rowClass = "is-duplicate";
                        rightControls = `<span class="scan-status-pill is-duplicate"><i class="bi bi-exclamation-triangle-fill"></i> DUPLICATE</span>`;
                    } else {
                        rowClass = "is-not-found";
                        rightControls = `<span class="scan-status-pill is-not-found"><i class="bi bi-x-circle-fill"></i> NOT FOUND</span>`;
                    }
                } else {
                    rightControls = `<span class="scan-status-pill is-ok"><i class="bi bi-check-circle-fill"></i> OK</span>`;
                }

                return `
                <div class="scan-queue-item ${rowClass}">
                    <div class="scan-queue-icon ${typeClass}">
                        <i class="bi ${iconClass}"></i>
                    </div>
                    <div class="scan-queue-meta">
                        <div class="scan-queue-name" title="${safeName}">${safeName}</div>
                        <div class="scan-queue-sub">${subInfo}</div>
                    </div>
                    <div class="scan-queue-actions-right">
                        ${rightControls}
                        <button type="button" class="btn-icon-delete" onclick="removeSingleScanFile_PL(${idx}, event)" title="Xóa tệp này">
                            <i class="bi bi-x-lg"></i>
                        </button>
                    </div>
                </div>`;
            })
            .join("");
    }

    requestAnimationFrame(syncScanDropZoneHeight_PL);
}

function removeScanFile_PL(event, immediate = false) {
    if (event) event.stopPropagation();
    if (scanCollapseTimer_PL) {
        clearTimeout(scanCollapseTimer_PL);
        scanCollapseTimer_PL = null;
    }

    currentScanFiles = [];
    const fileInput = document.getElementById("scan-file-input");
    if (fileInput) fileInput.value = "";

    const uploadBtn = document.getElementById("btn-upload-scan");
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = `<i class="bi bi-cloud-upload-fill"></i> UPLOAD`;
    }

    const dropZone = document.getElementById("scan-drop-zone");
    const queueList = document.getElementById("scan-queue-list");
    const stateEmpty = document.getElementById("scan-state-empty");
    const stateFile = document.getElementById("scan-state-file");

    const shouldAnimate =
        !immediate &&
        dropZone &&
        stateFile &&
        stateFile.style.display !== "none" &&
        (dropZone.classList.contains("has-files") || dropZone.offsetHeight > 114);

    if (!shouldAnimate) {
        if (dropZone) {
            dropZone.classList.remove("has-files");
            dropZone.style.height = "114px";
        }
        if (queueList) queueList.innerHTML = "";
        if (stateEmpty) {
            stateEmpty.style.display = "flex";
            stateEmpty.style.opacity = "1";
        }
        if (stateFile) {
            stateFile.style.display = "none";
            stateFile.style.opacity = "1";
        }
        return;
    }

    dropZone.style.height = dropZone.offsetHeight + "px";
    void dropZone.offsetHeight;
    stateFile.style.opacity = "0";
    dropZone.classList.remove("has-files");
    dropZone.style.height = "114px";

    scanCollapseTimer_PL = setTimeout(() => {
        scanCollapseTimer_PL = null;
        if (currentScanFiles.length > 0) return;
        if (queueList) queueList.innerHTML = "";
        stateFile.style.display = "none";
        stateFile.style.opacity = "1";
        if (stateEmpty) {
            stateEmpty.style.opacity = "0";
            stateEmpty.style.display = "flex";
            requestAnimationFrame(() => {
                if (currentScanFiles.length === 0) stateEmpty.style.opacity = "1";
            });
        }
    }, 220);
}

function removeSingleScanFile_PL(index, event) {
    if (event) event.stopPropagation();
    currentScanFiles.splice(index, 1);
    updateScanQueueUI();
}

/**
 * Bắt đầu tiến trình upload nhiều file (Kết hợp nén PDF và giữ kết nối)
 */
async function startUploadScan_PL() {
    if (!currentScanFiles.length) return;
    const isBatch = currentScanMode === "batch";

    if (isBatch) {
        evaluateBatchScanQueue_PL();
        const allReady = currentScanFiles.every((e) => e.status === "OK");
        if (!allReady) {
            updateScanQueueUI();
            showToast_PL("⚠️ Vui lòng xóa các file trùng hoặc không khớp hợp đồng trước khi upload.", "error");
            return;
        }
    }

    const filesToUpload = [...currentScanFiles];

    const btn = document.getElementById("btn-upload-scan");
    const progressBar = document.getElementById("scan-progress-bar");
    const percentText = document.getElementById("scan-percent-text");
    const statusText = document.getElementById("scan-status-text");

    showScanProgress_PL();
    btn.disabled = true;

    progressBar.classList.remove("finished");
    progressBar.style.backgroundColor = "#FFBA08";
    progressBar.style.width = "0%";
    percentText.textContent = "0%";

    acquireKeepAlive("pl_scan_upload");

    const setStepProgress = (fileIdx, localPct, label) => {
        const overall = Math.round(((fileIdx + localPct / 100) / filesToUpload.length) * 100);
        const clamped = Math.max(0, Math.min(100, overall));
        progressBar.style.width = clamped + "%";
        percentText.textContent = clamped + "%";
        statusText.textContent = `[${fileIdx + 1}/${filesToUpload.length}] ${label}`;
    };

    const bufferToBase64 = (buf) => {
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        const parts = [];
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK)));
        }
        return btoa(parts.join(""));
    };

    const readFileBufferSafe = async (f) => {
        try {
            if (f._bufferPromise) {
                const cached = await f._bufferPromise;
                if (cached instanceof ArrayBuffer) return cached;
            }
            return await f.arrayBuffer();
        } catch (readErr) {
            const detail =
                readErr && readErr.message ? readErr.message : (readErr && readErr.name) || "NotReadableError";
            throw new Error(
                `Không thể đọc tệp "${f.name}" từ máy tính (${detail}). Nếu tệp nằm trong thư mục sâu (>260 ký tự) hoặc kéo từ Zalo/OneDrive, hãy lưu tệp ra Desktop rồi chọn lại.`
            );
        }
    };

    let digitizedCount = 0;
    let uploadedCount = 0;

    try {
        for (let i = 0; i < filesToUpload.length; i++) {
            const entry = filesToUpload[i];
            const file = entry.file;
            const targetMaHD = isBatch ? entry.targetMaHD : currentScanMaHD;

            const shouldDigitize = Boolean(
                window.BconsViewer &&
                typeof window.BconsViewer.shouldDigitizeFile === "function" &&
                window.BconsViewer.shouldDigitizeFile(file.name, targetMaHD)
            );

            setStepProgress(i, 5, "READING FILE...");
            const rawBuffer = await readFileBufferSafe(file);

            let base64Data = "";
            let digitizedPack = null;

            if (shouldDigitize) {
                try {
                    digitizedPack = await window.BconsViewer.prepareDigitizedUploadPdf(
                        file,
                        (localPct, stageLabel) => {
                            setStepProgress(i, Math.round(localPct * 0.6), stageLabel);
                        },
                        rawBuffer
                    );
                    base64Data = digitizedPack.base64Data;
                } catch (digErr) {
                    console.warn(
                        `[Upload Digitize] Số hóa thất bại cho "${file.name}", chuyển sang upload file gốc:`,
                        digErr
                    );
                    digitizedPack = null;
                    setStepProgress(i, 35, "PREPARING ORIGINAL FILE...");
                    base64Data = bufferToBase64(rawBuffer);
                }
            } else {
                setStepProgress(i, 40, "PREPARING FILE...");
                base64Data = bufferToBase64(rawBuffer);
            }

            setStepProgress(i, digitizedPack ? 72 : 60, "UPLOADING TO DRIVE...");
            const res = await callBackend("uploadScanToDrive", [base64Data, targetMaHD, file.name]);

            if (res && res.success) {
                const item = SYSTEM_DATA.pl.field0.find(
                    (it) => (it.display || "").split(" | ")[0].trim().toUpperCase() === targetMaHD.toUpperCase()
                );
                if (item) {
                    const newEntry = res.id + "|" + res.fileName;
                    item.scanId = (item.scanId || "").trim() !== "" ? item.scanId + ";;" + newEntry : newEntry;
                    PRECOMPUTED_PL_DATA = null;
                    localStorage.setItem("bcons_cached_system_data", JSON.stringify(SYSTEM_DATA));
                    executeFilter_PL(false, false, true);
                    if (!isBatch && currentScanMaHD === targetMaHD) renderExistingFiles_PL(targetMaHD);
                }

                if (digitizedPack) {
                    setStepProgress(i, 90, "SAVING DIGITIZED DATA...");
                    try {
                        await window.BconsViewer.commitDigitizedUploadCache(
                            res.id,
                            res.fileName,
                            digitizedPack.manifest,
                            digitizedPack.pdfBuffer
                        );
                        digitizedCount++;
                    } catch (commitErr) {
                        console.warn(
                            `[Upload Digitize] Đã upload file nhưng lỗi lưu bản số hóa "${file.name}":`,
                            commitErr
                        );
                    }
                }

                uploadedCount++;
                const qIdx = currentScanFiles.indexOf(entry);
                if (qIdx !== -1) currentScanFiles.splice(qIdx, 1);
            } else {
                throw new Error(res ? res.error : "Lỗi Upload Server");
            }

            setStepProgress(i, 100, "DONE");
        }

        statusText.textContent = "COMPLETE!";
        progressBar.classList.add("finished");
        progressBar.style.backgroundColor = "#2ECC71";

        const msg =
            digitizedCount > 0
                ? `🚀 UPLOADED & DIGITIZED ${uploadedCount} FILE(S) SUCCESSFULLY!`
                : `🚀 UPLOADED ${uploadedCount} FILE(S) SUCCESSFULLY!`;
        showToast_PL(msg, "success");

        removeScanFile_PL();
        setTimeout(() => {
            hideScanProgress_PL(false);
        }, 1600);
    } catch (e) {
        statusText.textContent = "FAILED!";
        progressBar.style.backgroundColor = "#ff4d4d";
        alert(`Upload Error: ${e.message || e}`);
    } finally {
        releaseKeepAlive("pl_scan_upload");
        if (currentScanFiles.length > 0) {
            updateScanQueueUI();
        } else if (btn) {
            btn.disabled = true;
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
    const overlay = document.getElementById("data-delete-confirm-overlay");
    const dialog = overlay ? overlay.querySelector(".scan-delete-dialog") : null;
    const maText = document.getElementById("delete-data-mahd");
    if (overlay && maText) {
        maText.textContent = editingMaHD_PL;
        overlay.style.display = "flex";
        setTimeout(() => {
            overlay.style.opacity = "1";
            if (dialog) dialog.style.transform = "scale(1)";
        }, 10);
    }
}

function closeDataDeleteModal() {
    const overlay = document.getElementById("data-delete-confirm-overlay");
    const dialog = overlay ? overlay.querySelector(".scan-delete-dialog") : null;
    if (overlay) {
        overlay.style.opacity = "0";
        if (dialog) dialog.style.transform = "scale(0.9)";
        setTimeout(() => {
            overlay.style.display = "none";
        }, 200);
    }
}

function executeActualDeleteData_PL() {
    closeDataDeleteModal();
    const maToDelete = editingMaHD_PL;

    const backupItem = SYSTEM_DATA.pl.field0.find((item) => (item.display || "").split(" | ")[0].trim() === maToDelete);
    const backupIndex = SYSTEM_DATA.pl.field0.indexOf(backupItem);

    if (backupItem) {
        const deletedFileIds = String(backupItem.scanId || "")
            .split(";;")
            .filter(Boolean)
            .map((e) => (e.split("|")[0] || "").trim())
            .filter(Boolean);

        SYSTEM_DATA.pl.field0 = SYSTEM_DATA.pl.field0.filter(
            (item) => (item.display || "").split(" | ")[0].trim() !== maToDelete
        );
        PRECOMPUTED_PL_DATA = null;

        executeFilter_PL(false);
        if (typeof updateContractNo_PL === "function") updateContractNo_PL();
        closeEditPanel_PL();

        if (deletedFileIds.length > 0) {
            if (currentPreviewFileId_PL && deletedFileIds.includes(currentPreviewFileId_PL)) {
                closePreviewModal_PL(true);
            }
            if (window.BconsViewer && typeof window.BconsViewer.purgeLocalCacheForFile === "function") {
                deletedFileIds.forEach((fId) => window.BconsViewer.purgeLocalCacheForFile(fId));
            }
        }

        showToast_PL(`🗑️ Đã xóa dữ liệu: <b style="color:white">${maToDelete}</b>`, "success");

        callBackend("deleteContractRow_Backend", maToDelete)
            .then(() => {
                publishAblyContractUpdate_Client("DELETE_DATA", maToDelete);
                if (
                    deletedFileIds.length > 0 &&
                    window.BconsViewer &&
                    window.BconsViewer.pl01Index &&
                    typeof window.BconsViewer.pl01Index.sync === "function"
                ) {
                    setTimeout(() => window.BconsViewer.pl01Index.sync(true), 300);
                }
                loadSystemData(true);
            })
            .catch((err) => {
                if (backupIndex !== -1) {
                    SYSTEM_DATA.pl.field0.splice(backupIndex, 0, backupItem);
                }
                PRECOMPUTED_PL_DATA = null;
                executeFilter_PL(false);
                if (typeof updateContractNo_PL === "function") updateContractNo_PL();
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
    const overlay = document.getElementById("scan-delete-confirm-overlay");
    const dialog = overlay.querySelector(".scan-delete-dialog");
    const nameDisplay = document.getElementById("delete-scan-filename");
    if (overlay && nameDisplay) {
        nameDisplay.textContent = fileName;
        overlay.style.display = "flex";
        setTimeout(() => {
            overlay.style.opacity = "1";
            if (dialog) dialog.style.transform = "scale(1)";
        }, 10);
    }
}

function cancelDeleteScan_PL() {
    const overlay = document.getElementById("scan-delete-confirm-overlay");
    const dialog = overlay.querySelector(".scan-delete-dialog");
    if (overlay) {
        overlay.style.opacity = "0";
        if (dialog) dialog.style.transform = "scale(0.9)";
        setTimeout(() => {
            overlay.style.display = "none";
        }, 200);
    }
}

let deleteScanQueuePromise_PL = Promise.resolve();

/**
 * THỰC THI XÓA FILE SCAN RIÊNG LẺ CHẠY NGẦM (OPTIMISTIC BACKGROUND DELETION)
 */
function executeActualDelete_PL() {
    if (!fileIdToProcess) return;

    const targetFileId = String(fileIdToProcess).trim();
    const targetMaHD = String(currentScanMaHD || "").trim();
    fileIdToProcess = ""; // Giải phóng biến toàn cục ngay lập tức
    cancelDeleteScan_PL(); // Đóng nhanh hộp thoại xác nhận xóa
    if (!targetFileId || !targetMaHD) return;

    const findContractItem = () =>
        SYSTEM_DATA?.pl?.field0?.find(
            (i) =>
                String(i.maHD || (i.display || "").split(" | ")[0])
                    .trim()
                    .toUpperCase() === targetMaHD.toUpperCase()
        );

    // 1. SAO LƯU DỮ LIỆU ĐỂ PHỤC VỤ HOÀN TÁC (ROLLBACK) NẾU LỖI
    const item = findContractItem();
    if (!item) return;

    const originalScanId = item.scanId || ""; // Bản sao lưu danh sách file scan thô gốc

    // 2. XÓA GIẢ ĐỊNH NGAY LẬP TỨC TRÊN GIAO DIỆN (0.1 GIÂY - KHÔNG KHÓA MÀN HÌNH)
    const updatedFiles = String(originalScanId)
        .split(";;")
        .filter((f) => f && f.split("|")[0].trim() !== targetFileId);
    item.scanId = updatedFiles.join(";;");
    PRECOMPUTED_PL_DATA = null;
    try {
        localStorage.setItem("bcons_cached_system_data", JSON.stringify(SYSTEM_DATA));
    } catch (e) {}

    if (typeof currentPreviewFileId_PL !== "undefined" && currentPreviewFileId_PL === targetFileId) {
        closePreviewModal_PL(true);
    }

    renderExistingFiles_PL(targetMaHD); // Vẽ lại danh sách file trong khung scan ngay lập tức
    executeFilter_PL(false, false, true); // Giữ nguyên vị trí cuộn

    // Chỉ thông báo đang xử lý; chỉ báo thành công khi Backend đã xử lý xong
    showToast_PL("⏳ Đang xóa file, vui lòng đợi...", "success");

    // 3. XẾP HÀNG TUẦN TỰ GỌI BACKEND (tránh tranh chấp ScriptLock khi xóa nhiều file liên tiếp)
    deleteScanQueuePromise_PL = deleteScanQueuePromise_PL
        .catch(() => {})
        .then(() => callBackend("deleteScanFilePermanently", [targetMaHD, targetFileId]))
        .then((res) => {
            if (res && res.success) {
                if (window.BconsViewer && typeof window.BconsViewer.purgeLocalCacheForFile === "function") {
                    window.BconsViewer.purgeLocalCacheForFile(targetFileId);
                }
                if (res.driveDeleted === false) {
                    showToast_PL(
                        `⚠️ Đã gỡ link trên Sheet nhưng chưa xóa được file trên Drive: ${escapeHtmlAttr_PL(res.driveError || "Không rõ lỗi")}`,
                        "error"
                    );
                } else {
                    showToast_PL("🗑️ Đã xóa file scan thành công!", "success");
                }
            } else {
                throw new Error(res && res.error ? res.error : "Không xác nhận được từ máy chủ");
            }
        })
        .catch((err) => {
            console.error("Lỗi xóa file scan ngầm:", err);
            const rawErr = err && err.message ? err.message : "Lỗi kết nối máy chủ";
            const isOutOfSync = /không thuộc hồ sơ|không tìm thấy hồ sơ/i.test(rawErr);

            showToast_PL(`⚠️ Không thể xóa file: ${escapeHtmlAttr_PL(rawErr)}. Đang khôi phục...`, "error");

            // 🚀 BƯỚC PHÒNG VỆ (ROLLBACK): Khôi phục lại tệp tin cũ nếu xóa ngầm bị thất bại
            const restoreItem = findContractItem();
            if (restoreItem) {
                restoreItem.scanId = originalScanId;
                PRECOMPUTED_PL_DATA = null;
                try {
                    localStorage.setItem("bcons_cached_system_data", JSON.stringify(SYSTEM_DATA));
                } catch (e) {}
                if (currentScanMaHD === targetMaHD) {
                    renderExistingFiles_PL(targetMaHD);
                }
                executeFilter_PL(false, false, true);
            }

            if (isOutOfSync && typeof loadSystemData === "function") {
                loadSystemData(true);
            }
        });
}

// ==========================================================================
// KÍCH HOẠT SEARCH & TOOLTIP NOTE (DÁN CUỐI FILE JS_Tab_PL.html)
// ==========================================================================
document.addEventListener("DOMContentLoaded", function () {
    // 1. KÍCH HOẠT SEARCH ENGINE CHO Ô FIELD0-PL (ĐÃ KHÔI PHỤC)
    const inputField0PL = document.getElementById("field0-pl");
    if (inputField0PL) {
        inputField0PL.addEventListener(
            "input",
            debounce(() => {
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
            }, 150)
        );
    }

    // 2. KÍCH HOẠT TOOLTIP NOTE KHI HOVER (DÒNG DỮ LIỆU + 2 DẤU CHẤM HĐ / PĐG)
    const dashboardContainer = document.getElementById("dropdown-field0-pl");
    if (dashboardContainer && typeof globalTooltip !== "undefined") {
        let activeTooltipTarget = null;

        dashboardContainer.addEventListener("mouseover", function (e) {
            const fileDot = e.target.closest(".file-icon");
            const row = e.target.closest(".hoc-tooltip");
            if (!row) return;

            const targetEl = fileDot || row;
            if (activeTooltipTarget === targetEl) return;
            activeTooltipTarget = targetEl;

            clearTimeout(tooltipTimeout);
            tooltipTimeout = setTimeout(
                () => {
                    if (fileDot) {
                        const dotTitle = fileDot.getAttribute("data-dot-title");
                        const dotDesc = fileDot.getAttribute("data-dot-desc");
                        if (!dotTitle) return;

                        const isActiveDot = fileDot.classList.contains("active");
                        const isPendingDot = fileDot.classList.contains("pending");
                        const descColor = isActiveDot ? "#2ECC71" : isPendingDot ? "#FFBA08" : "#95A1AF";

                        // Đổi sang dạng Micro-Chip 1 dòng
                        globalTooltip.classList.add("tooltip-compact");
                        globalTooltip.innerHTML = `
                        <span style="color: #95A1AF; font-weight: 600;">${dotTitle}</span>
                        <span style="color: rgba(255, 255, 255, 0.2); font-size: 7px; margin: 0 2px;">|</span>
                        <span style="color: ${descColor}; font-weight: 500;">${dotDesc}</span>
                    `;

                        const rect = fileDot.getBoundingClientRect();
                        const halfW = (globalTooltip.offsetWidth || 120) / 2;
                        const safeLeft = Math.min(window.innerWidth - halfW - 10, rect.left + rect.width / 2);

                        globalTooltip.style.top = rect.top - 10 + "px";
                        globalTooltip.style.left = safeLeft + "px";
                        globalTooltip.classList.add("show-tooltip");
                        return;
                    }

                    const hoverText = row.getAttribute("data-hovertext");
                    if (!hoverText) return;

                    globalTooltip.classList.remove("tooltip-compact");
                    globalTooltip.innerHTML = `
                    <b>RIGHT-CLICK / HOLD TO OPEN</b>
                    ${hoverText}
                `;

                    const rect = row.getBoundingClientRect();
                    globalTooltip.style.top = rect.top - 8 + "px";
                    globalTooltip.style.left = rect.left + rect.width / 2 + "px";
                    globalTooltip.classList.add("show-tooltip");
                },
                fileDot ? 60 : 100
            );
        });

        dashboardContainer.addEventListener("mouseout", function (e) {
            const currentRow = e.target.closest(".hoc-tooltip");
            const relatedRow = e.relatedTarget ? e.relatedTarget.closest(".hoc-tooltip") : null;
            const fromDot = e.target.closest(".file-icon");
            const toDot = e.relatedTarget ? e.relatedTarget.closest(".file-icon") : null;

            // Chỉ giữ nguyên tooltip khi chuột di chuyển trong cùng dòng VÀ không ra/vào 2 dấu chấm
            if (currentRow && relatedRow === currentRow && fromDot === toDot) {
                return;
            }

            activeTooltipTarget = null;
            clearTimeout(tooltipTimeout);
            globalTooltip.classList.remove("show-tooltip");
        });

        dashboardContainer.addEventListener(
            "scroll",
            () => {
                activeTooltipTarget = null;
                clearTimeout(tooltipTimeout);
                globalTooltip.classList.remove("show-tooltip");
            },
            { passive: true }
        );
    }

    // 3. KHU VỰC THẢ FILE TRONG BẢNG SCAN PANEL
    const dropZone = document.getElementById("scan-drop-zone");
    const fileInput = document.getElementById("scan-file-input");
    if (dropZone && fileInput) {
        dropZone.addEventListener("click", () => {
            if (currentScanFiles.length === 0) fileInput.click();
        });
        fileInput.addEventListener("change", (e) => {
            handleFilesSelected(e.target.files);
            fileInput.value = "";
        });
        dropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZone.classList.add("dragover");
        });
        dropZone.addEventListener("dragleave", (e) => {
            if (!dropZone.contains(e.relatedTarget)) {
                dropZone.classList.remove("dragover");
            }
        });
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("dragover");
            handleFilesSelected(e.dataTransfer.files);
        });
    }

    // 4. KÉO THẢ FILE TRỰC TIẾP VÀO KHUNG DASHBOARD (NHẬN DIỆN THEO TÊN FILE HỢP ĐỒNG)
    if (dashboardContainer) {
        let dashboardDragCounter = 0;

        dashboardContainer.addEventListener("dragenter", (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
            if (dashboardContainer.classList.contains("list-dashboard-locked")) return;
            e.preventDefault();
            dashboardDragCounter++;
            dashboardContainer.classList.add("dashboard-file-dragover");
        });

        dashboardContainer.addEventListener("dragover", (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
            if (dashboardContainer.classList.contains("list-dashboard-locked")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            dashboardContainer.classList.add("dashboard-file-dragover");
        });

        dashboardContainer.addEventListener("dragleave", (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
            dashboardDragCounter = Math.max(0, dashboardDragCounter - 1);
            if (dashboardDragCounter === 0 || !dashboardContainer.contains(e.relatedTarget)) {
                dashboardDragCounter = 0;
                dashboardContainer.classList.remove("dashboard-file-dragover");
            }
        });

        dashboardContainer.addEventListener("drop", (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            e.stopPropagation();

            dashboardDragCounter = 0;
            dashboardContainer.classList.remove("dashboard-file-dragover");

            if (dashboardContainer.classList.contains("list-dashboard-locked")) return;

            const droppedFiles = e.dataTransfer.files;
            if (!droppedFiles || droppedFiles.length === 0) return;

            openBatchScanPanel_PL(droppedFiles);
        });

        window.addEventListener("dragend", () => {
            dashboardDragCounter = 0;
            dashboardContainer.classList.remove("dashboard-file-dragover");
        });
    }

    // 5. CHẶN TRÌNH DUYỆT TỰ Ý MỞ FILE TOÀN TRANG KHI THẢ TRƯỢT
    window.addEventListener("dragover", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
        }
    });
    window.addEventListener("drop", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
        }
        if (dashboardContainer) dashboardContainer.classList.remove("dashboard-file-dragover");
    });
});

function handleFilesSelected(files) {
    if (!files || !files.length) return;

    const MAX_SIZE = 20 * 1024 * 1024; // Giới hạn trần 20MB
    let oversizedFiles = [];
    let unreadableFiles = [];

    // Chấp nhận PDF và Excel vào hàng chờ (riêng chế độ Batch Dashboard Drop sẽ đánh dấu NOT FOUND cho non-PDF / PL / PDG)
    const incomingFiles = Array.from(files).filter((f) => {
        const name = f.name.toLowerCase();
        return f.type === "application/pdf" || name.endsWith(".pdf") || name.endsWith(".xls") || name.endsWith(".xlsx");
    });

    if (incomingFiles.length === 0) {
        showToast_PL(
            currentScanMode === "batch"
                ? "⚠️ Chỉ hỗ trợ tệp PDF Hợp đồng!"
                : "⚠️ Sếp chỉ được chọn định dạng PDF hoặc Excel!",
            "error"
        );
        return;
    }

    incomingFiles.forEach((newFile) => {
        if (!newFile.size || newFile.size === 0) {
            unreadableFiles.push(newFile.name);
            return;
        }

        if (newFile.size > MAX_SIZE) {
            const sizeMB = (newFile.size / (1024 * 1024)).toFixed(1);
            oversizedFiles.push(`${newFile.name} (${sizeMB}MB)`);
            return;
        }

        const isDuplicateInList = currentScanFiles.some(
            (oldEntry) => oldEntry.file && oldEntry.file.name === newFile.name && oldEntry.file.size === newFile.size
        );
        if (!isDuplicateInList) {
            currentScanFiles.push({
                file: newFile,
                status: "OK",
                targetMaHD: currentScanMaHD || "",
                matchKey: "",
                existingFiles: [],
                reason: ""
            });
        }
    });

    if (unreadableFiles.length > 0) {
        showToast_PL(
            "⚠️ Trình duyệt không đọc được tệp kéo thả (đường dẫn quá dài). Hãy bấm vào khung để chọn tệp!",
            "error"
        );
    }

    if (oversizedFiles.length > 0) {
        showToast_PL("⚠️ File vượt quá dung lượng tối đa. Vui lòng nén file < 20MB trước khi tải lên.", "error");
    }

    updateScanQueueUI();
}

window.markScanFileDigitized_PL = function (fileId) {
    if (!fileId || !SYSTEM_DATA?.pl?.field0) return;

    let changedInRam = false;
    SYSTEM_DATA.pl.field0.forEach((item) => {
        const scanStr = String(item.scanId || "");
        if (!scanStr.includes(fileId + "|")) return;

        const entries = scanStr.split(";;").filter(Boolean);
        let itemChanged = false;
        const updatedEntries = entries.map((entry) => {
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
        localStorage.setItem("bcons_cached_system_data", JSON.stringify(SYSTEM_DATA));
        if (typeof executeFilter_PL === "function") {
            executeFilter_PL(false, false, true); // Giữ nguyên vị trí cuộn
        }
        callBackend("markScanDigitized_PL", fileId).catch(() => {});
    }
};
