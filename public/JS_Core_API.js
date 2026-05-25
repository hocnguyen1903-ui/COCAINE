
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
/* --- public/JS_Core_API.js --- */

async function openTab(tabId, triggerIntro = true) {
    if (tabId === activeTabId && !isInitialLoad) return;
    localStorage.setItem('bcons_hub_last_tab', tabId);
    const targetTab = document.getElementById(tabId);
    if (!targetTab) return;

    let isTabJustFetched = false; // Cờ kiểm soát chống gọi trùng lặp (Race Condition)

    // 1. Chỉ nạp HTML nếu Tab rỗng và không phải là tab-about
    if (targetTab.innerHTML.trim() === "" && tabId !== 'tab-about') {
        isTabJustFetched = true; // Đánh dấu tab này đang được tải bất đồng bộ lần đầu
        const fileMap = {
            'tab-hdtcxd': 'Tab_HDTCXD.html',
            'tab-plhd': 'Tab_PLHD.html',
            'tab-tbkq': 'Tab_TBKQ.html',
            'tab-drawing': 'Tab_Drawing.html'
        };
        try {
            const resp = await fetch('./' + fileMap[tabId]);
            if (resp.ok) {
                targetTab.innerHTML = await resp.text();
                // Kích hoạt logic khởi tạo riêng của từng Tab
                if (tabId === 'tab-hdtcxd') initTabHD();
                if (tabId === 'tab-plhd') initTabPL();
                if (tabId === 'tab-tbkq') initTabTB();
                
                // CHỈ gọi loadDrawingModule sau khi HTML đã được ghi đè hoàn tất vào DOM
                if (tabId === 'tab-drawing') loadDrawingModule();
            }
        } catch (e) { 
            console.error("Lỗi nạp Tab:", e); 
        }
    }

    const allTabs = document.querySelectorAll('.tab-content');
    const currentTab = document.getElementById(activeTabId);

    // 2. Xử lý Hoạt ảnh Chuyển Tab (Transitions) dựa vào vị trí trong TAB_MAP
    if (currentTab && !isInitialLoad) {
        const currentIndex = TAB_MAP[activeTabId] || 0;
        const targetIndex = TAB_MAP[tabId] || 0;

        allTabs.forEach(t => {
            t.classList.remove('slide-in-right', 'slide-in-left', 'slide-out-left', 'slide-out-right', 'instant-fade');
        });

        if (currentIndex < targetIndex) {
            currentTab.classList.add('slide-out-left');
            targetTab.classList.add('slide-in-right');
        } else {
            currentTab.classList.add('slide-out-right');
            targetTab.classList.add('slide-in-left');
        }

        targetTab.style.display = 'flex';

        setTimeout(() => {
            allTabs.forEach(t => {
                if (t.id !== tabId) {
                    t.style.display = 'none';
                    t.classList.remove('slide-out-left', 'slide-out-right');
                }
            });
        }, 400);

    } else {
        allTabs.forEach(t => {
            t.style.display = 'none';
            t.classList.remove('slide-in-right', 'slide-in-left', 'slide-out-left', 'slide-out-right', 'instant-fade');
        });
        targetTab.classList.add('instant-fade');
        targetTab.style.display = 'flex';
    }

    activeTabId = tabId;
    
    // 3. Đồng bộ trạng thái Menu Navigation
    document.querySelectorAll('.menu a').forEach(a => a.classList.remove('active'));
    const btnId = tabId === 'tab-hdtcxd' ? 'btn-hd' : tabId === 'tab-plhd' ? 'btn-pl' : tabId === 'tab-tbkq' ? 'btn-tbkq' : tabId === 'tab-drawing' ? 'btn-drawing' : 'btn-about';
    const menuBtn = document.getElementById(btnId);
    if (menuBtn) menuBtn.classList.add('active');

    if (isInitialLoad) isInitialLoad = false;

    // 4. LOGIC BUNG NGÀY THÁNG TỰ ĐỘNG
    allTabs.forEach(t => {
        if (t.id !== tabId) {
            const otherContainer = t.querySelector('.location-date-container');
            if (otherContainer) otherContainer.classList.remove('active-intro');
        }
    });
    const currentLocDateContainer = targetTab.querySelector('.location-date-container');
    if (currentLocDateContainer) {
        setTimeout(() => { currentLocDateContainer.classList.add('active-intro'); }, 150);
    }

    // 5. KÍCH HOẠT MÔ-ĐUN DRAWING KHI CHUYỂN TAB ĐÃ ĐƯỢC TẢI SẴN (CÓ KIỂM SOÁT)
    // Chỉ gọi ở đây nếu tab này KHÔNG phải là tab vừa được fetch mới (isTabJustFetched === false)
    // Điều này triệt tiêu hoàn toàn lỗi gọi trùng lặp (Double-trigger) khi load trang
    if (!isTabJustFetched && tabId === 'tab-drawing' && typeof loadDrawingModule === 'function') {
        loadDrawingModule();
    }

    // 6. Cập nhật thanh cuộn của trình duyệt
    if (typeof updateAppScrollState === 'function') {
        updateAppScrollState();
    }
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
        toast.style.cssText = `position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background-color: #222831; color: white; padding: 12px 25px; border-radius: 8px; font-size: 14.5px; font-weight: 500; z-index: 100000005 !important; opacity: 0; visibility: hidden; transition: all 0.3s ease-in-out; text-align: center;`;
        document.body.appendChild(toast); 
    }
    toast.innerHTML = message; 
    if (type === 'success') { toast.style.border = "1px solid #2ECC71"; toast.style.boxShadow = "0 0 15px rgba(46, 204, 113, 0.3)"; }
    else { toast.style.border = "1px solid #ff4d4d"; toast.style.boxShadow = "0 0 15px rgba(255, 77, 77, 0.3)"; }
    setTimeout(() => { toast.style.opacity = "1"; toast.style.visibility = "visible"; toast.style.bottom = "50px"; }, 10);
    setTimeout(() => { toast.style.opacity = "0"; toast.style.visibility = "hidden"; toast.style.bottom = "20px"; }, 5000);
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
/* --- public/JS_Core_API.js --- */

