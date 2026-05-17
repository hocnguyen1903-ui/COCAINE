<script>
// ==========================================================================
// 1. KHỞI TẠO TAB PHỤ LỤC (PL)
// ==========================================================================

function initTabPL() {
    setupLuxuryCalendar("#dateDisplay-pl", "dateDisplay-pl", () => updateContractNo_PL());
    setupLuxuryCalendar("#field9-pl", "field9-pl", null);
    setupLocation("locationDropdown-pl", () => updateContractNo_PL());
    if (typeof filterField0_PL === 'function') filterField0_PL();
}

/**
 * Dọn dẹp Form Phụ lục và Reset Dashboard về trạng thái thác đổ ban đầu
 */
function clearForm_PL() {
    const form = document.getElementById("dataForm-pl");
    if (form) form.reset();
    
    selectedAdjustmentIds = [];
    selectedAdjustmentLabels = [];
    const field5 = document.getElementById("field5-pl");
    if (field5) {
        field5.value = "";
        const adjDrop = document.getElementById("dropdown-field5-pl");
        if (adjDrop) adjDrop.classList.remove("open-smooth");
    }
    
    const fieldsToClose = ["label-field2-pl", "label-field9-pl", "label-field10-pl"];
    fieldsToClose.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.remove('field-opening');
            el.classList.add('field-closing');
            setTimeout(() => { 
                if(el.classList.contains('field-closing')) el.style.display = 'none'; 
            }, 500);
        }
    });
    
    const pl01Checkbox = document.getElementById("pl01Checkbox-pl");
    if (pl01Checkbox) {
        pl01Checkbox.checked = false;
        pl01Checkbox.disabled = true;
        const wrapper = document.getElementById("pl01-wrapper");
        if (wrapper) {
            wrapper.style.opacity = "0.4";
            wrapper.style.cursor = "not-allowed";
        }
    }
    
    document.getElementById("field8-pl").value = "";
    currentFocusIndex = -1;

    const today = new Date();
    const displayEl = document.getElementById("dateDisplay-pl");
    if (displayEl) {
        const fp = displayEl._flatpickr;
        if (fp) fp.setDate(today, true);
        displayEl.textContent = formatDateToVietnamese(today);
        displayEl.classList.remove("different-date");
    }

    const fp9 = document.querySelector("#field9-pl")?._flatpickr;
    if (fp9) fp9.setDate(today, true);
    
    setTimeout(() => {
        if (typeof renderAdjustmentOptions_PL === "function") renderAdjustmentOptions_PL(); 
        PRECOMPUTED_PL_DATA = null;
        executeFilter_PL(true); 
        if (typeof updateContractNo_PL === 'function') updateContractNo_PL();
    }, 400); 
}

// ==========================================================================
// 2. SEARCH ENGINE: XỬ LÝ DỮ LIỆU & LỌC DASHBOARD PL
// ==========================================================================

/**
 * Tiền xử lý dữ liệu để Search nhanh (Regex, Nhân sự, Phân loại PL)
 */
function precomputePLData() {
    if (PRECOMPUTED_PL_DATA || !SYSTEM_DATA.pl.field0) return;
    
    PRECOMPUTED_PL_DATA = SYSTEM_DATA.pl.field0.map((item, index) => {
        const parts = item.display.split(/\s*\|\s*/);
        const ma = parts[0].trim();
        const goiThau = (item.note || "").trim();
        const nhaThauK = (item.searchK || "").trim();
        const nhanSuM = (item.searchM || "").trim();

        const plMatch = ma.match(/^PL(\d{2})\s*-\s*(.*)$/i);
        const isPL = !!plMatch;
        
        let numericValue = 0;
        const lastPart = parts[parts.length - 1]?.trim().replace(/\./g, "").replace(/đ/g, "").replace(/VND/gi, "") || "0";
        if (/^-?\d+$/.test(lastPart)) numericValue = parseInt(lastPart, 10);

        return { 
            ...item, 
            originalIndex: index,
            isPL: isPL,
            parentCode: isPL ? plMatch[2].trim() : ma,
            plNo: isPL ? parseInt(plMatch[1], 10) : 0,
            searchStr: `${ma} ${goiThau} ${nhaThauK}`.toLowerCase(),
            staffStr: nhanSuM.toLowerCase(),
            numericValue: numericValue,
            maHD: ma,
            rightParts: parts.slice(1).filter(p => p.trim() !== "")
        };
    });
}

