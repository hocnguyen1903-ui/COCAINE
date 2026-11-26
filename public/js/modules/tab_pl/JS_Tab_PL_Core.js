
// ==========================================================================
// 1. KHỞI TẠO TAB PHỤ LỤC (PL)
// ==========================================================================

function initTabPL() {
    setupLuxuryCalendar("#dateDisplay-pl", "dateDisplay-pl", () => updateContractNo_PL());
    setupLuxuryCalendar("#field9-pl", "field9-pl", null);
    setupLocation("locationDropdown-pl", () => updateContractNo_PL());
    if (typeof filterField0_PL === 'function') filterField0_PL();

    const inp0 = document.getElementById("field0-pl");
    if (inp0) {
        inp0.addEventListener("focus", () => {
            const tok = localStorage.getItem('bcons_session_token');
            const idxApi = window.__BconsViewer && window.__BconsViewer.pl01Index;
            if (!tok || !idxApi || idxApi.state.syncing) return;
            const lastCheck = idxApi.state.lastMetaCheckAt || 0;
            if (!idxApi.state.ready || (Date.now() - lastCheck > 30000)) {
                idxApi.sync(false);
            }
        });
    }
}

/**
 * Dọn dẹp Form Phụ lục và Reset Dashboard về trạng thái thác đổ ban đầu
 */
let selectedContractMaHD_PL = "";
let activeSearchQuery_PL = "";


function clearForm_PL() {
    const form = document.getElementById("dataForm-pl");
    if (form) form.reset();
    
    selectedContractMaHD_PL = ""; 
    selectedRowDisplay_PL = ""; 
    activeSearchQuery_PL = ""; 
    currentFilterState_PL = 'ALL'; 
    currentRenderLimit_PL = 50; 
    selectedAdjustmentIds = [];
    selectedAdjustmentLabels = [];
    
    // (ĐÃ BỎ DÒNG drop.scrollTop = 0 Ở ĐÂY ĐỂ KHÔNG BỊ GIẬT TRƯỚC)

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
            }, 300);
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
    
    // Rút ngắn nhịp chờ xuống 150ms để form thu hồi và sóng đổ hòa quyện mượt mà 1 nhịp
    setTimeout(() => {
        if (typeof renderAdjustmentOptions_PL === "function") renderAdjustmentOptions_PL(); 
        PRECOMPUTED_PL_DATA = null;
        executeFilter_PL(true, false, false); 
        if (typeof updateContractNo_PL === 'function') updateContractNo_PL();
    }, 150); 
}

// ==========================================================================
// 2. SEARCH ENGINE: XỬ LÝ DỮ LIỆU & LỌC DASHBOARD PL
// ==========================================================================

