// ==========================================================================
// MODULE: TAB HỢP ĐỒNG (HDTCXD)
// ==========================================================================

/**
 * Khởi tạo Tab HD: Setup Location và Lịch
 */
function initTabHD() {
    setupLocation("locationDropdown-hd", updateContractNo_HD);
    setupLuxuryCalendar("#dateDisplay-hd", "dateDisplay-hd", () => updateContractNo_HD());
}

/**
 * Reset Form Hợp đồng về trạng thái ban đầu
 */
function clearForm_HD() {
    document.getElementById("dataForm-hd").reset();
    
    // Đóng toàn bộ dropdown gợi ý
    document.querySelectorAll('#tab-hdtcxd .smooth-dropdown').forEach(d => {
        d.classList.remove('show');
        d.innerHTML = "";
    });
    
    // Thu hồi các trường hiển thị theo kiểu thác đổ
    const fieldsToClose = [
        "cont-field1-hd", "cont-field2-hd", "cont-field3-hd", 
        "cont-field4-hd", "cont-field5-hd", "radio-guarantee-container-hd", 
        "radio-payment-container-hd", "cont-field6-hd", "cont-field7-hd"
    ];
    fieldsToClose.forEach(closeSmoothly);
    
    document.getElementById("draftContractCheckbox-hd").checked = false;
    document.getElementById("pl01Checkbox-hd").checked = false;
    document.getElementById("field8-hd").value = "";

    // Reset Lịch về hôm nay
    const displayEl = document.getElementById("dateDisplay-hd");
    if (displayEl) {
        const fp = displayEl._flatpickr;
        const today = new Date();
        if (fp) fp.setDate(today, true);
        displayEl.textContent = formatDateToVietnamese(today);
        displayEl.classList.remove("different-date");
    }
    
    if (typeof updateContractNo_HD === "function") updateContractNo_HD();
}

/**
 * Xử lý chọn/bỏ chọn Radio Button tùy chỉnh
 */
function toggleRadio_HD(radio) {
    if (radio.wasChecked) {
        radio.checked = false;
        radio.wasChecked = false;
    } else {
        document.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => r.wasChecked = false);
        radio.wasChecked = true;
    }
}

/**
 * Kiểm tra giá trị tạm ứng để hiện/ẩn Radio Bảo lãnh
 */
function checkField5_HD() {
    const val = document.getElementById("field5-hd").value;
    if (val && val !== "0") showFieldSmoothly("radio-guarantee-container-hd");
    else {
        closeSmoothly("radio-guarantee-container-hd");
        document.querySelectorAll('input[name="option-hd"]').forEach(r => r.checked = false);
    }
}

/**
 * Tự động nhảy số Hợp đồng dựa trên Dự án, Nhà thầu và Năm
 */
function updateContractNo_HD() {
    try {
        const f3 = document.getElementById("field3-hd").value.split(" | ")[0] || ""; 
        const f2 = document.getElementById("field2-hd").value.split(" | ")[0] || ""; 
        const loc = document.getElementById("locationDropdown-hd").value || "";
        if (f3 && f2) {
            document.getElementById("field8-hd").value = `.../${new Date().getFullYear()}/HĐTCXD-${f2}/${loc}-${f3}`;
        }
    } catch (e) { console.error("Lỗi nhảy số HD:", e); }
}

/**
 * Xử lý chế độ Dự thảo hợp đồng
 */
function toggleHD_Draft(cb) {
    if(cb.checked) {
        document.getElementById("field3-hd").value = "... | Công ty ...";
        ["cont-field2-hd","cont-field3-hd","cont-field4-hd","cont-field5-hd","radio-payment-container-hd","cont-field6-hd","cont-field7-hd"].forEach(showFieldSmoothly);
    } else {
        document.getElementById("field3-hd").value = "";
        updateContractNo_HD();
    }
}

/**
 * Lọc danh sách gợi ý % tạm ứng
 */
function filterAdvance_HD(input) {
    closeAllDropdowns();
    currentFocusIndex = -1;
    input.value = input.value.replace(/\D/g, "").slice(0, 2);
    checkField5_HD();

    const data = ["0", "10", "15", "30"];
    const query = input.value;
    const drop = document.getElementById("drop-field5-hd");
    const filtered = data.filter(d => d.startsWith(query));

    if (filtered.length > 0) {
        drop.innerHTML = filtered.map(val => 
            `<div onmouseover="currentFocusIndex = -1; moveHighlight('drop-field5-hd')" 
                  onmousedown="selectAdvance_HD('${val}'); event.preventDefault();">
                  ${val}%
             </div>`
        ).join("");
        drop.classList.add("show");
    } else {
        drop.classList.remove("show");
    }
}

