
// ==========================================================================
// 3. HỆ THỐNG MENU CHUỘT PHẢI (CONTEXT MENU)
// ==========================================================================

/**
 * Hiển thị Menu chuột phải tùy chỉnh tại vị trí click
 */
function showContextMenu_PL(event, element, maHD, isTransferred) {
    event.preventDefault(); 
    event.stopPropagation();
    
    // 1. Tắt Tooltip Note nếu đang hiện
    if (typeof globalTooltip !== 'undefined') globalTooltip.classList.remove('show-tooltip');

    // 2. Nạp dữ liệu & Highlight dòng đang chọn
    currentTransferData_PL = { maHD, isTransferred };
    if (currentTransferElement_PL) currentTransferElement_PL.classList.remove("context-menu-active");
    currentTransferElement_PL = element;
    currentTransferElement_PL.classList.add("context-menu-active");

    const ctxMenu = document.getElementById("customContextMenu-pl");
    
    // 3. Tính toán tọa độ hiển thị (Tránh tràn màn hình)
    let x = event.clientX, y = event.clientY;
    const menuWidth = 230;
    const menuHeight = 160;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - (menuWidth + 10);
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - (menuHeight + 10);
    
    ctxMenu.style.left = x + "px"; 
    ctxMenu.style.top = y + "px";

    // 4. Kiểm tra trạng thái File Scan để hiển thị nhãn menu tương ứng
    const itemData = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === maHD);
    const hasScan = !!(itemData && itemData.scanId);
    
    const statusClass = isTransferred ? 'ctx-danger' : 'ctx-success';
    const statusText = isTransferred ? 'Cancel Transfer' : 'Transfer Records';
    const scanLabel = hasScan ? "Open to view" : "Upload Scans";
    const scanClass = hasScan ? "ctx-view" : "ctx-scan-empty";
    
    // Logic: Nếu có file rồi thì bấm vào nhãn chính là Xem, nếu chưa có thì là Nạp
    const mainAction = hasScan ? `viewScanFile_PL('${itemData.scanId}', '${escapeStr(maHD)}')` : `openScanPanel_PL('${escapeStr(maHD)}')`;

    ctxMenu.innerHTML = `
        <div class="ctx-menu-item ${statusClass}" onclick="confirmTransfer_PL()"><span>${statusText}</span></div>
        <div class="ctx-menu-item ctx-edit" onclick="openEditPanel_PL('${escapeStr(maHD)}')"><span>Edit Data</span></div>
        <div class="ctx-menu-split">
            <div class="ctx-main-action ${scanClass}" onclick="${mainAction}"><span>${scanLabel}</span></div>
            <div class="ctx-gear-action" onclick="openScanPanel_PL('${escapeStr(maHD)}')"><i class="bi bi-gear-fill"></i></div>
        </div>
    `;

    // 5. Kích hoạt hiệu ứng hiển thị
    ctxMenu.classList.add("active");
}

/**
 * Đóng Menu chuột phải và gỡ highlight
 */
function closeContextMenu_PL() {
    const ctx = document.getElementById("customContextMenu-pl");
    if (ctx) ctx.classList.remove("active");
    if (currentTransferElement_PL) currentTransferElement_PL.classList.remove("context-menu-active");
}

// ==========================================================================
// 4. LOGIC BẢNG CHỈNH SỬA DỮ LIỆU (EDIT PANEL)
// ==========================================================================

/**
 * Mở bảng chọn mục cần chỉnh sửa
 */
function openEditPanel_PL(maHD) {
    closeContextMenu_PL();
    editingMaHD_PL = maHD;
    
    // Tìm dữ liệu chi tiết của dòng
    currentEditItemData = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === maHD) || {};
    
    // Quay về màn hình chọn mục
    backToSelector_PL();
    
    const panel = document.getElementById('edit-panel-pl');
    if (panel) {
        panel.classList.add('active');
        panel.style.display = "flex";
    }
    
    // Làm mờ Dashboard phía sau để tập trung xử lý
    const list = document.getElementById('dropdown-field0-pl');
    if(list) list.classList.add('list-dashboard-locked');
}