function setFilterState_PL(state, event) {
    if(event) { event.preventDefault(); event.stopPropagation(); }
    currentFilterState_PL = state;
    executeFilter_PL(); 
    const input = document.getElementById("field0-pl");
    if (input) input.focus();
}

function filterField0_PL(isSearching = false) {
    clearTimeout(searchTimeout_PL);
    searchTimeout_PL = setTimeout(() => executeFilter_PL(isSearching), 150); 
}

function loadMoreData_PL(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    currentRenderLimit_PL += 50; 
    executeFilter_PL(false, true); 
}

/**
 * HÀM THỰC THI LỌC VÀ RENDER HTML DASHBOARD (CORE LOGIC)
 */
function executeFilter_PL(allowAnim = true, isLoadMore = false) {
    currentFocusIndex = -1;
    activeDropIndex_PL = -1;
    precomputePLData();

    const input = document.getElementById("field0-pl");
    const drop = document.getElementById("dropdown-field0-pl");
    if (!input || !drop || !PRECOMPUTED_PL_DATA) return;

    const query = input.value.toLowerCase().trim();
    if (query === '') document.getElementById('field8-pl').value = '';

    const currentInputVal = input.value.trim().toUpperCase();
    let savedScrollTop = isLoadMore ? drop.scrollTop : 0;
    if (!isLoadMore) currentRenderLimit_PL = 50; 

    // 1. GỌI HÀM LỌC & SẮP XẾP DATA
    const { finalData, sumHDPL, sumPL } = filterAndSortData_PL(query);

    // 2. GỌI HÀM RENDER HEADER
    const headerHTML = buildHeaderHTML_PL(sumHDPL, sumPL);

    // 3. RENDER DOM CỰC NHANH
    while (drop.firstChild) drop.removeChild(drop.lastChild);
    drop.insertAdjacentHTML('beforeend', headerHTML);

    if (finalData.length === 0) {
        drop.insertAdjacentHTML('beforeend', `<div class="disable-hover" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 280px;"><i class="bi bi-search" style="font-size: 40px; margin-bottom: 15px; color: #505966; opacity: 0.8;"></i><span style="font-size: 14px; font-style: italic; color: #7A828E;">Vui lòng nhập từ khóa để tìm kiếm...</span></div>`);
    } else {
        // 4. GỌI HÀM RENDER TỪNG DÒNG (Chỉ lấy đủ số lượng limit)
        const listHTML = finalData.slice(0, currentRenderLimit_PL)
            .map((item, index) => buildSingleItemHTML_PL(item, index, currentInputVal, allowAnim))
            .join("");
        
        drop.insertAdjacentHTML('beforeend', listHTML);

        // Nút Load More
        if (finalData.length > currentRenderLimit_PL) {
            const remaining = finalData.length - currentRenderLimit_PL;
            drop.insertAdjacentHTML('beforeend', `<div class="disable-hover" onmousedown="loadMoreData_PL(event)" onmouseover="this.style.background='rgba(255, 186, 8, 0.08)';" onmouseout="this.style.background='transparent';" style="display: flex; align-items: center; justify-content: center; padding: 16px; cursor: pointer; border-top: 1px solid rgba(255,255,255,0.04); background: transparent; transition: background 0.2s ease;"><span style="color: #95A1AF; font-size: 12px; font-weight: 400; letter-spacing: 0.3px;">Đang còn <b style="color: #FFBA08; font-weight: 700; font-size: 13px;">${remaining}</b> kết quả. Nhấn để tải thêm ... <i class="bi bi-chevron-double-down" style="color: #FFFFFF; font-size: 13px; position: relative; top: 1px; margin-left: 2px;"></i></span></div>`);
        }
    }
    
    drop.scrollTop = isLoadMore ? savedScrollTop : 0; 
}

// ========================================================================
// CÁC HÀM TIỆN ÍCH BỔ TRỢ CHO EXECUTE FILTER
// ========================================================================

/**
 * Hàm 1: Chuyên lo việc Lọc (Filter), Tính tiền (Math) và Sắp xếp (Sort)
 */