function selectAdvance_HD(val) {
    const input = document.getElementById("field5-hd");
    const drop = document.getElementById("drop-field5-hd");
    input.value = val;
    drop.classList.remove("show");
    currentFocusIndex = -1;
    checkField5_HD();
}

// ==========================================================================
// SHARED FILTERS: DÙNG CHUNG CHO HD VÀ TBKQ
// ==========================================================================

function coreFilter(inputId, dropId, dataKey) {
    closeAllDropdowns();
    currentFocusIndex = -1;
    const input = document.getElementById(inputId), drop = document.getElementById(dropId);
    const data = (dataKey === 'warranty') ? SYSTEM_DATA.hd.warranty : (SYSTEM_DATA.hd[dataKey] || []);
    const query = input.value.toLowerCase().trim();
    
    // 1. Lọc dữ liệu theo từ khóa tìm kiếm
    const filtered = data.filter(item => {
        const str = (typeof item === 'object') ? (item.searchString || item.display || "") : item;
        return str.toString().toLowerCase().includes(query);
    });

    // 2. Loại bỏ trùng lặp hiển thị (Deduplicate)
    const uniqueFiltered = [];
    const seen = new Set();
    for (const item of filtered) {
        const uniqueKey = (typeof item === 'object') ? (item.searchString || item.display || "") : item;
        const cleanKey = uniqueKey.toString().trim().toLowerCase();
        if (!seen.has(cleanKey)) {
            seen.add(cleanKey);
            uniqueFiltered.push(item);
        }
    }

    if (uniqueFiltered.length > 0) {
        // Tính toán độ rộng động cho prefix (Mã dự án/Mã nhà thầu)
        let maxChars = 0;
        uniqueFiltered.forEach(item => {
            const val = (typeof item === 'object') ? (item.searchString || item.display) : item;
            if (val.includes(" | ")) {
                const prefix = val.split(" | ")[0];
                if (prefix.length > maxChars) maxChars = prefix.length;
            }
        });
        const dynamicWidth = maxChars > 0 ? (maxChars * 8.5 + 2) : 0;
        drop.style.setProperty('--pw', dynamicWidth + 'px');

        // Bỏ hoàn toàn giới hạn .slice(0, 50) hiển thị theo yêu cầu
        drop.innerHTML = uniqueFiltered.map(item => {
            const val = (typeof item === 'object') ? (item.searchString || item.display) : item;
            let displayHTML = val;
            if (val.includes(" | ")) {
                const p = val.split(" | ");
                displayHTML = `<span class="dd-prefix">${p[0]}</span><span class="dd-divider">|</span><span class="dd-label">${p[1]}</span>`;
            }
            return `<div onmouseover="currentFocusIndex = -1; moveHighlight('${dropId}')" 
                         onmousedown="coreSelect('${inputId}', '${dropId}', '${escapeStr(val)}', '${escapeStr(item.category || "")}'); event.preventDefault();">
                         ${displayHTML}
                    </div>`;
        }).join("");
        drop.classList.add("show");
    } else { drop.innerHTML = ""; drop.classList.remove("show"); }
}

function coreSelect(inputId, dropId, value, extraValue) {
    const input = document.getElementById(inputId);
    input.value = value;
    const drop = document.getElementById(dropId);
    drop.classList.remove("show");
    drop.innerHTML = "";

    if (inputId === "field0-hd") document.getElementById("field1-hd").value = extraValue;
    if (inputId === "field0-tb") {
        document.getElementById("field-pkg-name-tb").value = extraValue;
        showFieldSmoothly("cont-pkg-name-tb");
    }
    
    const nextMap = {
        "field0-hd": ["cont-field1-hd", "cont-field2-hd"],
        "field2-hd": ["cont-field3-hd"],
        "field3-hd": ["cont-field4-hd", "cont-field5-hd"], 
        "field0-tb": ["cont-pkg-name-tb", "cont-field1-tb"],
        "field1-tb": ["cont-field2-tb", "cont-field4-tb"],
        "field2-tb": ["cont-field3-tb"],
        "field4-tb": ["cont-field5-tb"]
    };

    if (nextMap[inputId]) nextMap[inputId].forEach(id => showFieldSmoothly(id));

    if (inputId.includes("field2") || inputId.includes("field3")) {
        if (inputId.includes("-hd")) updateContractNo_HD();
        if (inputId.includes("-tb")) updateContractNo_TB();
    }
    currentFocusIndex = -1;
}