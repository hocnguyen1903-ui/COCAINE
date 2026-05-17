
// ==========================================================================
// 1. NHÓM CORE / GLOBAL UI LOGIC
// ==========================================================================

const serverCall = async (serverMethodName, ...args) => {
    try {
        // Gom các tham số thành 1 biến payload duy nhất nếu có nhiều hơn 1 tham số
        const payload = args.length === 1 ? args[0] : args;
        return await callBackend(serverMethodName, payload);
    } catch (error) {
        throw error;
    }
};
/**
 * Điều hướng Tab (Slide Transition & Intro Animation)
 */
function openTab(tabId, triggerIntro = true) {
    if (tabId === activeTabId && !isInitialLoad) return;
    localStorage.setItem('bcons_hub_last_tab', tabId);
    
    const targetTab = document.getElementById(tabId);
    if (!targetTab) return;

    // 1. Reset trạng thái intro và ẩn các tab khác
    document.querySelectorAll('.location-date-container').forEach(c => c.classList.remove('active-intro'));
    document.querySelectorAll('.tab-content').forEach(t => {
        t.style.display = 'none';
        t.classList.remove('slide-in-right', 'slide-in-left');
    });

    // 2. Hiển thị tab mục tiêu
    const newTabOrder = TAB_MAP[tabId];
    const isForward = newTabOrder >= currentTabOrder;
    targetTab.style.display = 'flex';
    targetTab.classList.add(isForward ? 'slide-in-right' : 'slide-in-left');

    activeTabId = tabId;
    currentTabOrder = newTabOrder;

    // 3. Kích hoạt hiệu ứng bung ngày tháng (Intro Animation)
    if (tabId !== 'tab-about' && triggerIntro) {
        const container = targetTab.querySelector(".location-date-container");
        if (container) {
            setTimeout(() => { container.classList.add("active-intro"); }, 150); 
        }
    }

    // 4. Update Menu UI
    document.querySelectorAll('.menu a').forEach(a => a.classList.remove('active'));
    const btnMap = {'tab-hdtcxd':'btn-hd','tab-plhd':'btn-pl','tab-tbkq':'btn-tbkq','tab-drawing':'btn-drawing','tab-about':'btn-about'};
    document.getElementById(btnMap[tabId])?.classList.add('active');

    if (tabId === 'tab-drawing' && typeof loadDrawingModule === 'function') loadDrawingModule();
    if (isInitialLoad) isInitialLoad = false;
}

function showFieldSmoothly(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = el.classList.contains('radio-container') ? 'flex' : 'block';
        el.classList.remove('field-closing');
        el.classList.add('field-opening');
    }
}