function closeEditPanel_PL() {
    const panel = document.getElementById('edit-panel-pl');
    if (panel) panel.classList.remove('active');
    
    const list = document.getElementById('dropdown-field0-pl');
    if(list) list.classList.remove('list-dashboard-locked');
    document.getElementById('main-search-container-pl').style.zIndex = "1000";
}

/**
 * Hiển thị giao diện chọn hạng mục sửa (Mã, Ngày, Gói thầu, Giá trị)
 */
function backToSelector_PL() {
    const headerTitle = document.getElementById('ep-header-title');
    if (headerTitle) {
        headerTitle.innerHTML = `
            <span style="color: #95A1AF; font-size: 10px; font-weight: 500; letter-spacing: 0.5px;">CHỌN NỘI DUNG CẦN ĐIỀU CHỈNH:</span><br>
            <span style="color: #FFBA08; font-size: 13px; font-weight: 700;">${editingMaHD_PL}</span>
        `;
    }
    document.getElementById('ep-view-selector').style.display = "flex";
    document.getElementById('ep-view-editor').style.display = "none";
}

/**
 * Chuyển sang màn hình nhập liệu cho hạng mục đã chọn
 */
function selectEditCategory_PL(type, labelName) {
    currentEditType = type;
    document.getElementById('ep-header-title').innerHTML = `
        <span style="color: #95A1AF; font-size: 10px; font-weight: 500; letter-spacing: 0.5px;">SỬA ${labelName.toUpperCase()}:</span><br>
        <span style="color: #FFBA08; font-size: 13px; font-weight: 700;">${editingMaHD_PL}</span>
    `;
    document.getElementById('ep-editor-label').textContent = `Nhập ${labelName} mới:`;
    
    const input = document.getElementById('ep-input-val');
    const updateBtn = document.querySelector('#ep-footer-normal .btn-primary-luxury');

    // Đổ dữ liệu cũ vào để sếp sửa
    if (type === "CONTRACT_NO") input.value = editingMaHD_PL;
    else if (type === "DATE") input.value = currentEditItemData.dateH || "";
    else if (type === "PACKAGE") input.value = currentEditItemData.packageI || "";
    else if (type === "VALUE") {
        let val = (currentEditItemData.valueK || "").toString().replace(/\D/g, "");
        input.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    originalEditValue = input.value;

    // Ban đầu khóa nút Update cho đến khi có thay đổi thực sự
    if (updateBtn) {
        updateBtn.disabled = true;
        updateBtn.style.opacity = "0.3";
    }

    input.oninput = function() {
        if (currentEditType === 'VALUE') formatInput_PL(this);
        if (updateBtn) {
            const isChanged = this.value.trim() !== originalEditValue && this.value.trim() !== "";
            updateBtn.disabled = !isChanged;
            updateBtn.style.opacity = isChanged ? "1" : "0.3";
        }
    };

    document.getElementById('ep-view-selector').style.display = "none";
    document.getElementById('ep-view-editor').style.display = "flex";
    input.focus();
    input.select();
}

/**
 * Gửi dữ liệu cập nhật lên Server (Sheet)
 */
function submitEdit_PL() {
    const val = document.getElementById('ep-input-val').value.trim();
    const loading = document.getElementById("contractLoading"); 
    if(loading) loading.style.display = "flex";

    // Đóng gói payload mảng 3 tham số
    callBackend("updateContractData_PL", [editingMaHD_PL, currentEditType, val])
        .then(res => {
            if(loading) loading.style.display = "none";
            if (res) {
                showToast_PL(`🟢 Đã cập nhật thành công: ${editingMaHD_PL}`, 'success');
                if (currentEditType === "CONTRACT_NO") currentEditItemData.maHD = val;
                else if (currentEditType === "DATE") currentEditItemData.dateH = val;
                else if (currentEditType === "PACKAGE") { currentEditItemData.packageI = val; currentEditItemData.note = val; } 
                else if (currentEditType === "VALUE") { currentEditItemData.valueK = val; currentEditItemData.c = val; }

                let formattedMoney = (currentEditItemData.valueK || "").toString().replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                currentEditItemData.display = `${currentEditItemData.maHD} | ${currentEditItemData.packageI} | ${formattedMoney}`;

                PRECOMPUTED_PL_DATA = null; executeFilter_PL(false); closeEditPanel_PL(); 
            }
        })
        .catch(err => {
            if(loading) loading.style.display = "none";
            alert("Lỗi Server: " + (err.message || err));
        });
}

// ==========================================================================
// 5. LOGIC BÀN GIAO HỒ SƠ (TRANSFER LOGIC)
// ==========================================================================

/**
 * Mở bảng Checklist bàn giao hồ sơ
 */
function confirmTransfer_PL() {
    if (!currentTransferData_PL) return;
    const { maHD, isTransferred } = currentTransferData_PL;

    // Nếu đã bàn giao rồi -> Click này tương đương với Hủy bàn giao (Reset)
    if (isTransferred) { 
        closeContextMenu_PL(); 
        executeTransferScript_PL(""); 
        return;
    }

    closeContextMenu_PL(); 
    
    const title = document.getElementById('tp-header-title');
    if (title) {
        title.innerHTML = `
            <span style="color: #95A1AF; font-size: 10px;">BÀN GIAO HỒ SƠ:</span><br>
            <span style="color: #FFBA08; font-size: 13px; font-weight: 700;">${maHD}</span>
        `;
    }
    
    document.getElementById('transfer-panel-pl').classList.add('active');
    document.getElementById('transfer-panel-pl').style.display = 'flex';

    const list = document.getElementById('dropdown-field0-pl');
    if(list) list.classList.add('list-dashboard-locked');
    document.getElementById('main-search-container-pl').style.zIndex = "2000";

    // Xử lý tự động tick checkbox dựa trên loại hồ sơ (HĐ hay PL)
    const checkboxes = document.querySelectorAll('#checklistOptions-pl input'); 
    const isPL = (maHD || "").toUpperCase().startsWith("PL");
    const itemData = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === maHD) || {};
    
    // Tính toán xem có giá trị tiền không
    const hasValue = (parseFloat((itemData.c || "0").toString().replace(/\./g, '').replace(/[^\d-]/g, '')) || 0) !== 0;

    checkboxes.forEach(cb => {
        const row = cb.closest('.check-row');
        cb.checked = false; 
        cb.disabled = false; 
        if (row) row.classList.remove("disabled");

        if (!isPL) { 
            // Nếu là Hợp đồng gốc
            if (cb.value === "HĐ" || cb.value === "PDG") cb.checked = true;
            if (cb.value === "PLHĐ") { cb.disabled = true; row?.classList.add("disabled"); }
            if (cb.value === "DNTU" && itemData.hasQ) cb.checked = true; 
            if (cb.value === "BLTU" && itemData.hasR) cb.checked = true; 
            if (cb.value === "BLHĐ" && itemData.hasS) cb.checked = true; 
        } else {
            // Nếu là Phụ lục
            if (cb.value === "PLHĐ") cb.checked = true;
            if (cb.value === "PDG" && hasValue) cb.checked = true;
            if (!["PLHĐ", "PDG", "KHÁC"].includes(cb.value)) {
                cb.disabled = true;
                if (row) row.classList.add("disabled");
            }
        }
    });
}

function closeChecklist_PL() {
    document.getElementById('transfer-panel-pl').classList.remove('active');
    const list = document.getElementById('dropdown-field0-pl');
    if(list) list.classList.remove('list-dashboard-locked');
    document.getElementById('main-search-container-pl').style.zIndex = "1000";
}

/**
 * Thu thập dữ liệu các hồ sơ đã chọn và gửi lệnh bàn giao
 */
function finalSubmitTransfer_PL() {
    let selected = []; 
    document.querySelectorAll('#checklistOptions-pl input:checked').forEach(cb => selected.push(cb.value));
    
    if (selected.length === 0) {
        alert("Sếp phải chọn ít nhất 1 thành phần hồ sơ để bàn giao!");
        return;
    }

    const docTypes = selected.join(" - "); 
    closeChecklist_PL(); 
    executeTransferScript_PL(docTypes);
}