// --- CẤU HÌNH LIÊN KẾT BACKEND API ---
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbxaJkfAEWLuPfw8n3J0kGCpcGHAX2WgC9qQ6Mdh6eCXA4hwzbHCfhkmphOf-uxYKg0/exec";

/**
 * Thực thi gọi API đính kèm bảo mật Token
 */
/**
 * Thực thi gọi API đính kèm bảo mật Token
 */
async function callBackend(action, data = {}) {
    const token = localStorage.getItem('bcons_session_token');
    
    // Cho phép cả hành động đăng nhập (loginUser) và đăng ký (registerUser) bỏ qua màng lọc Token khi chưa đăng nhập
    if (!token && action !== "loginUser" && action !== "registerUser") {
        showLoginUI();
        throw new Error("UNAUTHORIZED: Yêu cầu đăng nhập!");
    }

    const resp = await fetch(GAS_API_URL, { 
        method: 'POST', 
        mode: 'cors', 
        body: JSON.stringify({ action, data, token }) 
    });
    const res = await resp.json();
    
    if (res.status === "error") {
        if (res.message.includes("UNAUTHORIZED")) {
            localStorage.removeItem('bcons_session_token');
            localStorage.removeItem('bcons_staff_identity');
            showLoginUI();
        }
        throw new Error(res.message);
    }
    return res.data;
}

/**
 * Hiển thị khung đăng nhập chặn tương tác
 */
function showLoginUI() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
        // Khắc phục xung đột CSS mặc định opacity: 0 của lớp .form-container
        const formContainer = overlay.querySelector('.form-container');
        if (formContainer) {
            formContainer.style.setProperty('opacity', '1', 'important');
        }
        // Tắt loading hệ thống nếu có để nhường không gian tương tác
        const loader = document.getElementById('loadingSystem');
        if (loader) loader.style.display = 'none';
    }
}


