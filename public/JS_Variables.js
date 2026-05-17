
// ==========================================================================
// 1. BIẾN TOÀN CỤC (GLOBAL VARIABLES) - STATE MANAGEMENT
// ==========================================================================
let SYSTEM_DATA = { 
    hd: { project: [], pack: [], contractor: [], warranty: [] }, 
    pl: { field0: [] } 
};

let isTBKQInitialized = false;
let mobileTouchTimer;
let currentFocusIndex = -1;
let currentRenderLimit_PL = 50; 
let activeDropIndex_PL = -1;
let currentFilterState_PL = 'ALL'; 
let searchTimeout_PL = null; 
let PRECOMPUTED_PL_DATA = null; 

// Quản lý trạng thái Tab
let currentTabOrder = 1; 
let isInitialLoad = true;
let activeTabId = 'tab-about';
let tabTimeout = null;
const TAB_MAP = { 
    'tab-about': 0, 
    'tab-hdtcxd': 1, 
    'tab-plhd': 2, 
    'tab-tbkq': 3,
    'tab-drawing': 4
};

// Quản lý trạng thái Chỉnh sửa & Bàn giao PL
let currentTransferElement_PL = null; 
let currentTransferData_PL = null;
let editingMaHD_PL = ""; 
let currentEditItemData = {};
let currentEditType = ""; 
let originalEditValue = "";

// Quản lý trạng thái Điều chỉnh (Adjustment)
let selectedAdjustmentIds = []; 
let selectedAdjustmentLabels = []; 
let selectedAdjustments_PL = []; 

// Quản lý trạng thái File Scan & Upload
let currentScanMaHD = ""; 
let currentScanFiles = []; 
let fileIdToProcess = "";
let lastTap_Scan = 0;

// ==========================================================================
// 2. HẰNG SỐ CẤU HÌNH (CONSTANTS)
// ==========================================================================
const LIST_LOCATIONS = ["BCONS", "SBCONS", "NKP", "RBCONS", "BLAND", "PMH", "BCONSPS", "DBCONS", "VIETPEARL"];

// 🔥 FIX LỖI FIELD 5 PL: Bổ sung danh sách tùy chọn điều chỉnh
const PL_ADJUSTMENT_OPTIONS = [
    { id: 1, label: 'Điều chỉnh người đại diện Bên A', fieldToShow: '' },
    { id: 2, label: 'Điều chỉnh địa chỉ Bên A', fieldToShow: '' },
    { id: 3, label: 'Điều chỉnh người đại diện Bên B', fieldToShow: '' },
    { id: 4, label: 'Điều chỉnh địa chỉ Bên B', fieldToShow: '' },
    { id: 5, label: 'Điều chỉnh số tài khoản ngân hàng', fieldToShow: '' },
    { id: 6, label: 'Điều chỉnh giá trị hợp đồng', fieldToShow: 'label-field2-pl' },
    { id: 7, label: 'Gia hạn tiến độ', fieldToShow: 'label-field9-pl' },
    { id: 8, label: 'Điều chỉnh điều khoản tạm ứng', fieldToShow: '' },
    { id: 9, label: 'Điều chỉnh điều khoản quyết toán', fieldToShow: '' }
];

// Audio giữ trình duyệt thức (Keep-alive)
const keepAliveAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
keepAliveAudio.loop = true;

// Khởi tạo Tooltip Global
const globalTooltip = document.createElement('div');
globalTooltip.className = 'global-tooltip-bcons';
document.body.appendChild(globalTooltip);
let tooltipTimeout;

// ==========================================================================
// 3. SỰ KIỆN KHỞI TẠO HỆ THỐNG (INITIALIZATION)
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    // Đọc Tab đã lưu từ máy, mặc định là 'tab-about'
    const lastTab = localStorage.getItem('bcons_hub_last_tab') || 'tab-about';
    openTab(lastTab, false); 
    
    loadSystemData();

    document.addEventListener("click", (e) => {
        document.querySelectorAll('.smooth-dropdown').forEach(d => {
            if (d.id === 'dropdown-field0-pl' || d.id === 'dropdown-field5-pl') return;
            if (!d.contains(e.target) && !e.target.tagName.includes('INPUT')) {
                d.classList.remove('show');
            }
        });

        const adjDrop = document.getElementById('dropdown-field5-pl');
        if (adjDrop && adjDrop.classList.contains('open-smooth')) {
            const isInsideAdj = document.getElementById('field5-pl')?.closest('.dropdown-container').contains(e.target);
            if (!isInsideAdj && !adjDrop.contains(e.target)) {
                adjDrop.classList.remove('open-smooth');
            }
        }

        const ctxMenu = document.getElementById('customContextMenu-pl');
        if (ctxMenu && ctxMenu.classList.contains('active')) {
            if (!ctxMenu.contains(e.target)) {
                closeContextMenu_PL();
            }
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" || e.key === "Esc") {
            document.querySelectorAll('.smooth-dropdown').forEach(d => d.classList.remove('show'));           
            const adjDrop = document.getElementById('dropdown-field5-pl');
            if (adjDrop) adjDrop.classList.remove('open-smooth');

            closeContextMenu_PL();
            closeEditPanel_PL();
            closeChecklist_PL();
            closeScanPanel_PL();
            if (typeof closeSearchGuide_PL === "function") closeSearchGuide_PL();
            if (typeof closeDataDeleteModal === "function") closeDataDeleteModal();
            if (typeof cancelDeleteScan_PL === "function") cancelDeleteScan_PL();
            
            const list = document.getElementById('dropdown-field0-pl');
            if(list) {
                list.classList.remove('list-dashboard-locked');
                list.style.filter = "none";
                list.style.opacity = "1";
            }
        }
    });
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
        const activeTab = document.querySelector('.tab-content[style*="display: flex"]#tab-hdtcxd, .tab-content[style*="display: flex"]#tab-tbkq');
        if (activeTab) {
            if (document.activeElement === document.body || !activeTab.contains(document.activeElement)) {
                const field0 = activeTab.querySelector('input[id*="field0"]');
                if (field0) {
                    e.preventDefault();
                    field0.focus();
                }
            }
        }
    }
});

document.addEventListener('focusin', function(e) {
    const activeField = e.target;
    const isHDorTB = activeField.closest('#tab-hdtcxd, #tab-tbkq');
    if (isHDorTB && activeField.tagName === 'INPUT') {
        if (activeField.hasAttribute('onclick')) {
            setTimeout(() => {
                activeField.click();
            }, 100);
        }
    }
});

window.addEventListener('resize', () => {
    if (typeof updateAppScrollState === "function") updateAppScrollState();
});