function filterAndSortData_PL(query) {
    let filtered = PRECOMPUTED_PL_DATA;

    // Lọc theo từ khóa
    if (query) {
        const keywords = query.split('+').map(k => k.trim()).filter(k => k !== "");
        filtered = filtered.filter(item => {
            return keywords.every(kw => {
                if (kw.startsWith("'")) return item.staffStr.includes(kw.substring(1).trim());
                else return item.searchStr.includes(kw);
            });
        });
    }

    // Lọc theo trạng thái Bàn giao
    if (currentFilterState_PL === 'DONE') filtered = filtered.filter(i => i.transferred === true);
    else if (currentFilterState_PL === 'PENDING') filtered = filtered.filter(i => !i.transferred);

    // Tính tổng tiền & Nhóm quan hệ Cha-Con
    let sumHDPL = 0, sumPL = 0;   
    const parentMap = new Map();
    const orphans =[];
    
    filtered.forEach(item => {
        sumHDPL += item.numericValue;
        if (item.isPL) sumPL += item.numericValue;
        if (!item.isPL) parentMap.set(item.parentCode, { parent: item, children:[] });
    });

    filtered.forEach(item => {
        if (item.isPL) {
            if (parentMap.has(item.parentCode)) parentMap.get(item.parentCode).children.push(item);
            else orphans.push(item);
        }
    });
    
    // Ghép mảng cuối cùng (Cha đứng trước, các Phụ lục con xếp ngay dưới)
    let finalData =[];
    const sortedParents = Array.from(parentMap.values()).sort((a, b) => b.parent.originalIndex - a.parent.originalIndex);
    sortedParents.forEach(group => {
        finalData.push(group.parent);
        group.children.sort((a, b) => a.plNo - b.plNo).forEach(c => finalData.push(c));
    });
    orphans.sort((a, b) => b.originalIndex - a.originalIndex).forEach(o => finalData.push(o));

    return { finalData, sumHDPL, sumPL };
}

/**
 * Hàm 2: Chuyên tạo chuỗi HTML cho Header (Có tính tổng tiền & Nút Filter)
 */
function buildHeaderHTML_PL(sumHDPL, sumPL) {
    const formatMoney = (n) => n.toLocaleString('vi-VN').replace(/,/g, '.');
    const getFltStyle = (type) => `cursor: pointer; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; color: ${currentFilterState_PL === type ? '#FFBA08' : '#222831'}; background: ${currentFilterState_PL === type ? '#222831' : 'transparent'}; border: ${currentFilterState_PL === type ? '1px solid #222831' : '1px solid rgba(34, 40, 49, 0.3)'}; transition: all 0.2s;`;
    
    return `<section class="disable-hover" style="position: sticky; top: 0; background: rgba(255, 186, 8); color: #222831; padding: 6px 12px; z-index: 50; border-bottom: 2px solid #1a1f26; display: flex; justify-content: space-between; align-items: center; font-size: 13px; transform: translateZ(0);">
        <span style="display: flex; gap: 15px; align-items: center;">
            <span style="display: flex; align-items: center; gap: 6px;">
                <i class="bi bi-currency-exchange" style="font-size: 17px;"></i>
                <span><b>Total Value: </b> <b style="color: #d32f2f; font-size: 14px;">${formatMoney(sumHDPL)}</b></span>
            </span>
            <span style="opacity: 0.3;">|</span>
            <span style="display: flex; align-items: center; gap: 6px;">
                <i class="bi bi-file-earmark-plus-fill" style="font-size: 16px;"></i>
                <span><b>Add: </b> <b style="color: #d32f2f; font-size: 14px;">${formatMoney(sumPL)}</b></span>
            </span>
        </span>
        <span style="display: flex; gap: 6px; align-items: center;">
            <span style="${getFltStyle('ALL')}" onmousedown="setFilterState_PL('ALL', event)">All</span>
            <span style="${getFltStyle('DONE')}" onmousedown="setFilterState_PL('DONE', event)">Sent</span>
            <span style="${getFltStyle('PENDING')}" onmousedown="setFilterState_PL('PENDING', event)">Pending</span>
        </span>
    </section>`;
}

/**
 * Hàm 3: Chuyên tạo chuỗi HTML cho 1 dòng dữ liệu (Row Template)
 */