/**
 * Xử lý sự kiện ĐĂNG XUẤT TÀI KHOẢN (LOG OUT)
 */
function performLogout() {
    localStorage.removeItem('bcons_session_token');
    localStorage.removeItem('bcons_staff_identity');
    // Reload trang để xóa sạch toàn bộ RAM state lưu tạm trên thiết bị
    window.location.reload();
}

// Biến trạng thái đăng ký của giao diện
let isRegisterMode = false;

/**
 * Chuyển đổi trạng thái giao diện giữa ĐĂNG NHẬP và ĐĂNG KÝ
 */
function toggleLoginMode() {
    const title = document.getElementById('loginTitle');
    const passContainer = document.getElementById('passwordFieldContainer');
    const nameContainer = document.getElementById('nameFieldContainer');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const toggleLink = document.getElementById('toggleLoginView');

    isRegisterMode = !isRegisterMode;
    clearNameWarning(); // Dọn dẹp cảnh báo đỏ cũ nếu có

    if (isRegisterMode) {
        title.textContent = "CREATE AN ACCOUNT";
        passContainer.style.setProperty('display', 'none', 'important');
        nameContainer.style.setProperty('display', 'flex', 'important');
        submitBtn.textContent = "REGISTER";
        submitBtn.setAttribute('onclick', 'performRegister()');
        toggleLink.textContent = "Đã có tài khoản? Đăng nhập ngay";
    } else {
        title.textContent = "MEMBER SIGN IN";
        passContainer.style.setProperty('display', 'flex', 'important');
        nameContainer.style.setProperty('display', 'none', 'important');
        submitBtn.textContent = "SIGN IN";
        submitBtn.setAttribute('onclick', 'performLogin()');
        toggleLink.textContent = "Chưa có tài khoản? Đăng ký ngay";
    }
}

/**
 * Xử lý hiển thị cảnh báo trùng tên ngay dưới ô nhập và đổi màu viền input sang đỏ
 */
function showNameWarning(name) {
    const warningEl = document.getElementById('nameWarningText');
    if (warningEl) {
        warningEl.textContent = `(Tên "${name}" đã được đăng ký, vui lòng chọn tên khác)`;
        warningEl.style.display = 'block';
    }
    const inputEl = document.getElementById('registerName');
    if (inputEl) {
        inputEl.style.setProperty('border-color', '#ff4d4d', 'important');
    }
}

/**
 * Xóa bỏ cảnh báo đỏ và trả lại màu viền mặc định cho ô nhập
 */
function clearNameWarning() {
    const warningEl = document.getElementById('nameWarningText');
    if (warningEl) {
        warningEl.style.display = 'none';
        warningEl.textContent = '';
    }
    const inputEl = document.getElementById('registerName');
    if (inputEl) {
        inputEl.style.setProperty('border-color', 'rgba(255, 186, 8, 0.4)', 'important');
    }
}

/**
 * Xử lý sự kiện đăng ký tài khoản mới lên hệ thống
 */