function normalizeText_PL(str) {
    if (!str) return "";
    return str.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

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
            searchStr: normalizeText_PL(`${ma} ${goiThau} ${nhaThauK}`),
            staffStr: normalizeText_PL(nhanSuM),
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
/**
 * Hàm thực thi lọc và render HTML Dashboard
 * @param {boolean} allowAnim - Cho phép chạy hoạt ảnh xuất hiện
 * @param {boolean} isLoadMore - Đang nhấn nút tải thêm
 * @param {boolean} preserveScroll - Giữ nguyên vị trí cuộn (khi tạo PL, sửa data). Mặc định là false (cuộn về đỉnh)
 */
function executeFilter_PL(allowAnim = true, isLoadMore = false, preserveScroll = false, fromSyncCallback = false) {
    currentFocusIndex = -1;
    activeDropIndex_PL = -1;
    precomputePLData();

    const input = document.getElementById("field0-pl");
    const drop = document.getElementById("dropdown-field0-pl");
    if (!input || !drop || !PRECOMPUTED_PL_DATA) return;

    const savedScrollTop = drop.scrollTop;

    let query = "";
    if (selectedContractMaHD_PL && input.value.trim().toUpperCase() === selectedContractMaHD_PL.toUpperCase()) {
        query = (activeSearchQuery_PL || "").toLowerCase().trim();
    } else {
        query = input.value.toLowerCase().trim();
        activeSearchQuery_PL = query;
    }

    if (query === '' && !selectedContractMaHD_PL) {
        document.getElementById('field8-pl').value = '';
    }

    const idxApi = window.__BconsViewer && window.__BconsViewer.pl01Index;
    if (query.includes("#") && idxApi && !idxApi.state.ready && !fromSyncCallback) {
        const tok = localStorage.getItem('bcons_session_token');
        if (tok && !idxApi._pendingFilterRefresh) {
            idxApi._pendingFilterRefresh = true;
            const pendingSync = idxApi.state.syncPromise || idxApi.sync(false);
            Promise.resolve(pendingSync).finally(() => {
                idxApi._pendingFilterRefresh = false;
                if (activeTabId === 'tab-plhd') executeFilter_PL(false, false, true, true);
            });
        }
    }

    const currentInputVal = selectedContractMaHD_PL ? selectedContractMaHD_PL.toUpperCase() : input.value.trim().toUpperCase();

    if (!isLoadMore) currentRenderLimit_PL = Math.max(currentRenderLimit_PL, 50); 

    const { finalData, sumHDPL, sumPL } = filterAndSortData_PL(query);

    const headerHTML = buildHeaderHTML_PL(sumHDPL, sumPL);

    while (drop.firstChild) drop.removeChild(drop.lastChild);
    drop.insertAdjacentHTML('beforeend', headerHTML);

    if (finalData.length === 0) {
        const isSyncingHash = query.includes("#") && idxApi && idxApi.state.syncing;
        const emptyText = isSyncingHash ? "Đang đồng bộ chỉ mục Phụ lục 01..." : "Vui lòng nhập từ khóa để tìm kiếm...";
        drop.insertAdjacentHTML('beforeend', `<div class="disable-hover" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 280px;"><i class="bi bi-search" style="font-size: 40px; margin-bottom: 15px; color: #505966; opacity: 0.8;"></i><span style="font-size: 14px; font-style: italic; color: #7A828E;">${emptyText}</span></div>`);
    } else {
        const listHTML = finalData.slice(0, currentRenderLimit_PL)
            .map((item, index) => buildSingleItemHTML_PL(item, index, currentInputVal, allowAnim))
            .join("");
        
        drop.insertAdjacentHTML('beforeend', listHTML);

        if (finalData.length > currentRenderLimit_PL) {
            const remaining = finalData.length - currentRenderLimit_PL;
            drop.insertAdjacentHTML('beforeend', `<div class="disable-hover" onmousedown="loadMoreData_PL(event)" onmouseover="this.style.background='rgba(255, 186, 8, 0.08)';" onmouseout="this.style.background='transparent';" style="display: flex; align-items: center; justify-content: center; padding: 16px; cursor: pointer; border-top: 1px solid rgba(255,255,255,0.04); background: transparent; transition: background 0.2s ease;"><span style="color: #95A1AF; font-size: 12px; font-weight: 400; letter-spacing: 0.3px;">Đang còn <b style="color: #FFBA08; font-weight: 700; font-size: 13px;">${remaining}</b> kết quả. Nhấn để tải thêm ... <i class="bi bi-chevron-double-down" style="color: #FFFFFF; font-size: 13px; position: relative; top: 1px; margin-left: 2px;"></i></span></div>`);
        }
    }
    
    drop.scrollTop = (isLoadMore || preserveScroll) ? savedScrollTop : 0;
}

function findPl01RecordForItem_PL(item) {
    const idxApi = window.__BconsViewer && window.__BconsViewer.pl01Index;
    if (!idxApi || !idxApi.state || !idxApi.state.ready || item.isPL) return null;

    const byMa = idxApi.state.byMaHD.get((item.maHD || "").toUpperCase());
    if (byMa) return byMa;

    if (item.scanId && item.scanId.includes("|")) {
        const entries = item.scanId.split(";;");
        for (let i = 0; i < entries.length; i++) {
            const fId = (entries[i].split("|")[0] || "").trim();
            if (!fId) continue;
            const byId = idxApi.state.byFileId.get(fId);
            if (byId) return byId;
        }
    }
    return null;
}

function mergePl01Matches_PL(branchPayloads, allHashTermsOrder, idxApi) {
    if (!branchPayloads || branchPayloads.length === 0) return null;

    const normTerm = (q) => (idxApi && typeof idxApi.normalize === "function")
        ? idxApi.normalize(q)
        : normalizeText_PL(q);

    const matchedByNorm = new Map();
    const branchSummaries = [];
    let primaryMatch = null;

    branchPayloads.forEach(termMatches => {
        if (!termMatches || termMatches.length === 0) return;

        let branchPct = 100;
        let branchScore = 0;
        termMatches.forEach(m => {
            if (m.bestPct < branchPct) branchPct = m.bestPct;
            branchScore += m.totalScore;
            const nk = normTerm(m.rawQuery);
            if (nk && !matchedByNorm.has(nk)) {
                matchedByNorm.set(nk, m);
            }
            if (
                !primaryMatch ||
                m.bestPct > primaryMatch.bestPct ||
                (m.bestPct === primaryMatch.bestPct && m.totalScore > primaryMatch.totalScore)
            ) {
                primaryMatch = m;
            }
        });

        let branchBestCount = 0;
        let branchHasLowerTier = false;
        termMatches.forEach(m => {
            if (m.bestPct === branchPct) branchBestCount += m.bestCount;
            else if (m.bestPct < branchPct) branchHasLowerTier = true;
            if (m.hasLowerTier) branchHasLowerTier = true;
        });

        branchSummaries.push({
            branchPct,
            branchBestCount,
            branchHasLowerTier,
            branchScore
        });
    });

    if (!primaryMatch || branchSummaries.length === 0) return null;

    let bestPct = 0;
    let totalScore = 0;
    branchSummaries.forEach(b => {
        if (b.branchPct > bestPct) bestPct = b.branchPct;
        totalScore += b.branchScore;
    });

    let bestCount = 0;
    let hasLowerTier = false;
    branchSummaries.forEach(b => {
        if (b.branchPct === bestPct) bestCount += b.branchBestCount;
        else if (b.branchPct < bestPct) hasLowerTier = true;
        if (b.branchHasLowerTier) hasLowerTier = true;
    });

    const rawSections = [];
    const seenOrderNorms = new Set();
    const orderedTerms = Array.isArray(allHashTermsOrder) && allHashTermsOrder.length > 0
        ? allHashTermsOrder
        : Array.from(matchedByNorm.values()).map(m => m.rawQuery);

    orderedTerms.forEach(rawTerm => {
        const nk = normTerm(rawTerm);
        if (!nk || seenOrderNorms.has(nk)) return;
        seenOrderNorms.add(nk);

        const matched = matchedByNorm.get(nk);
        const origIdx = rawSections.length;
        if (matched) {
            rawSections.push({
                query: matched.rawQuery || rawTerm,
                matched: true,
                bestPct: matched.bestPct,
                totalScore: matched.totalScore || 0,
                origIdx: origIdx,
                rawGroups: matched.groups || []
            });
        } else {
            rawSections.push({
                query: rawTerm,
                matched: false,
                bestPct: 0,
                totalScore: 0,
                origIdx: origIdx,
                rawGroups: []
            });
        }
    });

    // Ưu tiên từ khóa có khớp trong hợp đồng (và đạt % / điểm cao hơn) lên trên
    rawSections.sort((a, b) => {
        if (a.matched !== b.matched) return a.matched ? -1 : 1;
        if (a.matched) {
            if (b.bestPct !== a.bestPct) return b.bestPct - a.bestPct;
            if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        }
        return a.origIdx - b.origIdx;
    });

    const sections = rawSections.map((sec, sIdx) => ({
        query: sec.query,
        matched: sec.matched,
        bestPct: sec.bestPct,
        totalScore: sec.totalScore,
        groups: sec.rawGroups.map(g => ({ ...g, sectionIdx: sIdx }))
    }));

    const allGroups = [];
    sections.forEach(sec => {
        if (sec.matched && sec.groups.length > 0) {
            allGroups.push(...sec.groups);
        }
    });

    const matchedSectionCount = sections.filter(s => s.matched).length;

    return {
        fileId: primaryMatch.fileId,
        maHD: primaryMatch.maHD,
        apStart: primaryMatch.apStart,
        rawQuery: primaryMatch.rawQuery,
        bestPct: bestPct,
        bestCount: bestCount,
        hasLowerTier: hasLowerTier,
        totalMatches: allGroups.reduce((acc, g) => acc + (g.count || 0), 0),
        totalScore: totalScore,
        matchedSectionCount: matchedSectionCount,
        groups: allGroups,
        sections: sections
    };
}

function filterAndSortData_PL(query) {
    let filtered = PRECOMPUTED_PL_DATA;
    let hasActiveHashSearch = false;
    const hashContextByFileId = new Map();
    const hashContextByMaHD = new Map();
    let firstRawHashQuery = "";

    const idxApi = window.__BconsViewer && window.__BconsViewer.pl01Index;

    if (query) {
        const orGroups = query.split('|').map(g => g.trim()).filter(g => g !== "");
        if (orGroups.length > 0) {
            const parsedGroups = orGroups.map(group => {
                const andKeywords = group.split('+').map(k => k.trim()).filter(k => k !== "");
                const hashTerms = [];
                const staffTerms = [];
                const normalTerms = [];

                andKeywords.forEach(kw => {
                    if (kw.startsWith("#")) {
                        hasActiveHashSearch = true;
                        const hq = kw.substring(1).trim();
                        if (hq && !firstRawHashQuery) firstRawHashQuery = hq;
                        hashTerms.push(hq);
                    } else if (kw.startsWith("'")) {
                        staffTerms.push(normalizeText_PL(kw.substring(1)));
                    } else {
                        normalTerms.push(normalizeText_PL(kw));
                    }
                });
                return { hashTerms, staffTerms, normalTerms };
            }).filter(pg => (pg.hashTerms.length + pg.staffTerms.length + pg.normalTerms.length) > 0);

            const allHashTermsOrder = [];
            parsedGroups.forEach(pg => {
                pg.hashTerms.forEach(ht => {
                    if (ht) allHashTermsOrder.push(ht);
                });
            });

            if (parsedGroups.length > 0) {
                const matchedRows = [];
                for (let idx = 0; idx < filtered.length; idx++) {
                    const item = filtered[idx];
                    let groupMatched = false;
                    const matchedBranchPayloads = [];
                    let pl01Record = undefined;

                    for (let gIdx = 0; gIdx < parsedGroups.length; gIdx++) {
                        const pg = parsedGroups[gIdx];
                        const staffOk = pg.staffTerms.every(sq => sq === "" || item.staffStr.includes(sq));
                        if (!staffOk) continue;
                        const normOk = pg.normalTerms.every(nq => nq === "" || item.searchStr.includes(nq));
                        if (!normOk) continue;

                        if (pg.hashTerms.length === 0) {
                            groupMatched = true;
                            if (!hasActiveHashSearch) break;
                            continue;
                        }

                        if (item.isPL || !idxApi || !idxApi.state.ready) continue;
                        if (pl01Record === undefined) {
                            pl01Record = findPl01RecordForItem_PL(item);
                        }
                        if (!pl01Record) continue;

                        const termMatches = [];
                        let allHashOk = true;
                        for (let h = 0; h < pg.hashTerms.length; h++) {
                            const hTerm = pg.hashTerms[h];
                            if (!hTerm) { allHashOk = false; break; }
                            const mRes = idxApi.matchContract(pl01Record, hTerm);
                            if (!mRes) { allHashOk = false; break; }
                            termMatches.push(mRes);
                        }

                        if (allHashOk && termMatches.length > 0) {
                            groupMatched = true;
                            matchedBranchPayloads.push(termMatches);
                        }
                    }

                    if (groupMatched) {
                        const bestItemMatch = matchedBranchPayloads.length > 0
                            ? mergePl01Matches_PL(matchedBranchPayloads, allHashTermsOrder, idxApi)
                            : null;
                        if (bestItemMatch) {
                            hashContextByFileId.set(bestItemMatch.fileId, bestItemMatch);
                            hashContextByMaHD.set(item.maHD.toUpperCase(), bestItemMatch);
                            matchedRows.push({ ...item, _pl01Match: bestItemMatch });
                        } else {
                            matchedRows.push(item);
                        }
                    }
                }
                filtered = matchedRows;
            }
        }
    }

    if (hasActiveHashSearch) {
        window.activeHashContext_PL = {
            query: firstRawHashQuery,
            byFileId: hashContextByFileId,
            byMaHD: hashContextByMaHD
        };
    } else {
        window.activeHashContext_PL = null;
    }

    if (currentFilterState_PL === 'DONE') filtered = filtered.filter(i => i.transferred === true);
    else if (currentFilterState_PL === 'PENDING') filtered = filtered.filter(i => !i.transferred);
    else if (currentFilterState_PL === 'HAS_FILE') filtered = filtered.filter(i => Boolean(i.scanId && i.scanId.includes("|")));

    let sumHDPL = 0, sumPL = 0;   
    const parentMap = new Map();
    const orphans = [];
    
    filtered.forEach(item => {
        sumHDPL += item.numericValue;
        if (item.isPL) sumPL += item.numericValue;
        if (!item.isPL) parentMap.set(item.parentCode, { parent: item, children: [] });
    });

    filtered.forEach(item => {
        if (item.isPL) {
            if (parentMap.has(item.parentCode)) parentMap.get(item.parentCode).children.push(item);
            else orphans.push(item);
        }
    });
    
    let finalData = [];
    const sortedParents = Array.from(parentMap.values()).sort((a, b) => {
        if (hasActiveHashSearch) {
            const mA = a.parent._pl01Match;
            const mB = b.parent._pl01Match;
            if (mA && mB) {
                const secDiff = (mB.matchedSectionCount || 0) - (mA.matchedSectionCount || 0);
                if (secDiff !== 0) return secDiff;
                const tierDiff = mB.bestPct - mA.bestPct;
                if (tierDiff !== 0) return tierDiff;
                const scoreDiff = mB.totalScore - mA.totalScore;
                if (scoreDiff !== 0) return scoreDiff;
                const cntDiff = mB.bestCount - mA.bestCount;
                if (cntDiff !== 0) return cntDiff;
            } else if (mB && !mA) {
                return 1;
            } else if (mA && !mB) {
                return -1;
            }
        }
        return b.parent.originalIndex - a.parent.originalIndex;
    });

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
    const getFltStyle = (type) => `cursor: pointer; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; color: ${currentFilterState_PL === type ? '#FFBA08' : '#031c35'}; background: ${currentFilterState_PL === type ? '#031c35' : 'transparent'}; border: ${currentFilterState_PL === type ? '1px solid #031c35' : '1px solid rgba(3, 28, 53, 0.3)'}; transition: all 0.2s;`;
    
    return `<section class="disable-hover" style="position: sticky; top: 0; background: #FFBA08; color: #031c35; padding: 6px 12px; z-index: 50; border-bottom: 1.5px solid rgba(0, 0, 0, 0.2); display: flex; justify-content: space-between; align-items: center; font-size: 13px; transform: translateZ(0);">
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
            <span style="${getFltStyle('HAS_FILE')}" onmousedown="setFilterState_PL('HAS_FILE', event)">Files</span>
        </span>
    </section>`;
}

/**
 * Mở trực tiếp file Scan H hoặc G từ badge (Đưa ra ngoài phạm vi vòng lặp)
 */
window.openDirectFile_PL = function(fileId, event) {
    if (event) {
        if (event.button !== 0) return; // Chỉ kích hoạt khi bấm chuột trái
        event.preventDefault();
        event.stopPropagation();
    }
    if (!fileId) return;
    const targetRow = event ? event.target.closest('.hoc-tooltip') : null;
    viewScanFile_PL(fileId, null, targetRow);
};

/**
 * Hàm 3: Chuyên tạo chuỗi HTML cho 1 dòng dữ liệu (Row Template)
 */
function buildSingleItemHTML_PL(i, index, currentInputVal, allowAnim) {
    const isTransferredClass = i.transferred ? "" : "row-untransferred";
    
    // Kiểm tra dòng đang chọn
    const isSelected = (selectedRowDisplay_PL && i.display === selectedRowDisplay_PL) || 
                       (!selectedRowDisplay_PL && i.maHD.toUpperCase() === currentInputVal);
                       
    // Giữ trạng thái preview highlight đồng bộ ngay cả khi re-render/filter dashboard
    const isPreviewing = Boolean(typeof currentPreviewFileId_PL !== 'undefined' && 
                                 currentPreviewFileId_PL && 
                                 i.scanId && 
                                 i.scanId.includes(currentPreviewFileId_PL));

    const selectedClass = isSelected ? "is-selected-row active" : "";
    const previewClass = isPreviewing ? "is-previewing-row" : "";
    const plRowClass = i.isPL ? "is-pl-row" : "";
    const animationClass = (allowAnim && index < 8) ? "pl-item-appear" : "";
    const animationDelay = (allowAnim && index < 8) ? `style="animation-delay: ${index * 0.04}s"` : "";
    
    const icon = i.transferred 
        ? '<i class="bi bi-check-circle-fill" style="color: #2ECC71; font-size: 10.5px; width: 14px; display: inline-flex; justify-content: center; margin-right: 12px; flex-shrink: 0;"></i>' 
        : '<i class="bi bi-clock-history" style="color: #FFC000; font-size: 10.5px; width: 14px; display: inline-flex; justify-content: center; margin-right: 12px; flex-shrink: 0;"></i>';
    
    let formattedMa = i.isPL 
        ? `<span style="color: #94A3B8; font-style: italic; padding-left: 12px; font-size: 11.5px; font-weight: 400;">› &nbsp;&nbsp; ${i.maHD}</span>` 
        : `<span style="color: #FFFFFF; font-weight: 500; font-size: 11.5px; letter-spacing: 0.2px;">${i.maHD}</span>`;
    let giaTriHTML = "";
    let displayParts = i.display.split(" | ");
    
    if (displayParts.length >= 2) {
        let yyRaw = displayParts[displayParts.length - 1].trim();
        let xxRaw = (displayParts.length >= 3 && /\d/.test(displayParts[displayParts.length - 2])) ? displayParts[displayParts.length - 2].trim() : "";
        const fmt = (val) => {
            let n = Number(val.replace(/\./g, ""));
            return (!isNaN(n) && n !== 0) ? n.toLocaleString('vi-VN').replace(/,/g, '.') : "";
        };
        let xx = fmt(xxRaw); 
        let yy = fmt(yyRaw);
        let yyStyle = i.isPL ? "color: #7A828E; font-style: italic;" : "color: #FFBA08;";
        giaTriHTML = `<span style="display: inline-block; width: 90px; text-align: right; color: white; font-weight: 400;">${xx}</span><span style="display: inline-block; width: 35px; text-align: center; color: #505966;">|</span><span style="display: inline-block; width: 90px; text-align: right; ${yyStyle} font-weight: 400;">${yy}</span>`;
    }

    // ========================================================================
    // LOGIC NHẬN DIỆN & TRÍCH XUẤT ĐẦY ĐỦ FILEID + TÊN FILE GỐC CHO H VÀ G
    // ========================================================================
    let fileIdH = "";
    let fileIdG = "";
    let isDigitizedH = false;
    let isDigitizedG = false;

    if (i.scanId && i.scanId.trim() !== "") {
        const fileEntries = i.scanId.split(";;").filter(f => f && f.includes("|"));
        fileEntries.forEach(entry => {
            const parts = entry.split("|");
            const fId = parts[0].trim();
            const fNameRaw = (parts[1] || "").trim();
            const fNameLower = fNameRaw.toLowerCase();
            const fDigitized = (parts[2] || "").trim() === "1";
            
            const isPDG = /pdg|pđg|phe\s*duyet\s*gia|phê\s*duyệt\s*giá/i.test(fNameLower) || 
                          /\b(gia|giá)\b/i.test(fNameLower);
            
            if (isPDG) {
                if (!fileIdG) {
                    fileIdG = fId;
                    isDigitizedG = fDigitized;
                }
            } else {
                if (i.isPL) {
                    const plPart = (i.maHD.split(" - ")[0] || "").toLowerCase();
                    if (fNameLower.includes(plPart)) {
                        fileIdH = fId;
                        isDigitizedH = fDigitized;
                    } else if (!fileIdH) {
                        fileIdH = fId;
                        isDigitizedH = fDigitized;
                    }
                } else if (!fileIdH) {
                    fileIdH = fId;
                    isDigitizedH = fDigitized;
                }
            }
        });
    }

    const hasH = Boolean(fileIdH);
    const hasG = Boolean(fileIdG);

    // 🚀 PL và PDG khi có file thì mặc định XANH (Ready). Riêng HD gốc vẫn theo trạng thái số hóa
    const isReadyH = i.isPL ? hasH : isDigitizedH;
    const hClass = !hasH ? 'dim' : (isReadyH ? 'active' : 'pending');
    const gClass = !hasG ? 'dim' : 'active';

    const hClick = hasH ? `onmousedown="openDirectFile_PL('${fileIdH}', event);"` : "";
    const gClick = hasG ? `onmousedown="openDirectFile_PL('${fileIdG}', event);"` : "";

    const hTitle = i.isPL ? 'PL' : 'HD';
    const hDesc = !hasH ? 'None' : (isReadyH ? 'Ready' : 'Draft');
    const gTitle = 'PDG';
    const gDesc = !hasG ? 'None' : 'Ready';

    const fileStatusHTML = `
    <div class="file-status-group">
        <span class="file-icon ${hClass}"
              ${hClick}
              data-dot-title="${hTitle}"
              data-dot-desc="${hDesc}">
        </span>

        <span class="file-icon ${gClass}"
              ${gClick}
              data-dot-title="${gTitle}"
              data-dot-desc="${gDesc}">
        </span>
    </div>
`;

    const prefixes = ["CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP NHÂN CÔNG, VẬT TƯ, MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY THI CÔNG ", "CUNG CẤP VẬT TƯ PHỤ, NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ PHỤ, NHÂN CÔNG VÀ MÁY ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY MÓC ", "CUNG CẤP VẶT TƯ, NHÂN CÔNG HẠNG MỤC ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG VÀ MÁY MÓC THI CÔNG, ", "CUNG CẤP NHÂN CÔNG, VẬT TƯ VÀ MÁY THI CÔNG, ", "CUNG CẤP NHÂN CÔNG VÀ MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ PHỤ, NHÂN CÔNG, MÁY THI CÔNG, ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, MÁY ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, MÁY THI CÔNG ", "CUNG CẤP VẬT TƯ VÀ LẮP ĐẶT ", "CUNG CẤP VẬT TƯ, NHÂN CÔNG, ", "CUNG CẤP VẬT TƯ VÀ ", "CUNG CẤP VẬT TƯ, ", "CUNG CẤP VÀ LẮP ĐẶT ", "CUNG CẤP VÀ ", "CUNG CẤP, ", "NHÂN CÔNG, MÁY "];
    let cleanedPackage = i.packageI || "";
    if (cleanedPackage) { 
        for (const prefix of prefixes) { 
            if (cleanedPackage.startsWith(prefix)) { cleanedPackage = cleanedPackage.replace(prefix, "").trim(); break; } 
        } 
    }
    let noteParts = [i.dateH, cleanedPackage, i.searchM].filter(Boolean);
    let hoverText = noteParts.join(" -- ");

    let matchBadgeHTML = "";
    if (i._pl01Match) {
        const m = i._pl01Match;
        let badgeColor = "#FF4D4D";
        let badgeBg = "rgba(255, 77, 77, 0.12)";

        if (m.bestPct === 100) {
            badgeColor = "#2ECC71";
            badgeBg = "rgba(46, 204, 113, 0.12)";
        } else if (m.bestPct === 75) {
            badgeColor = "#FFBA08";
            badgeBg = "rgba(255, 186, 8, 0.12)";
        } else if (m.bestPct === 60) {
            badgeColor = "#FF7A00";
            badgeBg = "rgba(255, 122, 0, 0.12)";
        }

        const targetMatchFileId = fileIdH || m.fileId;
        const badgeClick = targetMatchFileId ? `onmousedown="openDirectFile_PL('${escapeStr(targetMatchFileId)}', event);"` : "";
        matchBadgeHTML = `<span class="pl01-match-badge" ${badgeClick} style="color: ${badgeColor}; background: ${badgeBg};">${m.bestPct}% ×${m.bestCount}${m.hasLowerTier ? ' +' : ''}</span>`;
    }

    const uploadHintHTML = window.activeHashContext_PL ? "" : `
                <div class="row-upload-hint" onmousedown="if(event.button === 0) { event.stopPropagation(); openScanPanel_PL('${escapeStr(i.maHD)}'); }">
                    <i class="bi bi-cloud-arrow-up"></i>
                    <span>Up file here</span>
                </div>`;

    return `<div class="${isTransferredClass} ${animationClass} ${selectedClass} ${previewClass} ${plRowClass} hoc-tooltip" 
                 ${animationDelay} 
                 data-display="${escapeStr(i.display)}" 
                 data-hovertext="${escapeStr(hoverText)}" 
                 onmousedown="if(event.button === 0) { selectField0_PL('${escapeStr(i.display)}'); }" 
                 oncontextmenu="showContextMenu_PL(event, this, '${escapeStr(i.maHD)}', ${Boolean(i.transferred)})" 
                 ontouchstart="handleTouchStart_Mobile(event, this, '${escapeStr(i.maHD)}', ${Boolean(i.transferred)})" 
                 ontouchend="handleTouchEnd_Mobile()" 
                 ontouchmove="handleTouchEnd_Mobile()">
                <div style="display: flex; align-items: center; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 15px;">
                    ${icon} 
                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${formattedMa}</span>
                    ${matchBadgeHTML}
                </div>
                ${uploadHintHTML}
                <div class="money-column-container" style="display: flex; align-items: center; justify-content: flex-end;">
                    ${giaTriHTML}
                    ${fileStatusHTML}
                </div>
            </div>`;
}

let selectedRowDisplay_PL = ""; // Lưu vết chính xác dòng đang click chọn (kể cả dòng PL)

function selectField0_PL(val) {
    if (!val) return;
    selectedRowDisplay_PL = val;

    let rawMa = val.split(" | ")[0].trim();
    
    // Nếu click vào dòng Phụ lục, tự động bóc tách lấy mã Hợp đồng gốc
    let parentMaHD = rawMa;
    const plMatch = rawMa.match(/^PL\d+\s*-\s*(.*)$/i);
    if (plMatch && plMatch[1]) {
        parentMaHD = plMatch[1].trim();
    }

    selectedContractMaHD_PL = parentMaHD;
    document.getElementById("field0-pl").value = parentMaHD;
    
    // Tự động tính toán và nhảy số PL mới nhất tiếp theo
    updateContractNo_PL(); 
    
    // Đổi hiệu ứng sáng nền trực tiếp trên Dashboard
    const drop = document.getElementById("dropdown-field0-pl");
    if (drop) {
        const allRows = Array.from(drop.querySelectorAll('.hoc-tooltip'));
        allRows.forEach((row, idx) => {
            row.classList.remove('is-selected-row', 'active');
            // Sáng nền đúng dòng vừa click chọn (dù là HD hay PL)
            if (row.getAttribute("data-display") === val) {
                row.classList.add('is-selected-row', 'active');
                currentFocusIndex = idx;
            }
        });
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

// ==========================================================================
// BỘ ĐIỀU HƯỚNG BÀN PHÍM TOÀN CỤC TAB PHỤ LỤC (WINDOWS & MACOS COMPATIBLE)
// ==========================================================================
document.addEventListener("keydown", function(e) {
    if (activeTabId !== 'tab-plhd') return;

    // 1. Không can thiệp nếu đang mở các bảng Modal / Panel
    const isModalOpen = (document.getElementById('data-delete-confirm-overlay')?.style.display === 'flex') ||
                        (document.getElementById('cancel-transfer-confirm-overlay')?.style.display === 'flex') ||
                        (document.getElementById('edit-panel-pl')?.classList.contains('active')) ||
                        (document.getElementById('scan-panel-pl')?.classList.contains('active')) ||
                        (document.getElementById('transfer-panel-pl')?.classList.contains('active'));
    if (isModalOpen) return;

    const activeEl = document.activeElement;
    const drop = document.getElementById("dropdown-field0-pl");
    if (!drop) return;
    const items = Array.from(drop.querySelectorAll('.hoc-tooltip'));
    if (items.length === 0) return;

    // 2. XỬ LÝ PHÍM MŨI TÊN LÊN / XUỐNG (ArrowUp / ArrowDown)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const isOtherInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id !== 'field0-pl';
        if (isOtherInput) return;

        e.preventDefault();

        if (typeof currentFocusIndex === 'undefined' || currentFocusIndex < 0) {
            const selectedIdx = items.findIndex(item => item.classList.contains('is-selected-row') || item.classList.contains('active'));
            currentFocusIndex = selectedIdx >= 0 ? selectedIdx : -1;
        }

        if (e.key === "ArrowDown") {
            currentFocusIndex++;
            if (currentFocusIndex >= items.length) currentFocusIndex = 0;
        } else {
            currentFocusIndex--;
            if (currentFocusIndex < 0) currentFocusIndex = items.length - 1;
        }

        items.forEach((item, idx) => {
            if (idx === currentFocusIndex) {
                item.classList.add("active");
                item.scrollIntoView({ block: "nearest", behavior: "smooth" });
            } else {
                item.classList.remove("active");
            }
        });
        return;
    }

    // 3. XỬ LÝ PHÍM ENTER & TAB (Chọn dòng đang highlight hoặc dòng đầu tiên và chuyển sang field tiếp theo)
    if (e.key === "Enter" || e.key === "Tab") {
        const isField0 = activeEl && activeEl.id === 'field0-pl';
        if (isField0 || (typeof currentFocusIndex !== 'undefined' && currentFocusIndex >= 0)) {
            const targetItem = (typeof currentFocusIndex !== 'undefined' && currentFocusIndex >= 0 && items[currentFocusIndex]) 
                ? items[currentFocusIndex] 
                : items[0];

            if (targetItem) {
                const displayVal = targetItem.getAttribute("data-display");
                if (displayVal) {
                    e.preventDefault();
                    selectField0_PL(displayVal);
                    currentFocusIndex = -1;
                    document.getElementById('field5-pl')?.focus();
                }
            }
        }
        return;
    }

    // 4. XỬ LÝ PHÍM XÓA: DELETE (WINDOWS/FN+DELETE) & BACKSPACE (MAC DELETE / CMD+DELETE)
    const isDeleteAction = (e.key === "Delete" || e.key === "Del" || e.key === "Backspace" || e.keyCode === 46 || e.keyCode === 8);
    if (isDeleteAction) {
        // 🚀 VÔ HIỆU HÓA HOÀN TOÀN KHI CON TRỎ ĐANG Ở TRONG BẤT KỲ Ô INPUT NÀO (KỂ CẢ Ô TÌM KIẾM)
        const isInsideInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
        if (isInsideInput) {
            return; // Chỉ thực hiện thao tác xóa chữ bình thường trong ô text, không mở modal xóa hợp đồng
        }

        let targetElement = (typeof currentFocusIndex !== 'undefined' && currentFocusIndex >= 0 && items[currentFocusIndex])
            ? items[currentFocusIndex]
            : (drop.querySelector('.hoc-tooltip.is-selected-row') || drop.querySelector('.hoc-tooltip.active'));

        let maToDelete = "";
        if (targetElement) {
            const displayVal = targetElement.getAttribute("data-display");
            if (displayVal) maToDelete = displayVal.split(" | ")[0].trim();
        } else if (typeof selectedContractMaHD_PL !== "undefined" && selectedContractMaHD_PL) {
            maToDelete = selectedContractMaHD_PL;
        }

        if (maToDelete && typeof deleteContractRow_PL === "function") {
            e.preventDefault();
            e.stopPropagation();
            editingMaHD_PL = maToDelete;
            deleteContractRow_PL();
        }
    }
});