function buildSingleItemHTML_PL(i, index, currentInputVal, allowAnim) {
    const isTransferredClass = i.transferred ? "" : "row-untransferred";
    const hasScanClass = (i.scanId && i.scanId.trim() !== "") ? "has-scan-file" : "";
    const isSelected = (i.maHD.toUpperCase() === currentInputVal);
    const selectedClass = isSelected ? "is-selected-row" : "";
    const animationClass = (allowAnim && index < 8) ? "pl-item-appear" : "";
    const animationDelay = (allowAnim && index < 8) ? `style="animation-delay: ${index * 0.04}s"` : "";
    const icon = i.transferred ? '<i class="bi bi-check-circle-fill" style="color: #2ECC71; margin-right: 14px; font-size: 10px;"></i>' : '<i class="bi bi-clock-history" style="color: #FFC000; margin-right: 14px; font-size: 10px;"></i>';
    
    let formattedMa = i.isPL ? `<span style="color: #7A828E; font-style: italic; padding-left: 12px;">› &nbsp;&nbsp; ${i.maHD}</span>` : `<span style="color: white; font-weight: 400;">${i.maHD}</span>`;
    let giaTriHTML = "";
    let displayParts = i.display.split(" | ");
    
    if (displayParts.length >= 2) {
        let yyRaw = displayParts[displayParts.length - 1].trim();
        let xxRaw = (displayParts.length >= 3 && /\d/.test(displayParts[displayParts.length - 2])) ? displayParts[displayParts.length - 2].trim() : "";
        const fmt = (val) => {
            let n = Number(val.replace(/\./g, ""));
            return (!isNaN(n) && n !== 0) ? n.toLocaleString('vi-VN').replace(/,/g, '.') : "";
        };
        let xx = fmt(xxRaw); let yy = fmt(yyRaw);
        let yyStyle = i.isPL ? "color: #7A828E; font-style: italic;" : "color: #FFBA08;";
        giaTriHTML = `<span style="display: inline-block; width: 90px; text-align: right; color: white; font-weight: 400;">${xx}</span><span style="display: inline-block; width: 35px; text-align: center; color: #505966;">|</span><span style="display: inline-block; width: 90px; text-align: right; ${yyStyle} font-weight: 400;">${yy}</span>`;
    }
    
    const prefixes =["CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP NHÂN CÔNG, VẬT TƯ, MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY THI CÔNG ", "CUNG CẤP VẬT TƯ PHỤ, NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ PHỤ, NHÂN CÔNG VÀ MÁY ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY MÓC ", "CUNG CẤP VẶT TƯ, NHÂN CÔNG HẠNG MỤC ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY MÓC THI CÔNG, ", "CUNG CẤP NHÂN CÔNG, VẬT TƯ VÀ MÁY THI CÔNG, ", "CUNG CẤP NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ PHỤ, NHÂN CÔNG, MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, MÁY ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, MÁY THI CÔNG ", "CUNG CẤP VẬT TƯ VÀ LẮP ĐẶT ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, ", "CUNG CẤP VẬT TƯ VÀ ", "CUNG CẤP VẬT TƯ, ", "CUNG CẤP VÀ LẮP ĐẶT ", "CUNG CẤP VÀ ", "CUNG CẤP, ", "NHÂN CÔNG, MÁY "];
    let cleanedPackage = i.packageI || "";
    if (cleanedPackage) { 
        for (const prefix of prefixes) { 
            if (cleanedPackage.startsWith(prefix)) { cleanedPackage = cleanedPackage.replace(prefix, "").trim(); break; } 
        } 
    }
    let noteParts = [i.dateH, cleanedPackage, i.searchM].filter(Boolean);
    let hoverText = noteParts.join(" -- ");

    return `<div class="${isTransferredClass} ${hasScanClass} ${animationClass} ${selectedClass} hoc-tooltip" ${animationDelay} data-display="${escapeStr(i.display)}" data-hovertext="${escapeStr(hoverText)}" onmousedown="if(event.button === 0 && !${i.isPL}) { selectField0_PL('${escapeStr(i.display)}'); }" oncontextmenu="showContextMenu_PL(event, this, '${escapeStr(i.maHD)}', ${!!i.transferred})" ontouchstart="handleTouchStart_Mobile(event, this, '${escapeStr(i.maHD)}', ${!!i.transferred})" ontouchend="handleTouchEnd_Mobile()" ontouchmove="handleTouchEnd_Mobile()"><div style="display: flex; align-items: center; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 15px;">${icon} <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${formattedMa}</span></div><div class="money-column-container">${giaTriHTML}</div></div>`;
}