function closeSmoothly(id) {
    const el = document.getElementById(id);
    if (el && id !== 'dropdown-field0-pl' && el.style.display !== 'none') {
        if (el.classList.contains('smooth-dropdown')) {
            el.style.display = 'none'; 
        } else {
            el.classList.remove('field-opening');
            el.classList.add('field-closing');
            setTimeout(() => { if(el.classList.contains('field-closing')) el.style.display = 'none'; }, 500); 
        }
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('#tab-hdtcxd .smooth-dropdown, #tab-tbkq .smooth-dropdown').forEach(dd => {
        dd.classList.remove('show');
        dd.innerHTML = ""; 
    });
}

function showToast_PL(message, type) {
    let toast = document.getElementById("toastNotification-pl");
    if (!toast) { 
        toast = document.createElement("div"); toast.id = "toastNotification-pl"; 
        toast.style.cssText = `position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: #222831; color: white; padding: 12px 25px; border-radius: 8px; font-size: 14.5px; font-weight: 500; z-index: 1000000; opacity: 0; visibility: hidden; transition: all 0.3s ease-in-out; text-align: center;`;
        document.body.appendChild(toast); 
    }
    toast.innerHTML = message; 
    if (type === 'success') { toast.style.border = "1px solid #2ECC71"; toast.style.boxShadow = "0 0 15px rgba(46, 204, 113, 0.3)"; }
    else { toast.style.border = "1px solid #ff4d4d"; toast.style.boxShadow = "0 0 15px rgba(255, 77, 77, 0.3)"; }
    setTimeout(() => { toast.style.opacity = "1"; toast.style.visibility = "visible"; toast.style.bottom = "50px"; }, 10);
    setTimeout(() => { toast.style.opacity = "0"; toast.style.visibility = "hidden"; toast.style.bottom = "20px"; }, 3500);
}

function showSearchGuide_PL() {
    const modal = document.getElementById('infoModal-pl');
    if (modal) { modal.style.display = 'flex'; setTimeout(() => modal.classList.add('show'), 10); }
}

function closeSearchGuide_PL() {
    const modal = document.getElementById('infoModal-pl');
    if (modal) { modal.classList.remove('show'); setTimeout(() => modal.style.display = 'none', 300); }
}

function updateAppScrollState() {
    const activeTab = document.querySelector('.tab-content[style*="display: flex"]');
    if (!activeTab || activeTab.id === 'tab-about') { document.body.style.overflowY = "hidden"; return; }
    const form = activeTab.querySelector('.form-container');
    if (form) {
        const contentHeight = form.offsetHeight + 120; 
        const viewportHeight = window.innerHeight;
        if (contentHeight > viewportHeight) document.body.style.overflowY = "auto";
        else { document.body.style.overflowY = "hidden"; window.scrollTo(0, 0); }
    }
}

// ==========================================================================
// 2. NHÓM API HELPERS (SERVER COMMUNICATION)
// ==========================================================================

/**
 * 2. TẢI DỮ LIỆU BẤT ĐỒNG BỘ SONG SONG (PARALLEL FETCH)
 */
async function loadSystemData(isSilent = false) {
    const loading = document.getElementById("loadingSystem");
    if (loading && !isSilent) {
        loading.style.display = "flex";
        loading.style.opacity = "1"; 
    }

    try {
        // Đã đổi sang hàm chuẩn callBackend được định nghĩa ở index.html
        const sysData = await callBackend('getSystemData');

        if (sysData) {
            SYSTEM_DATA = sysData;
            PRECOMPUTED_PL_DATA = null;

            // Bọc try-catch độc lập: Một tab lỗi không làm chết cả hệ thống
            try { if (typeof initTabHD === 'function') initTabHD(); } catch(e) { console.error("Lỗi init HD:", e); }
            try { if (typeof initTabPL === 'function') initTabPL(); } catch(e) { console.error("Lỗi init PL:", e); }
            try { if (typeof initTabTB === 'function') initTabTB(); } catch(e) { console.error("Lỗi init TB:", e); }
            
            // Build DOM Dashboard sau khi đã có dữ liệu
            try { if (typeof executeFilter_PL === 'function') executeFilter_PL(false); } catch(e) { console.error("Lỗi build DOM PL:", e); }
        }

        if (loading && !isSilent) {
            // Ép transition bằng JS để đảm bảo hiệu ứng fade mượt mà 100%
            loading.style.transition = "opacity 0.5s ease";
            loading.style.opacity = "0";
            setTimeout(() => { loading.style.display = "none"; }, 500);
        }
    } catch (error) {
        if (loading) {
            loading.style.display = "none";
            loading.style.opacity = "1";
        }
        console.error("Lỗi khởi tạo hệ thống:", error);
        
        // Fallback an toàn cho Toast
        if (typeof showToast_PL === 'function') {
            showToast_PL("⚠️ Lỗi kết nối dữ liệu!", "error");
        } else {
            alert("⚠️ Lỗi kết nối dữ liệu!");
        }
    }
}

function submitData_HD() {
    const btn = document.getElementById("submitButton-hd");
    const loading = document.getElementById("contractLoading");
    const f0 = document.getElementById("field0-hd").value; 
    if (!f0) return alert("Sếp chưa nhập tên gói thầu!");
    btn.disabled = true; loading.style.display = "flex";
    const formData = {
        location: document.getElementById("locationDropdown-hd").value,
        date: document.getElementById("draftContractCheckbox-hd").checked ? "ngày ... tháng ... năm ..." : document.getElementById("dateDisplay-hd").textContent,
        field0: f0, field1: document.getElementById("field1-hd").value, field2: document.getElementById("field2-hd").value, field3: document.getElementById("field3-hd").value, field4: document.getElementById("field4-hd").value, field5: document.getElementById("field5-hd").value, field6: document.getElementById("field6-hd").value, field7: document.getElementById("field7-hd").value, field8: document.getElementById("field8-hd").value, draftContract: document.getElementById("draftContractCheckbox-hd").checked, radioOption: document.querySelector('input[name="option-hd"]:checked')?.value || "", radioOption2: document.querySelector('input[name="option2-hd"]:checked')?.value || "", pl01: document.getElementById("pl01Checkbox-hd").checked ? "PL01" : ""
    };
    callBackend("handleFullExportProcess_HD", formData).then(res => {
        loading.style.display = "none"; btn.disabled = false;
        if (res && res.link) window.open(res.link, "_blank");
        if (!formData.draftContract) {
            SYSTEM_DATA.pl.field0.unshift({ display: `${formData.field8} | ${formData.field0.includes("|") ? formData.field0.split("|")[1].trim() : formData.field0} | ${formData.field4}`, note: formData.field0, transferred: false, scanId: "", hasQ: (formData.field5 && formData.field5 !== "0"), hasR: (formData.radioOption === "BLTU"), hasS: (formData.radioOption === "BLHD") });
            PRECOMPUTED_PL_DATA = null;
            if (activeTabId === 'tab-plhd') executeFilter_PL();
            loadSystemData(true);
        }
    }).catch(err => {
        loading.style.display = "none"; btn.disabled = false; alert(err.message || err);
    });
}

function submitEdit_PL() {
    const val = document.getElementById('ep-input-val').value.trim();
    const loading = document.getElementById("contractLoading"); 
    if(loading) loading.style.display = "flex";
    // Lưu ý: Đóng gói 3 biến thành array [editingMaHD_PL, currentEditType, val]
    callBackend("updateContractData_PL", [editingMaHD_PL, currentEditType, val]).then(res => {
        if(loading) loading.style.display = "none";
        if (res) {
            showToast_PL(`🟢 Đã cập nhật thành công: ${editingMaHD_PL}`, 'success');
            if (currentEditType === "CONTRACT_NO") currentEditItemData.maHD = val;
            else if (currentEditType === "DATE") currentEditItemData.dateH = val;
            else if (currentEditType === "PACKAGE") { currentEditItemData.packageI = val; currentEditItemData.note = val; } 
            else if (currentEditType === "VALUE") { currentEditItemData.valueK = val; currentEditItemData.c = val; }
            currentEditItemData.display = `${currentEditItemData.maHD} | ${currentEditItemData.packageI} | ${(currentEditItemData.valueK || "").toString().replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
            PRECOMPUTED_PL_DATA = null; executeFilter_PL(false); closeEditPanel_PL();
        }
    }).catch(err => {
        if(loading) loading.style.display = "none"; alert("Lỗi Server: " + (err.message || err));
    });
}

function submitData_PL() {
    const loading = document.getElementById("contractLoading");
    const f8 = document.getElementById("field8-pl")?.value;
    if (!f8) return alert("Sếp chưa chọn hợp đồng gốc!");
    loading.style.display = "flex";
    const formData = { field0: document.getElementById("field0-pl")?.value || "", field2: document.getElementById("field2-pl")?.value || "", field8: f8, field9: document.getElementById("field9-pl")?.value || "", date: document.getElementById("dateDisplay-pl")?.innerText || "", selectedBF3: selectedAdjustmentLabels.map(label => label.replace(/điều chỉnh\s*/gi, "").trim()).join(" | "), adjustmentIds: selectedAdjustmentIds.join(", ") };
    callBackend("writeToSheetAndExportDoc_PL", formData).then(res => {
        loading.style.display = "none"; 
        if (res && res.link) window.open(res.link, "_blank"); 
        SYSTEM_DATA.pl.field0.unshift({ display: `${formData.field8} | ${formData.selectedBF3 || 'Phụ lục'} | ${formData.field2 || formData.field9 || ''}`, note: formData.selectedBF3, transferred: false, scanId: "", hasQ: (formData.field2 && formData.field2 !== "0" && formData.field2 !== ""), hasR: false, hasS: false }); 
        PRECOMPUTED_PL_DATA = null; executeFilter_PL(false); selectedAdjustmentIds = []; selectedAdjustmentLabels = []; 
        const f5 = document.getElementById("field5-pl"); if (f5) f5.value = ""; 
        renderAdjustmentOptions_PL(); 
        ["label-field2-pl", "label-field9-pl", "label-field10-pl"].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; }); 
        updateContractNo_PL(); loadSystemData(true);
    }).catch(err => {
        loading.style.display = "none"; alert("Lỗi xuất file: " + (err.message || err));
    });
}

function executeTransferScript_PL(docTypesString) {
    const { maHD, isTransferred } = currentTransferData_PL;
    const newStatus = !isTransferred;
    const targetItem = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === maHD);
    if (targetItem) { targetItem.transferred = newStatus; PRECOMPUTED_PL_DATA = null; executeFilter_PL(); }
    if (!newStatus) showToast_PL(`🔴 Đã hủy bàn giao: <b style="color:white">${maHD}</b>`, 'error'); 
    else showToast_PL(`🟢 Đã bàn giao: <b style="color:#FFC000">${maHD}</b>`, 'success'); 
    callBackend("updateTransferStatus_PL", [maHD, newStatus, docTypesString]).then(res => {
        if (res !== true) { 
            alert(`⚠️ LỖI DATA: Backend không tìm thấy mã [${maHD}]!`); 
            if(targetItem) targetItem.transferred = isTransferred; PRECOMPUTED_PL_DATA = null; executeFilter_PL(); 
        }
    }).catch(err => {
        alert("🚨 LỖI KẾT NỐI SERVER: " + (err.message || err)); 
        if(targetItem) targetItem.transferred = isTransferred; PRECOMPUTED_PL_DATA = null; executeFilter_PL();
    });
}

function updateContractNo_TB() {
    const f6 = document.getElementById("field6-tb");
    if (f6) {
        f6.value = `.../${new Date().getFullYear()}/TB/KĐT-BCONS`;
    }
}

function submitData_TB() {
    const f0 = document.getElementById("field0-tb").value; if (!f0) return alert("Sếp chưa nhập tên gói thầu!");
    const btn = document.getElementById("submitButton-tb"); const loading = document.getElementById("contractLoading");
    btn.disabled = true; loading.style.display = "flex";
    const formData = { location: document.getElementById("locationDropdown-tb").value, date: document.getElementById("dateDisplay-tb").textContent, field0: f0, fieldPkgName: document.getElementById("field-pkg-name-tb").value, field1: document.getElementById("field1-tb").value, field2: document.getElementById("field2-tb").value, field3: document.getElementById("field3-tb").value, field4: document.getElementById("field4-tb").value, field5: document.getElementById("field5-tb").value, field6: document.getElementById("field6-tb").value };
    callBackend("handleFullExportProcess_TB", formData).then(res => {
        loading.style.display = "none"; btn.disabled = false; 
        if (res && res.link) window.open(res.link, "_blank");
    }).catch(err => {
        loading.style.display = "none"; btn.disabled = false; alert(err.message || err);
    });
}

function executeActualDeleteData_PL() {
    closeDataDeleteModal(); const maToDelete = editingMaHD_PL; const loading = document.getElementById("contractLoading");
    if (loading) { loading.style.display = "flex"; loading.querySelector('p').textContent = "SYSTEM DELETING DATA..."; }
    callBackend("deleteContractRow_Backend", maToDelete).then(res => {
        if (loading) loading.style.display = "none"; 
        SYSTEM_DATA.pl.field0 = SYSTEM_DATA.pl.field0.filter(item => (item.display || "").split(" | ")[0].trim() !== maToDelete); 
        PRECOMPUTED_PL_DATA = null; executeFilter_PL(); closeEditPanel_PL(); 
        showToast_PL(`🗑️ Đã xóa dữ liệu số: ${maToDelete}`, "success"); loadSystemData(true);
    }).catch(err => {
        if (loading) loading.style.display = "none"; showToast_PL("⚠️ Lỗi khi xóa dữ liệu trên Server!", "error");
    });
}

function executeActualDelete_PL() {
    if (!fileIdToProcess) return; cancelDeleteScan_PL(); const loading = document.getElementById("contractLoading");
    if(loading) { loading.style.display = "flex"; loading.querySelector('p').textContent = "SYSTEM DELETING SCAN FILE..."; }
    callBackend("deleteScanFilePermanently", [currentScanMaHD, fileIdToProcess]).then(res => {
        if(loading) loading.style.display = "none"; 
        if (res && res.success) { 
            const item = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === currentScanMaHD); 
            if (item) { 
                item.scanId = item.scanId.split(";;").filter(f => f && !f.startsWith(fileIdToProcess + "|")).join(";;"); 
                PRECOMPUTED_PL_DATA = null; renderExistingFiles_PL(currentScanMaHD); executeFilter_PL(); 
            } 
            showToast_PL("🗑️ Đã xóa file thành công", "success"); fileIdToProcess = ""; 
        } else {
            alert("Lỗi xóa file: " + (res ? res.error : "Unknown"));
        }
    }).catch(err => {
        if(loading) loading.style.display = "none"; alert("Lỗi kết nối: " + (err.message || err));
    });
}

function exportFilteredToNewSheet_PL() {
    const input = document.getElementById("field0-pl").value.toLowerCase();
    const filteredA = SYSTEM_DATA.pl.field0.filter(i => i.display.toLowerCase().includes(input)).map(i => i.display.split(" | ")[0]);
    if (filteredA.length === 0) return alert("Không có dữ liệu để xuất!");
    const loading = document.getElementById("contractLoading"); if (loading) loading.style.display = "flex";
    callBackend("exportToNewSpreadsheet_PL", filteredA).then(url => {
        if (loading) loading.style.display = "none"; 
        if (url) window.open(url, "_blank");
    }).catch(err => {
        if (loading) loading.style.display = "none"; alert("Lỗi: " + (err.message || err));
    });
}

// ==========================================================================
// TÍNH NĂNG VUỐT (SWIPE) CHUYỂN TAB TRÊN MOBILE
// ==========================================================================
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let isSwipeAllowed = true;

document.addEventListener('touchstart', function(e) {
    const t = e.target;
    
    // BỘ LỌC AN TOÀN: KHÔNG CHO PHÉP CHUYỂN TAB NẾU ĐANG CHẠM VÀO:
    // 1. Bản đồ Mindmap (#cy)
    // 2. Các danh sách đang cuộn (.smooth-dropdown)
    // 3. Các bảng Modal đang mở (.active, .info-modal-content, .scan-delete-dialog)
    if (t.closest('#cy') || 
        t.closest('.smooth-dropdown') || 
        t.closest('#edit-panel-pl.active') || 
        t.closest('#transfer-panel-pl.active') || 
        t.closest('#scan-panel-pl.active') || 
        t.closest('.info-modal-content') || 
        t.closest('.scan-delete-dialog')) {
        
        isSwipeAllowed = false;
        return;
    }

    isSwipeAllowed = true;
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
}, {passive: true});

document.addEventListener('touchend', function(e) {
    if (!isSwipeAllowed) return;
    
    touchEndX = e.changedTouches[0].screenX;
    touchEndY = e.changedTouches[0].screenY;
    handleMobileSwipe();
}, {passive: true});

function handleMobileSwipe() {
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // Chỉ kích hoạt nếu vuốt NGANG dài hơn vuốt DỌC (tránh nhầm khi người dùng cuộn lên xuống)
    // Khoảng cách vuốt phải lớn hơn 50px (chống chạm nhầm)
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
        
        // Trình tự các Tab theo ý mày
        const swipeSequence =['tab-hdtcxd', 'tab-plhd', 'tab-tbkq', 'tab-drawing'];
        let currentIndex = swipeSequence.indexOf(activeTabId);

        if (diffX < 0) {
            // ---> VUỐT SANG TRÁI (Đi tới Tab tiếp theo)
            if (activeTabId === 'tab-about') {
                openTab('tab-hdtcxd'); // Từ About vuốt trái -> Vào Hợp đồng
            } else if (currentIndex !== -1 && currentIndex < swipeSequence.length - 1) {
                openTab(swipeSequence[currentIndex + 1]);
            }
        } else {
            // <--- VUỐT SANG PHẢI (Quay lại Tab trước đó)
            if (currentIndex > 0) {
                openTab(swipeSequence[currentIndex - 1]);
            } else if (currentIndex === 0) {
                openTab('tab-about'); // Đang ở Hợp đồng vuốt phải -> Trở về About
            }
        }
    }
}