async function performRegister() {
    const mail = document.getElementById('loginEmail').value.trim();
    const name = document.getElementById('registerName').value.trim().toUpperCase();

    if (!mail || !name) {
        alert("Sếp vui lòng điền đầy đủ Email và Họ tên!");
        return;
    }

    const registerBtn = document.getElementById('loginSubmitBtn');
    registerBtn.disabled = true;
    registerBtn.textContent = "REGISTERING...";

    try {
        const res = await callBackend("registerUser", { mail, name });
        if (res) {
            showToast_PL("🚀 Gửi yêu cầu đăng ký thành công! Hãy liên hệ với Admin để được duyệt!", "success");
            // Khôi phục lại trạng thái form Đăng nhập
            document.getElementById('registerName').value = "";
            toggleLoginMode();
        }
    } catch (err) {
        // Kiểm tra xem lỗi trả về từ Backend có phải lỗi trùng tên viết tắt không
        if (err.message.includes("đã tồn tại")) {
            showNameWarning(name);
        } else {
            alert(err.message || "Đăng ký thất bại!");
        }
    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = "REGISTER";
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

// --- KHAI BÁO KEY KẾT NỐI ABLY PHÍA CLIENT (DÙNG CHUNG KHÓA Ở BƯỚC 2) ---
const ABLY_CLIENT_KEY = "GNetjA.Fp7ryA:mZOogyAfJeLjEL-J3WN-893xuKX-_vZvj25jv0AR8RU";

/**
 * Xử lý sự kiện nhấn nút SIGN IN (Đồng bộ tên và quyền lên Client)
 */
async function performLogin() {
    const mail = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    
    if (!mail || !password) {
        alert("Sếp vui lòng điền đầy đủ thông tin đăng nhập!");
        return;
    }

    const loginBtn = document.querySelector('#loginOverlay .submit-button');
    loginBtn.disabled = true;
    loginBtn.textContent = "VERIFYING...";

    try {
        const res = await callBackend("loginUser", { mail, password });
        if (res && res.token) {
            localStorage.setItem('bcons_session_token', res.token);
            localStorage.setItem('bcons_staff_identity', res.name);
            localStorage.setItem('bcons_staff_role', res.role || "USER"); // Lưu quyền vĩnh viễn trên máy
            
            // Gán tên lên Header ngay lần đầu đăng nhập thành công
            const displayEl = document.getElementById('staffNameDisplay');
            if (displayEl) {
                displayEl.textContent = res.name;
            }
            
            document.getElementById('loginOverlay').style.setProperty('display', 'none', 'important');
            showToast_PL(`Chào sếp ${res.name}, đăng nhập thành công!`, "success");
            
            // Nạp dữ liệu hệ thống ngay sau khi đăng nhập thành công
            loadSystemData();
        }
    } catch (err) {
        alert(err.message || "Xác thực thất bại!");
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = "SIGN IN";
    }
}

/**
 * Khởi tạo dữ liệu hệ thống có kiểm tra phiên làm việc (Mở chuông cho TẤT CẢ mọi người)
 */
async function loadSystemData(isSilent = false) {
    const token = localStorage.getItem('bcons_session_token');
    if (!token) {
        showLoginUI();
        return;
    }

    // Gán tên lên Header khi F5 tải lại trang
    const name = localStorage.getItem('bcons_staff_identity');
    const displayEl = document.getElementById('staffNameDisplay');
    if (displayEl && name) {
        displayEl.textContent = name;
    }

    const loading = document.getElementById("loadingSystem");
    if (loading && !isSilent) loading.style.display = "flex";

    try {
        const sysData = await callBackend('getSystemData');
        if (sysData) {
            SYSTEM_DATA = sysData;
            PRECOMPUTED_PL_DATA = null;

            // Nạp dữ liệu chờ duyệt về Client
            pendingUsersList_PL = sysData.pendingUsers || [];

            if (typeof initTabHD === 'function') initTabHD();
            if (typeof initTabPL === 'function') initTabPL();
            if (typeof initTabTB === 'function') initTabTB();
            if (typeof executeFilter_PL === 'function') executeFilter_PL(false);

            // 🚀 MỞ QUẢ CHUÔNG THÔNG BÁO CHO TẤT CẢ MỌI NGƯỜI ĐÃ ĐĂNG NHẬP THÀNH CÔNG
            if (name) {
                const bellContainer = document.getElementById('bellNotificationContainer');
                if (bellContainer) {
                    bellContainer.style.setProperty('display', 'flex', 'important');
                }
                updateBellBadge();
                initAblyRealtimeConnection(); // Mở cổng Socket lắng nghe
            }
        }
        if (loading) {
            loading.style.opacity = "0";
            setTimeout(() => { loading.style.display = "none"; }, 500);
        }
    } catch (error) {
        if (loading) loading.style.display = "none";
        console.error("Lỗi khởi tạo hệ thống:", error);
        showToast_PL("⚠️ Lỗi phiên làm việc hoặc kết nối!", "error");
    }
}

/**
 * Trình dựng danh sách chờ duyệt (Chỉ hiện nút APPROVE/REJECT đối với quyền ADMIN)
 */
function renderBellList() {
    const listContainer = document.getElementById('bellListContent');
    if (!listContainer) return;
    
    if (pendingUsersList_PL.length === 0) {
        listContainer.innerHTML = `<div style="color: #505966; font-size: 11px; font-style: italic; text-align: center; padding: 25px 0;">Không có yêu cầu chờ duyệt</div>`;
        return;
    }
    
    // Kiểm tra quyền của máy sếp
    const currentRole = localStorage.getItem('bcons_staff_role') || "USER";
    const isAdmin = (currentRole.toUpperCase() === "ADMIN");

    let html = "";
    pendingUsersList_PL.forEach(u => {
        html += `
            <div style="display: flex; flex-direction: column; gap: 6px; padding: 10px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,186,8,0.15); border-radius: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #FFFFFF; font-size: 12.5px; font-weight: bold;">${u.name}</span>
                    <span style="color: #95A1AF; font-size: 10.5px; font-family: monospace;">${u.mail}</span>
                </div>
                ${isAdmin ? `
                <!-- Giao diện hiển thị nút duyệt nhanh dành cho ADMIN -->
                <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <button type="button" onclick="approveUserInApp('${u.mail}', '${u.name}')" style="flex: 1; height: 26px; border: none; background: #2ECC71; color: white; font-weight: bold; font-size: 10.5px; border-radius: 4px; cursor: pointer;">APPROVE</button>
                    <button type="button" onclick="rejectUserInApp('${u.mail}', '${u.name}')" style="flex: 1; height: 26px; border: none; background: #E74C3C; color: white; font-weight: bold; font-size: 10.5px; border-radius: 4px; cursor: pointer;">REJECT</button>
                </div>
                ` : `
                <!-- Giao diện hiển thị tĩnh chỉ xem đối với nhân sự thường (USER) -->
                <div style="color: #95A1AF; font-size: 10.5px; font-style: italic; text-align: center; margin-top: 4px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 6px;">Đang chờ phê duyệt...</div>
                `}
            </div>
        `;
    });
    listContainer.innerHTML = html;
}

/**
 * Mở cổng kết nối WebSocket thời gian thực đến Máy chủ Ably
 */
function initAblyRealtimeConnection() {
    try {
        if (typeof Ably === 'undefined') return;
        
        // Khởi tạo Client Realtime
        const realtime = new Ably.Realtime(ABLY_CLIENT_KEY);
        const channel = realtime.channels.get('bcons-registration-channel');
        
        // Đăng ký lắng nghe sự kiện Đăng ký mới từ nhân viên
        channel.subscribe('new-registration', (message) => {
            const newUser = message.data;
            if (newUser && newUser.mail) {
                // Kiểm tra xem đã có trong danh sách cục bộ chưa để tránh trùng lặp
                const exists = pendingUsersList_PL.some(u => u.mail === newUser.mail);
                if (!exists) {
                    pendingUsersList_PL.push(newUser);
                    updateBellBadge();
                    showToast_PL(`🔔 Nhân viên <b>${newUser.name}</b> vừa gửi yêu cầu đăng ký tài khoản mới!`, "success");
                }
            }
        });
        
        console.log("⚡ [Realtime] Cổng kết nối WebSockets Ably đã kích hoạt!");
    } catch (e) {
        console.error("[Realtime Error] Không thể kết nối máy chủ Ably: " + e.message);
    }
}

/**
 * Đóng mở Dropdown quả chuông và tự động đóng các dropdown khác để tránh đè giao diện
 */
function toggleBellDropdown(event) {
    if (event) event.stopPropagation();
    const dropdown = document.getElementById('bellDropdown');
    const isShowing = dropdown.style.display === 'flex';
    
    // Đóng toàn bộ menu dropdown khác
    document.querySelectorAll('.smooth-dropdown').forEach(d => d.classList.remove('show'));
    
    if (isShowing) {
        dropdown.style.display = 'none';
    } else {
        dropdown.style.display = 'flex';
        renderBellList();
    }
}

/**
 * Cập nhật số đỏ hiển thị trên quả chuông báo
 */
function updateBellBadge() {
    const badge = document.getElementById('bellBadge');
    const count = pendingUsersList_PL.length;
    
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'block';
        // Tạo hiệu ứng lắc nhẹ quả chuông để sếp chú ý
        const icon = document.getElementById('bellIcon');
        if (icon) {
            icon.style.transform = 'scale(1.2) rotate(15deg)';
            setTimeout(() => { icon.style.transform = 'scale(1) rotate(0deg)'; }, 300);
        }
    } else {
        badge.style.display = 'none';
    }

    // 🚀 THÊM MỚI: Tự động cập nhật thông báo lên Tiêu đề Tab & Favicon
    updateTabNotification(count);
}


/**
 * Gọi API duyệt nhanh ACTIVE tài khoản ngay trên Web (Zero Reload)
 */
async function approveUserInApp(mail, name) {
    const loading = document.getElementById("contractLoading");
    if (loading) {
        loading.style.display = "flex";
        loading.querySelector('p').textContent = "APPROVING USER...";
    }
    
    try {
        const success = await callBackend("approveUser_InApp", mail);
        if (success) {
            // Xóa tài khoản vừa duyệt khỏi mảng cục bộ
            pendingUsersList_PL = pendingUsersList_PL.filter(u => u.mail !== mail);
            updateBellBadge();
            renderBellList();
            showToast_PL(`🟢 Kích hoạt thành công tài khoản của ${name}!`, "success");
            
            // Nếu sếp đang ở menu dropdown trống thì tự động đóng lại
            if (pendingUsersList_PL.length === 0) {
                document.getElementById('bellDropdown').style.display = 'none';
            }
        }
    } catch (e) {
        alert("Lỗi duyệt: " + e.message);
    } finally {
        if (loading) loading.style.display = "none";
    }
}

/**
 * Gọi API từ chối xóa tài khoản chờ duyệt ngay trên Web (Zero Reload)
 */
async function rejectUserInApp(mail, name) {
    // Đã loại bỏ dòng confirm xác nhận tại đây để xử lý trực tiếp khi nhấn nút
    
    const loading = document.getElementById("contractLoading");
    if (loading) {
        loading.style.display = "flex";
        loading.querySelector('p').textContent = "REJECTING USER...";
    }
    
    try {
        const success = await callBackend("rejectUser_InApp", mail);
        if (success) {
            // Cập nhật danh sách chờ duyệt cục bộ
            pendingUsersList_PL = pendingUsersList_PL.filter(u => u.mail !== mail);
            updateBellBadge();
            renderBellList();
            showToast_PL(`🔴 Đã từ chối đăng ký của ${name}!`, "error");
            
            // Tự động đóng dropdown nếu không còn ai trong danh sách chờ
            if (pendingUsersList_PL.length === 0) {
                document.getElementById('bellDropdown').style.display = 'none';
            }
        }
    } catch (e) {
        alert("Lỗi từ chối: " + e.message);
    } finally {
        if (loading) loading.style.display = "none";
    }
}

// Lắng nghe sự kiện click ngoài màn hình để tự động đóng dropdown Quả chuông báo
document.addEventListener('click', () => {
    const dropdown = document.getElementById('bellDropdown');
    if (dropdown) dropdown.style.display = 'none';
});

function initAblyRealtimeConnection() {
    try {
        if (typeof Ably === 'undefined') return;
        
        // Khởi tạo Client Realtime sử dụng Client Key chính xác
        const realtime = new Ably.Realtime(ABLY_CLIENT_KEY);
        
        // SỬA LỖI: Đồng bộ khớp tên Channel với Backend
        const channel = realtime.channels.get('bcons_notification');
        
        // SỬA LỖI: Đồng bộ khớp tên Event đăng ký mới
        channel.subscribe('new_registration', (message) => {
            const newUser = message.data;
            if (newUser && newUser.mail) {
                // Kiểm tra trùng lặp để tránh hiện thông báo nhiều lần
                const exists = pendingUsersList_PL.some(u => u.mail === newUser.mail);
                if (!exists) {
                    // Đẩy user mới trực tiếp vào RAM của Client
                    pendingUsersList_PL.push(newUser);
                    
                    // Cập nhật chấm đỏ thông báo ngay lập tức
                    updateBellBadge();
                    
                    // Nếu admin đang mở sẵn Dropdown quả chuông, tự động vẽ lại danh sách ngay lập tức
                    const dropdown = document.getElementById('bellDropdown');
                    if (dropdown && dropdown.style.display === 'flex') {
                        renderBellList();
                    }
                    
                    // Hiện Toast thông báo góc màn hình
                    showToast_PL(`🔔 Nhân viên <b>${newUser.name}</b> vừa gửi yêu cầu đăng ký tài khoản mới!`, "success");
                }
            }
        });
        
        console.log("⚡ [Realtime] Cổng kết nối WebSockets Ably đã kích hoạt!");
    } catch (e) {
        console.error("[Realtime Error] Không thể kết nối máy chủ Ably: " + e.message);
    }
}

/**
 * Xử lý cập nhật số lượng thông báo dạng (1) hoặc (2) lên Tiêu đề và Favicon của Tab
 */
function updateTabNotification(count) {
    const baseTitle = "KEN";
    
    // 1. CẬP NHẬT TIÊU ĐỀ TAB DẠNG (Count) KEN
    if (count > 0) {
        document.title = `(${count}) ${baseTitle}`;
    } else {
        document.title = baseTitle;
    }

    // 2. CẬP NHẬT CHẤM ĐỎ TRÊN FAVICON
    const favicon = document.querySelector('link[rel="icon"]');
    if (!favicon) return;

    const originalSrc = "https://i.postimg.cc/W4v0Vv2C/logo.png";

    if (count <= 0) {
        favicon.href = originalSrc;
        return;
    }

    try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        const img = new Image();
        img.crossOrigin = "anonymous"; // Cho phép tải ảnh an toàn nếu máy chủ hỗ trợ CORS
        img.src = originalSrc;

        img.onload = function() {
            try {
                // Vẽ logo gốc
                ctx.drawImage(img, 0, 0, 32, 32);
                // Vẽ thêm chấm đỏ thông báo
                drawFaviconBadge(ctx, count);
                // Cập nhật lại liên kết Icon
                favicon.href = canvas.toDataURL('image/png');
            } catch (err) {
                // Dự phòng vẽ tay hoàn toàn bằng Canvas nếu dính lỗi bảo mật CORS từ nhà cung cấp ảnh
                drawFallbackFavicon(favicon, count);
            }
        };
        img.onerror = function() {
            drawFallbackFavicon(favicon, count);
        };
    } catch (e) {
        drawFallbackFavicon(favicon, count);
    }
}

/**
 * Hàm hỗ trợ vẽ chấm tròn đỏ chứa số lượng thông báo
 */
function drawFaviconBadge(ctx, count) {
    ctx.beginPath();
    ctx.arc(24, 8, 7, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff4d4d'; // Màu đỏ thông báo chuẩn
    ctx.fill();

    ctx.font = 'bold 9px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count > 9 ? '9+' : count, 24, 8);
}

/**
 * Hàm vẽ favicon dự phòng (Vẽ tay trực tiếp, không sử dụng tài nguyên ảnh ngoài)
 */
function drawFallbackFavicon(favicon, count) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    // Vẽ hình tròn nền tối màu của hệ thống
    ctx.fillStyle = '#031c35';
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#FFBA08';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Vẽ chữ K màu vàng đại diện thương hiệu
    ctx.font = 'bold 15px Arial';
    ctx.fillStyle = '#FFBA08';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', 15, 16);

    // Vẽ chấm đỏ thông báo
    drawFaviconBadge(ctx, count);

    favicon.href = canvas.toDataURL('image/png');
}