function selectField0_PL(val) {
    const maHD = val.split(" | ")[0].trim();
    document.getElementById("field0-pl").value = maHD;
    updateContractNo_PL(); 
    const drop = document.getElementById("dropdown-field0-pl");
    if (drop) {
        const allRows = drop.querySelectorAll('.hoc-tooltip');
        allRows.forEach(row => row.classList.remove('is-selected-row'));
        const targetRow = drop.querySelector(`.hoc-tooltip[data-display="${escapeStr(val)}"]`);
        if (targetRow) targetRow.classList.add('is-selected-row');
    }
}

function updateContractNo_PL() {
    try {
        const f0 = document.getElementById("field0-pl").value.trim(); 
        const pl01Checkbox = document.getElementById("pl01Checkbox-pl");
        if (!f0) {
            if (pl01Checkbox) {
                pl01Checkbox.checked = false; pl01Checkbox.disabled = true; 
                pl01Checkbox.parentElement.style.opacity = "0.4"; pl01Checkbox.parentElement.style.cursor = "not-allowed";
            }
            return;
        }
        let maxPL = 0;
        const dataPL = SYSTEM_DATA.pl.field0 ||[];
        dataPL.forEach(item => {
            const displayStr = (item.display || "").toUpperCase();
            if (displayStr.includes(f0.toUpperCase()) && displayStr.startsWith("PL")) {
                const match = displayStr.match(/^PL(\d+)/);
                if (match && match[1]) {
                    const num = parseInt(match[1], 10);
                    if (num > maxPL) maxPL = num;
                }
            }
        });
        let nextPLNum = "";
        if (maxPL === 0) {
            pl01Checkbox.disabled = false; pl01Checkbox.parentElement.style.opacity = "1"; pl01Checkbox.parentElement.style.cursor = "pointer";
            if (pl01Checkbox.checked) nextPLNum = "01"; else nextPLNum = "02";
        } else {
            pl01Checkbox.checked = false; pl01Checkbox.disabled = true; 
            pl01Checkbox.parentElement.style.opacity = "0.4"; pl01Checkbox.parentElement.style.cursor = "not-allowed";
            nextPLNum = String(maxPL + 1).padStart(2, '0');
        }
        document.getElementById("field8-pl").value = `PL${nextPLNum} - ${f0}`;
    } catch (e) { console.error("Lỗi nhảy số PL:", e); }
}

/**
 * XỬ LÝ DROPDOWN NỘI DUNG ĐIỀU CHỈNH (ADJUSTMENT DETAILS)
 */
function toggleDropdown_PL5() { showDropdown_PL5(); }

function showDropdown_PL5() {
    const drop = document.getElementById("dropdown-field5-pl");
    if (!drop) return;
    renderAdjustmentOptions_PL();
    drop.classList.toggle("open-smooth");
}

function renderAdjustmentOptions_PL() {
    const drop = document.getElementById("dropdown-field5-pl");
    if (!drop) return;
    let html = '';
    PL_ADJUSTMENT_OPTIONS.forEach(opt => {
        const isChecked = selectedAdjustmentIds.includes(opt.id);
        const selectedClass = isChecked ? "selected-item" : ""; 
        html += `<div class="adjustment-item ${selectedClass}" onmousedown="event.preventDefault(); toggleAdjustment_PL(${opt.id}, '${opt.label}', '${opt.fieldToShow}')"><input type="checkbox" ${isChecked ? "checked" : ""} style="display:none !important;"><div class="custom-circle-check"></div><span>${opt.label}</span></div>`;
    });
    drop.innerHTML = html;
}

function toggleAdjustment_PL(id, label, fieldToShow) {
    const index = selectedAdjustmentIds.indexOf(id);
    if (index > -1) {
        selectedAdjustmentIds.splice(index, 1); selectedAdjustmentLabels.splice(index, 1);
        if(fieldToShow) closeSmoothly(fieldToShow); 
    } else {
        selectedAdjustmentIds.push(id); selectedAdjustmentLabels.push(label);
        if(fieldToShow) showFieldSmoothly(fieldToShow); 
    }
    document.getElementById("field5-pl").value = selectedAdjustmentLabels.join(" | ");
    renderAdjustmentOptions_PL(); 
}

</script>