// Quản lý hàng chờ duyệt gom lô 3 giây
let pendingApprovalBatch_PL = [];
let approvalBatchTimer_PL = null;
let countdownInterval_PL = null;
let countdownSeconds_PL = 3;

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
 * Hàm tạo ID an toàn từ Email (Tránh lỗi Crash btoa khi gặp Tiếng Việt/Ký tự đặc biệt)
 */
function getSafeId_PL(mail) {
    if (!mail) return "unknown";
    return mail.toLowerCase().replace(/[^a-z0-9]/g, ""); // Lọc sạch chỉ giữ lại chữ cái và số
}

async function openTab(tabId, triggerIntro = true) {
    if (tabId === activeTabId && !isInitialLoad) return;

    // 🚀 1. GIẢI PHÓNG HÀNG CHỜ ĐANG CHẠY (Triệt tiêu hoàn toàn lỗi biến mất Form khi click nhanh)
    if (tabTimeout) {
        clearTimeout(tabTimeout);
        tabTimeout = null;
    }

    localStorage.setItem('bcons_hub_last_tab', tabId);
    const targetTab = document.getElementById(tabId);
    if (!targetTab) return;

    // Kích hoạt mô-đun Drawing khi chuyển qua tab-drawing
    if (tabId === 'tab-drawing') {
        loadDrawingModule();
    }

    const allTabs = document.querySelectorAll('.tab-content');
    const currentTab = document.getElementById(activeTabId);

    // 2. Xử lý Hoạt ảnh Chuyển Tab (Transitions) dựa vào vị trí trong TAB_MAP
    if (currentTab && !isInitialLoad) {
        const currentIndex = TAB_MAP[activeTabId] || 0;
        const targetIndex = TAB_MAP[tabId] || 0;

        // Xóa triệt để các class hoạt ảnh cũ trên TẤT CẢ các tab để tránh xung đột
        allTabs.forEach(t => {
            t.classList.remove('slide-in-right', 'slide-in-left', 'slide-out-left', 'slide-out-right', 'instant-fade');
            
            // Nâng cao bảo vệ: Nếu click quá nhanh, lập tức ẩn các tab trung gian để tránh đè giao diện
            if (t.id !== activeTabId && t.id !== tabId) {
                t.style.display = 'none';
            }
        });

        if (currentIndex < targetIndex) {
            currentTab.classList.add('slide-out-left');
            targetTab.classList.add('slide-in-right');
        } else {
            currentTab.classList.add('slide-out-right');
            targetTab.classList.add('slide-in-left');
        }

        targetTab.style.display = 'flex';

        // 🚀 2. GÁN TIMEOUT MỚI VÀO BIẾN TOÀN CỤC ĐỂ QUẢN LÝ
        tabTimeout = setTimeout(() => {
            allTabs.forEach(t => {
                if (t.id !== tabId) {
                    t.style.display = 'none';
                    t.classList.remove('slide-out-left', 'slide-out-right');
                }
            });
            tabTimeout = null; // Giải phóng bộ nhớ hàng chờ sau khi hoàn tất hoạt ảnh
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

    // 6. Cập nhật thanh cuộn của trình duyệt
    if (typeof updateAppScrollState === 'function') {
        updateAppScrollState();
    }
}

async function loadSystemData(isSilent = false) {
    const token = localStorage.getItem('bcons_session_token');
    if (!token) {
        showLoginUI();
        return;
    }

    // 🚀 CHỐNG XUNG ĐỘT REAL-TIME: Nếu người dùng đang mở một trong các bảng điều khiển (Edit/Transfer/Scan),
    // hoãn việc nạp lại dữ liệu im lặng (isSilent) để tránh ghi đè dữ liệu đang nhập hoặc mất tham chiếu con trỏ.
    const isPanelActive = document.getElementById('edit-panel-pl')?.classList.contains('active') ||
                          document.getElementById('transfer-panel-pl')?.classList.contains('active') ||
                          document.getElementById('scan-panel-pl')?.classList.contains('active');
    if (isPanelActive && isSilent) {
        console.log("[Real-time] User is interacting with a panel. Postponing background sync.");
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

            // 🚀 BẢO VỆ CHỐNG RESET INPUT: Chỉ render cập nhật danh sách Dashboard khi data đã về, không khởi tạo lại giao diện cứng
            if (INITIALIZED_TABS['tab-plhd'] && typeof executeFilter_PL === 'function') {
                executeFilter_PL(false);
            }
            
            if (INITIALIZED_TABS['tab-plhd'] && typeof updateContractNo_PL === 'function') {
                updateContractNo_PL();
            }

            // 🚀 MỞ QUẢ CHUÔNG THÔNG BÁO CHO TẤT CẢ MỌI NGƯỜI ĐÃ ĐĂNG NHẬP THÀNH CÔNG
            if (name) {
                const bellContainer = document.getElementById('bellNotificationContainer');
                if (bellContainer) {
                    const currentRole = localStorage.getItem('bcons_staff_role') || "USER";
                    // Chỉ hiển thị quả chuông nếu vai trò là quản trị viên ADMIN
                    if (currentRole.toUpperCase() === "ADMIN") {
                        bellContainer.style.setProperty('display', 'flex', 'important');
                    }
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
    if (!activeTab || activeTab.id === 'tab-about') { 
        document.body.style.overflowY = "hidden"; 
        return; 
    }
    const form = activeTab.querySelector('.form-container');
    if (form) {
        const contentHeight = form.offsetHeight + 120; 
        const viewportHeight = window.innerHeight;
        
        // 🚀 THIẾT LẬP VÙNG ĐỆM TRỄ 25PX CHỐNG RUNG LẮC (HYSTERESIS)
        const threshold = 25; 
        const currentOverflow = document.body.style.overflowY;

        if (contentHeight > viewportHeight) {
            // Chỉ đổi trạng thái nếu thực sự cần cuộn và trạng thái cũ chưa phải là auto
            if (currentOverflow !== "auto") {
                document.body.style.overflowY = "auto";
            }
        } else if (contentHeight < (viewportHeight - threshold)) {
            // Chỉ ẩn thanh cuộn nếu chiều cao Form hụt hẳn dưới màn hình quá 25px
            if (currentOverflow !== "hidden") {
                document.body.style.overflowY = "hidden";
                window.scrollTo(0, 0);
            }
        }
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
    clearNameWarning(); 

    if (isRegisterMode) {
        title.textContent = "CREATE AN ACCOUNT";
        passContainer.style.setProperty('display', 'flex', 'important'); // HIỂN THỊ TRƯỜNG PASSWORD KHI ĐĂNG KÝ
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
    const password = document.getElementById('loginPassword').value.trim();

    if (!mail || !name || !password) {
        alert("Sếp vui lòng điền đầy đủ Email, Name và Password!");
        return;
    }

    if (password.length < 4) {
        alert("Mật khẩu đăng ký phải chứa tối thiểu 4 ký tự!");
        return;
    }

    const registerBtn = document.getElementById('loginSubmitBtn');
    registerBtn.disabled = true;
    registerBtn.textContent = "REGISTERING...";

    let isSuccess = false; 

    try {
        const res = await callBackend("registerUser", { mail, name, password });
        if (res) {
            showToast_PL("🚀 Gửi yêu cầu đăng ký thành công! Hãy liên hệ với Admin để được duyệt!", "success");
            document.getElementById('registerName').value = "";
            document.getElementById('loginPassword').value = "";
            isSuccess = true; 
            toggleLoginMode();
        }
    } catch (err) {
        if (err.message.includes("đã tồn tại")) {
            showNameWarning(name);
        } else {
            alert(err.message || "Đăng ký thất bại!");
        }
    } finally {
        registerBtn.disabled = false;
        if (!isSuccess) {
            registerBtn.textContent = "REGISTER";
        }
    }
}


function submitData_HD() {
    const btn = document.getElementById("submitButton-hd");
    const loading = document.getElementById("contractLoading");
    const f0 = document.getElementById("field0-hd").value; 
    
    if (!f0) {
        showToast_PL("⚠️ Sếp chưa chọn tên gói thầu!", "error");
        return;
    }

    // 1. KIỂM TRA TRÙNG LẶP ĐỒNG THỜI: MÃ DỰ ÁN + ITEM CATEGORY + GIÁ TRỊ + MÃ NHÀ THẦU
    const f2Raw = document.getElementById("field2-hd").value;
    const f2 = f2Raw.includes(" | ") ? f2Raw.split(" | ")[0].trim() : f2Raw.trim(); // Mã dự án
    const f1 = document.getElementById("field1-hd").value; // Tên đầy đủ (Item Category)
    const f3Raw = document.getElementById("field3-hd").value;
    const f3 = f3Raw.includes(" | ") ? f3Raw.split(" | ")[0].trim() : f3Raw.trim(); // Mã nhà thầu
    const f4Raw = document.getElementById("field4-hd").value; // Giá trị hợp đồng

    if (f2 && f1 && f3 && f4Raw && SYSTEM_DATA.pl && SYSTEM_DATA.pl.field0) {
        const currentCategory = f1.trim().toUpperCase();
        const currentProj = f2.toUpperCase();
        const currentContractor = f3.toUpperCase();
        const currentValClean = f4Raw.replace(/\D/g, ""); // Chuỗi số sạch của Giá trị nhập vào

        // Quét tìm hợp đồng trùng khớp đồng thời cả 4 yếu tố định danh
        const duplicateContract = SYSTEM_DATA.pl.field0.find(item => {
            // a. Khớp mã dự án
            const isMatchProj = item.maHD.toUpperCase().includes("HĐTCXD-" + currentProj);
            
            // b. Khớp tên đầy đủ hạng mục (Item Category)
            const isMatchCategory = (item.packageI || "").trim().toUpperCase() === currentCategory;
            
            // c. Khớp giá trị hợp đồng (so sánh dạng số nguyên sạch)
            const itemValClean = (item.valueK || item.c || "").toString().replace(/\D/g, "");
            const isMatchValue = (itemValClean === currentValClean);
            
            // d. Khớp mã nhà thầu (quét đuôi số HĐ hoặc quét chéo thông tin nhà thầu)
            const isMatchContractor = item.maHD.toUpperCase().endsWith("-" + currentContractor) || 
                                      item.maHD.toUpperCase().includes("-" + currentContractor + "/") ||
                                      (item.searchK || "").toUpperCase().includes(currentContractor);

            return isMatchProj && isMatchCategory && isMatchValue && isMatchContractor;
        });

        if (duplicateContract) {
            showToast_PL("⚠️ Hợp đồng này đã được tạo trước đó, vui lòng kiểm tra lại DATA!", "error");
            return; // Ngừng tiến trình xuất file hoàn toàn
        }
    }

    // 2. TIẾP TỤC TIẾN TRÌNH XUẤT FILE NẾU KHÔNG TRÙNG KHỚP
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

// Khai báo bộ nhớ tạm để khóa các yêu cầu bàn giao đang xử lý ngầm (Client-side Race Lock)
let activeTransferRequests_PL = new Set();

function executeTransferScript_PL(docTypesString) {
    const { maHD, isTransferred } = currentTransferData_PL;
    
    // Chặn đứng hành động nếu yêu cầu trước đó của mã hồ sơ này chưa hoàn tất
    if (activeTransferRequests_PL.has(maHD)) {
        showToast_PL("⚠️ Hệ thống đang xử lý yêu cầu trước đó, vui lòng đợi trong giây lát!", "error");
        return;
    }
    
    activeTransferRequests_PL.add(maHD); // Khóa mã hồ sơ
    const newStatus = !isTransferred;
    const targetItem = SYSTEM_DATA.pl.field0.find(i => (i.display || "").split(" | ")[0].trim() === maHD);
    
    if (targetItem) { 
        targetItem.transferred = newStatus; 
        PRECOMPUTED_PL_DATA = null; 
        executeFilter_PL(); 
    }
    
    if (!newStatus) showToast_PL(`🔴 Đã hủy bàn giao: <b style="color:white">${maHD}</b>`, 'error'); 
    else showToast_PL(`🟢 Đã bàn giao: <b style="color:#FFC000">${maHD}</b>`, 'success'); 
    
    callBackend("updateTransferStatus_PL", [maHD, newStatus, docTypesString]).then(res => {
        activeTransferRequests_PL.delete(maHD); // Mở khóa khi thành công
        if (res !== true) { 
            alert(`⚠️ LỖI DATA: Backend không tìm thấy mã [${maHD}]!`); 
            if(targetItem) targetItem.transferred = isTransferred; 
            PRECOMPUTED_PL_DATA = null; 
            executeFilter_PL(); 
        }
    }).catch(err => {
        activeTransferRequests_PL.delete(maHD); // Mở khóa khi thất bại
        alert("🚨 LỖI KẾT NỐI SERVER: " + (err.message || err)); 
        if(targetItem) targetItem.transferred = isTransferred; 
        PRECOMPUTED_PL_DATA = null; 
        executeFilter_PL();
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
    const inputField = document.getElementById("field0-pl");
    if (!inputField) return;
    
    const query = inputField.value.toLowerCase().trim();
    
    // Gọi tiền xử lý dữ liệu hệ thống
    if (typeof precomputePLData === 'function') precomputePLData();
    
    let finalData = [];
    if (typeof filterAndSortData_PL === 'function') {
        const result = filterAndSortData_PL(query);
        finalData = result.finalData || [];
    } else {
        const dropdown = document.getElementById("dropdown-field0-pl");
        const items = dropdown ? dropdown.querySelectorAll(".hoc-tooltip") : [];
        finalData = Array.from(items).map(div => {
            const display = div.getAttribute("data-display");
            return display ? { maHD: display.split(" | ")[0].trim() } : null;
        }).filter(Boolean);
    }
    
    const filteredA = finalData.map(item => item.maHD).filter(a => a && a !== "");
    
    if (filteredA.length === 0) { 
        showToast_PL("⚠️ Không có dữ liệu nào để xuất!", "error"); 
        return; 
    }
    
    const actualDataRows = filteredA.length;
    
    let estimatedTime = "";
    if (actualDataRows < 50) estimatedTime = "5 giây"; 
    else if (actualDataRows <= 100) estimatedTime = "6 giây"; 
    else if (actualDataRows <= 150) estimatedTime = "7 giây"; 
    else if (actualDataRows <= 250) estimatedTime = "8 giây"; 
    else estimatedTime = "9 giây";

    const modal = document.getElementById("confirmExportModal");
    if (!modal) return;

    // Đổ dữ liệu động vào cấu trúc HTML tĩnh đã có sẵn trong index.html
    document.getElementById("export-row-count").textContent = actualDataRows.toLocaleString('vi-VN');
    document.getElementById("export-estimated-time").textContent = estimatedTime;
    
    // Kích hoạt hiển thị
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);

    window.cancelExport = () => {
        modal.classList.remove('show');
        setTimeout(() => modal.style.display = 'none', 300);
    };

    document.getElementById("confirmExportBtn").onclick = () => {
        window.cancelExport();
        const loading = document.getElementById("contractLoading"); 
        if (loading) {
            loading.style.display = "flex";
            loading.querySelector('p').textContent = "SYSTEM EXPORTING DATA SPREADSHEET...";
        }
        
        callBackend("exportToNewSpreadsheet_PL", filteredA)
            .then(url => {
                if (loading) loading.style.display = "none"; 
                if (url) window.open(url, "_blank");
            })
            .catch(err => {
                if (loading) loading.style.display = "none"; 
                showToast_PL("⚠️ Lỗi xuất dữ liệu: " + (err.message || err), "error");
            });
    };
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
 * Trình dựng danh sách chờ duyệt (Chỉ hiện nút APPROVE/REJECT đối với quyền ADMIN)
 */
function renderBellList() {
    const listContainer = document.getElementById('bellListContent');
    if (!listContainer) return;
    
    if (pendingUsersList_PL.length === 0) {
        listContainer.innerHTML = `<div style="color: #505966; font-size: 11px; font-style: italic; text-align: center; padding: 25px 0;">Không có yêu cầu chờ duyệt</div>`;
        return;
    }
    
    const currentRole = localStorage.getItem('bcons_staff_role') || "USER";
    const isAdmin = (currentRole.toUpperCase() === "ADMIN");

    let html = "";
    pendingUsersList_PL.forEach(u => {
        const safeId = getSafeId_PL(u.mail); 
        
        // Kiểm tra xem user này có đang nằm trong hàng chờ đếm ngược hay không
        const queuedItem = pendingApprovalBatch_PL.find(item => item.mail === u.mail);
        
        let cardStyle = "background: rgba(255,255,255,0.02); border: 1px solid rgba(255,186,8,0.15);";
        let buttonHTML = "";

        if (queuedItem) {
            // Nếu đang trong hàng chờ, đổi viền sang Xanh (Approve) hoặc Đỏ (Reject)
            const borderCol = queuedItem.action === "APPROVE" ? "#2ECC71" : "#E74C3C";
            const actionText = queuedItem.action === "APPROVE" ? "Đang chờ Duyệt" : "Đang chờ Từ chối";
            cardStyle = `background: rgba(255,255,255,0.01); border: 1.5px solid ${borderCol}; opacity: 0.75;`;
            
            buttonHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 4px;">
                    <span class="batch-status-text" style="color: ${borderCol}; font-size: 11px; font-style: italic; font-weight: bold;">${actionText} (3s)...</span>
                    <button type="button" onclick="undoBatchAction_PL('${u.mail}')" 
                            style="padding: 2px 10px; border: 1px solid #95A1AF; background: transparent; color: #95A1AF; font-size: 10px; border-radius: 4px; cursor: pointer; transition: all 0.2s;">UNDO</button>
                </div>
            `;
        } else if (isAdmin) {
            buttonHTML = `
                <div class="action-buttons-wrapper" style="display: flex; gap: 8px; margin-top: 4px;">
                    <button type="button" class="btn-bell-approve" onclick="queueBatchAction_PL('${u.mail}', '${u.name}', 'APPROVE')" 
                            style="flex: 1; height: 26px; border: none; background: #2ECC71; color: white; font-weight: bold; font-size: 10.5px; border-radius: 4px; cursor: pointer; transition: all 0.2s ease-in-out;">APPROVE</button>
                    <button type="button" class="btn-bell-reject" onclick="queueBatchAction_PL('${u.mail}', '${u.name}', 'REJECT')" 
                            style="flex: 1; height: 26px; border: none; background: #E74C3C; color: white; font-weight: bold; font-size: 10.5px; border-radius: 4px; cursor: pointer; transition: all 0.2s ease-in-out;">REJECT</button>
                </div>
            `;
        } else {
            buttonHTML = `
                <div style="color: #95A1AF; font-size: 10.5px; font-style: italic; text-align: center; margin-top: 4px; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 6px;">Đang chờ phê duyệt...</div>
            `;
        }

        html += `
            <div id="user-card-${safeId}" class="pending-user-card" 
                 style="display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 6px; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); transform-origin: top; ${cardStyle}">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #FFFFFF; font-size: 12.5px; font-weight: bold;">${u.name}</span>
                    <span style="color: #95A1AF; font-size: 10.5px; font-family: monospace;">${u.mail}</span>
                </div>
                ${buttonHTML}
            </div>
        `;
    });
    listContainer.innerHTML = html;
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
 * Thêm hành động duyệt/từ chối vào hàng chờ đếm ngược 3 giây
 */
function queueBatchAction_PL(mail, name, action) {
    const safeId = getSafeId_PL(mail);

    // 1. Thêm hành động hoặc cập nhật nếu đã tồn tại trong hàng chờ
    const existingIndex = pendingApprovalBatch_PL.findIndex(item => item.mail === mail);
    if (existingIndex > -1) {
        pendingApprovalBatch_PL[existingIndex].action = action;
    } else {
        pendingApprovalBatch_PL.push({ mail, name, action, safeId }); // Lưu kèm safeId để can thiệp thẻ card
    }

    // Vẽ lại giao diện quả chuông ngay lập tức để hiện viền màu trạng thái chờ duyệt
    renderBellList();

    // 2. KHỞI CHẠY / RESET THỜI GIAN ĐẾM NGƯỢC 3 GIÂY (DEBOUNCE)
    clearTimeout(approvalBatchTimer_PL);
    clearInterval(countdownInterval_PL);
    countdownSeconds_PL = 3;

    // ĐỒNG BỘ: Đã xóa hoàn toàn thông báo Toast gây nhiễu tại đây theo yêu cầu của sếp

    // 🚀 ĐẾM NGƯỢC GIÂY TRỰC TIẾP TRÊN THẺ CARD
    countdownInterval_PL = setInterval(() => {
        countdownSeconds_PL--;
        if (countdownSeconds_PL > 0) {
            // Duyệt qua toàn bộ hàng chờ để giảm giây hiển thị trên màn hình
            pendingApprovalBatch_PL.forEach(item => {
                const card = document.getElementById(`user-card-${item.safeId}`);
                if (card) {
                    const statusText = card.querySelector('.batch-status-text');
                    if (statusText) {
                        const actionLabel = item.action === "APPROVE" ? "Đang chờ Duyệt" : "Đang chờ Từ chối";
                        statusText.textContent = `${actionLabel} (${countdownSeconds_PL}s)...`;
                    }
                }
            });
        } else {
            clearInterval(countdownInterval_PL);
        }
    }, 1000);

    // Kích hoạt gửi lệnh hàng loạt sau 3 giây nếu sếp dừng không bấm gì thêm
    approvalBatchTimer_PL = setTimeout(async () => {
        await commitApprovalBatch_PL();
    }, 3000);
}

/**
 * Hàm rút lại quyết định (Hủy hàng chờ) cho một tài khoản cụ thể
 */
function undoBatchAction_PL(mail) {
    // Xóa khỏi hàng chờ
    pendingApprovalBatch_PL = pendingApprovalBatch_PL.filter(item => item.mail !== mail);
    
    // Khôi phục lại giao diện mặc định
    renderBellList();

    // Nếu hàng chờ trống rỗng hoàn toàn, tắt bộ đếm ngược
    if (pendingApprovalBatch_PL.length === 0) {
        clearTimeout(approvalBatchTimer_PL);
        clearInterval(countdownInterval_PL);
    } else {
        // Nếu vẫn còn người khác, gia hạn lại thời gian đếm ngược về 3 giây
        const firstItem = pendingApprovalBatch_PL[0];
        queueBatchAction_PL(firstItem.mail, firstItem.name, firstItem.action);
    }
}

/**
 * Thực thi gửi lô phê duyệt tuần tự lên Server (Khi hết thời gian chờ 3 giây)
 */
async function commitApprovalBatch_PL() {
    if (pendingApprovalBatch_PL.length === 0) return;

    // 1. Hiện bảng tải đen toàn màn hình duy nhất 1 lần để báo đang đồng bộ lô dữ liệu
    const loading = document.getElementById("contractLoading");
    if (loading) {
        loading.style.display = "flex";
        loading.querySelector('p').textContent = `ĐANG XỬ LÝ LÔ ${pendingApprovalBatch_PL.length} YÊU CẦU...`;
    }

    // Sao lưu lại mảng hàng chờ để xử lý hoạt ảnh bay thẻ
    const currentBatch = [...pendingApprovalBatch_PL];
    pendingApprovalBatch_PL = []; // Dọn sạch hàng chờ toàn cục ngay để sẵn sàng nhận đợt bấm mới

    try {
        // 2. CHẠY TUẦN TỰ (SEQUENTIAL) ĐỂ TRÁNH LOCK FILE GOOGLE SHEETS
        for (const item of currentBatch) {
            const action = item.action === "APPROVE" ? "approveUser_InApp" : "rejectUser_InApp";
            
            // Gửi lệnh lên Server và chờ phản hồi thành công rồi mới đi tiếp người sau
            const success = await callBackend(action, item.mail);
            
            if (success) {
                // Xóa khỏi danh sách bộ nhớ tạm
                pendingUsersList_PL = pendingUsersList_PL.filter(u => u.mail !== item.mail);
                
                // Hiệu ứng bay thẻ
                const safeId = getSafeId_PL(item.mail);
                const card = document.getElementById(`user-card-${safeId}`);
                if (card) {
                    card.style.transform = item.action === "APPROVE" ? "translateX(50px)" : "translateX(-50px)";
                    card.style.opacity = "0";
                }
            }
        }

        // 3. Hoàn tất toàn bộ lô sau khi Server phản hồi đầy đủ
        setTimeout(() => {
            if (loading) loading.style.display = "none";
            updateBellBadge();
            renderBellList();

            if (pendingUsersList_PL.length === 0) {
                document.getElementById('bellDropdown').style.display = 'none';
            }
        }, 400);

    } catch (e) {
        if (loading) loading.style.display = "none";
        alert("Lỗi xử lý lô: " + e.message);
        // Nếu lỗi xảy ra, khôi phục lại danh sách chờ duyệt ban đầu
        loadSystemData(true);
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
        
        const realtime = new Ably.Realtime(ABLY_CLIENT_KEY);
        const channel = realtime.channels.get('bcons_notification');
        
        // 1. Đăng ký nhận thông báo Đăng ký Nhân viên mới
        channel.subscribe('new_registration', (message) => {
            const newUser = typeof message.data === "string" ? JSON.parse(message.data) : message.data;
            if (newUser && newUser.mail) {
                const exists = pendingUsersList_PL.some(u => u.mail === newUser.mail);
                if (!exists) {
                    pendingUsersList_PL.push(newUser);
                    updateBellBadge();
                    const dropdown = document.getElementById('bellDropdown');
                    if (dropdown && dropdown.style.display === 'flex') {
                        renderBellList();
                    }
                    showToast_PL(`🔔 <b>${newUser.name}</b> vừa đăng ký tài khoản mới!`, "success");
                }
            }
        });

        // 2. Đăng ký nhận thông báo Cập nhật Hợp đồng / Phụ lục Realtime
        channel.subscribe('contract_update', (message) => {
            const updateInfo = typeof message.data === "string" ? JSON.parse(message.data) : message.data;
            const localStaffName = localStorage.getItem('bcons_staff_identity');
            
            // Chỉ xử lý nếu hành động này được thực thi bởi một user khác
            if (updateInfo && updateInfo.staffName !== localStaffName) {
                // Tải ngầm dữ liệu để cập nhật Dashboard
                loadSystemData(true);
                
                // Định hình thông báo đặt Tên nhân sự lên trước
                let actionText = "cập nhật";
                if (updateInfo.actionType === "CREATE_HD") actionText = "tạo";
                else if (updateInfo.actionType === "CREATE_PL") actionText = "tạo";
                else if (updateInfo.actionType === "DELETE_DATA") actionText = "xóa";
                else if (updateInfo.actionType === "TRANSFER_STATUS") actionText = "thay đổi trạng thái bàn giao";

                showToast_PL(`📢 <b>${updateInfo.staffName}</b> vừa <b>${actionText}</b> hồ sơ <b>${updateInfo.contractNo}</b>!`, "success");
            }
        });
        
        console.log("⚡ [Realtime] Cổng kết nối WebSockets Ably đã sẵn sàng!");
    } catch (e) {
        console.error("[Realtime Error] Lỗi kết nối hệ thống thời gian thực Ably: " + e.message);
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