
/**
 * MODULE: DRAWING - PDF AI EXTRACTION (v5.0 - SEARCH INTEGRATED)
 */

// --- 1. BIẾN TOÀN CỤC & STATE ---
let cyInstance = null; 
let selectedProjectDrawing = ""; 
let currentlyRenderedProject = ""; 
let activeDrawingProjects = []; 
let isDrawingListLoaded = false; 
let currentFileId = ""; 
let drawingTaskCache = {}; 
let drawingTaskSnapshot = null;
let saveOrderTimer = null; 
let syncCountdownInterval = null;
let draggedElement = null; 
let placeholder = document.createElement('div');
placeholder.className = 'task-placeholder';

/**
 * 2. KHỞI CHẠY & NẠP DỰ ÁN (ĐỒNG BỘ BỘ NẠP ĐÁY BẢNG HƯỚNG DẪN TĨNH)
 */
function loadDrawingModule() {
    if (!isDrawingListLoaded) fetchActiveProjectsForDrawing();
    
    if (selectedProjectDrawing) {
        // Kích hoạt bộ lắng nghe kéo thả tệp tĩnh ở đáy bảng Hướng dẫn
        setTimeout(initDrawingUploadZone, 100);

        if (cyInstance && selectedProjectDrawing === currentlyRenderedProject) {
            setTimeout(() => { cyInstance.resize(); cyInstance.fit(null, 20); }, 300);
        } else { 
            renderMindmap(selectedProjectDrawing); 
        }
    } else {
        const cyArea = document.getElementById('cy');
        if (cyArea && (cyArea.innerHTML.trim() === "" || cyArea.querySelector('.existing-file-wrapper') === null)) {
            cyArea.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; width: 100%; text-align: center; padding: 20px; box-sizing: border-box;">
                    <i class="bi bi-diagram-3-fill" style="font-size: 44px; color: rgba(255, 18, 8, 0.15); margin-bottom: 18px; filter: drop-shadow(0 0 10px rgba(255,18,8,0.03));"></i>
                    <h3 style="color: rgba(255, 18, 8, 0.35); font-size: 14.5px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 10px 0; font-family: 'Poppins', sans-serif;">MAP NOT INITIALIZED</h3>
                    <p style="color: rgba(255, 255, 255, 0.25); font-size: 11px; line-height: 1.6; max-width: 320px; margin: 0; font-style: italic;">Sếp vui lòng chọn một Dự án ở ô tìm kiếm phía bên phải để bắt đầu khởi tạo bản đồ tư duy bản vẽ thiết kế.</p>
                </div>
            `;
        }
    }
}

/* --- public/JS_Drawing.js --- */

function fetchActiveProjectsForDrawing(forceRefresh = false) {
    // 1. Chỉ chạy quét nếu chưa tải lần nào, hoặc khi người dùng chủ động nhấn nút Sync (forceRefresh = true)
    if (!forceRefresh && isDrawingListLoaded && activeDrawingProjects.length > 0) return;

    const input = document.getElementById("drawing-project-search");
    const syncBtnIcon = document.querySelector("#btn-sync-drawing i");

    // Ngăn chặn việc bấm Sync liên tục khi tiến trình đang chạy
    if (syncBtnIcon && syncBtnIcon.classList.contains('spinning')) return;

    // Hiển thị trạng thái tải cho người dùng thấy rõ
    if (input) {
        input.disabled = true;
        input.placeholder = "Loading projects from Drive...";
    }
    if (syncBtnIcon) syncBtnIcon.classList.add('spinning');

    // 2. Gọi Backend quét trực tiếp tên các thư mục dự án trên Google Drive
    callBackend("getActiveProjectFolders_Backend").then(folderNames => {
        activeDrawingProjects = folderNames || [];
        isDrawingListLoaded = true;
        
        // Trả lại trạng thái sẵn sàng cho ô nhập liệu
        if (input) {
            input.disabled = false;
            input.placeholder = "Project";
        }
        if (syncBtnIcon) syncBtnIcon.classList.remove('spinning');
    }).catch(err => {
        console.error("Lỗi tải danh sách thư mục từ Drive:", err);
        isDrawingListLoaded = false; // Cho phép thử lại lần sau
        if (input) {
            input.disabled = false;
            input.placeholder = "Failed to load projects";
        }
        if (syncBtnIcon) syncBtnIcon.classList.remove('spinning');
    });
}

/**
 * 2.1 LỌC DỰ ÁN: Hiện match lên đầu, báo lỗi đồng bộ size/màu
 */
function filterProject_Drawing(input) {
    const drop = document.getElementById("drawing-project-drop");
    const query = input.value.toLowerCase().trim();
    
    // CSS dùng chung để khớp hoàn toàn với dữ liệu mã dự án
    const sharedStyle = `text-align:center; justify-content:center; color:rgba(255, 255, 255, 0.8); font-size:14px; font-style:italic; font-weight:normal; text-transform:lowercase; width:100%;`;

    if (activeDrawingProjects.length === 0) {
        drop.innerHTML = `<div class="hoc-tooltip disable-hover" style="${sharedStyle}">-- No projects available --</div>`;
        drop.classList.add("show");
        return;
    }

    const matched = [];
    const unmatched = [];
    
    activeDrawingProjects.forEach(name => {
        if (name.toLowerCase().includes(query)) matched.push(name);
        else unmatched.push(name);
    });

    // TRƯỜNG HỢP KHÔNG CÓ DỮ LIỆU KHỚP
    if (query !== "" && matched.length === 0) {
        drop.innerHTML = `<div class="hoc-tooltip disable-hover" style="${sharedStyle}">Không có dữ liệu</div>`;
        drop.classList.add("show");
        return;
    }

    const fullSortedList = [...matched, ...unmatched];

    drop.innerHTML = fullSortedList.map((name, index) => {
        const isFirst = (index === 0 && query !== "") ? "active" : "";
        return `<div class="hoc-tooltip ${isFirst}" onmousedown="selectProject_Drawing('${name}'); event.preventDefault();">
                    <span class="dd-label" style="text-align: left; width: 100%;">${name}</span>
                </div>`;
    }).join("");
    drop.classList.add("show");
}

/**
 * 2.2 CHỌN MỤC ĐẦU TIÊN KHI NHẤN ENTER (Chỉ chọn nếu có kết quả khớp)
 */
function selectFirstProject_Drawing() {
    const drop = document.getElementById("drawing-project-drop");
    // Chỉ tìm item có class active (mục match đầu tiên) hoặc item đầu tiên không phải thông báo lỗi
    const firstItem = drop.querySelector(".hoc-tooltip:not(.disable-hover)");
    if (firstItem) {
        const name = firstItem.querySelector(".dd-label").textContent;
        selectProject_Drawing(name);
    }
}

function selectProject_Drawing(projectName) {
    currentlyRenderedProject = ""; 
    selectedProjectDrawing = projectName;
    const input = document.getElementById("drawing-project-search");
    const searchInput = document.getElementById("drawing-category-search");
    if(input) input.value = projectName;
    if(searchInput) searchInput.value = ""; 
    
    document.getElementById("drawing-project-drop").classList.remove("show");
    
    // ĐẢM BẢO GIỮ TRẠNG THÁI CHỜ KHI VỪA CHỌN DỰ ÁN
    document.getElementById('dp-empty-state').style.display = 'flex';
    document.getElementById('dp-content-state').style.display = 'none';
    
    renderMindmap(projectName);
}

function closeFileDetail() {
    // Quay lại trạng thái chờ
    document.getElementById('dp-empty-state').style.display = 'flex';
    document.getElementById('dp-content-state').style.display = 'none';
    currentFileId = "";
    
    // Bỏ chọn node trên Mindmap nếu có
    if (cyInstance) cyInstance.$(':selected').unselect();
}

/**
 * 3. HÀM TÌM KIẾM HẠNG MỤC (OR LOGIC) + ICON DYNAMIC + FLASH
 */
function executeCategorySearch(query) {
    if (!selectedProjectDrawing || !query.trim() || !cyInstance) return;
    
    const keywords = query.toLowerCase().trim().split(/\s+/).filter(k => k.length > 0);
    const searchInput = document.getElementById("drawing-category-search");
    const searchIcon = document.getElementById("drawing-search-icon");

    // 1. BẬT TRẠNG THÁI LOADING
    searchInput.style.opacity = "0.5";
    searchInput.disabled = true;
    if (searchIcon) {
        if (searchIcon.dataset.originalColor === undefined) {
            searchIcon.dataset.originalColor = searchIcon.style.color || "";
        }
        searchIcon.style.color = "#00fbff";           
        searchIcon.classList.add("icon-flashing-centered"); 
    }

    // 2. GỌI QUA CẦU NỐI API (THAY CHO google.script.run)
    callBackend("getAllTasksByProject", selectedProjectDrawing)
    .then(projectTasks => {
        // TẮT TRẠNG THÁI LOADING
        searchInput.style.opacity = "1";
        searchInput.disabled = false;
        if (searchIcon) {
            searchIcon.style.color = searchIcon.dataset.originalColor; 
            searchIcon.classList.remove("icon-flashing-centered");
        }
        
        const matchingFileIds = new Set();
        projectTasks.forEach(task => {
            const desc = (task.description || "").toLowerCase();
            const isMatch = keywords.some(kw => desc.includes(kw));
            if (isMatch) matchingFileIds.add(task.fileId);
        });

        if (matchingFileIds.size === 0) {
            showToast_PL("Không tìm thấy hạng mục!", "error");
            return;
        }

        let foundCount = 0;
        cyInstance.nodes().forEach(node => {
            if (matchingFileIds.has(node.data('fileId'))) {
                flashNode_Drawing(node);
                foundCount++;
            }
        });
        showToast_PL(`Đã tìm thấy ${foundCount} mục!`, "success");
    })
    .catch(err => {
        // XỬ LÝ KHI LỖI
        searchInput.style.opacity = "1";
        searchInput.disabled = false;
        if (searchIcon) {
            searchIcon.style.color = searchIcon.dataset.originalColor; 
            searchIcon.classList.remove("icon-flashing-centered");
        }
        alert("Lỗi server: " + (err.message || err));
    });
}

/**
 * Hàm hỗ trợ chớp nháy Node an toàn (chống Race Condition)
 */
function flashNode_Drawing(node) {
    // 1. Clear state cũ
    if (node.scratch('flashInterval')) {
        clearInterval(node.scratch('flashInterval'));
        node.removeStyle('border-color border-width');
    }

    let count = 0;
    const flashColor = '#00fbff';
    const flashWidth = '4px';

    const intervalId = setInterval(() => {
        if (count % 2 === 0) {
            // Bật sáng: Áp dụng inline style
            node.style({ 'border-color': flashColor, 'border-width': flashWidth });
        } else {
            // Tắt sáng: Xóa inline style, để node tự fallback về stylesheet gốc
            node.removeStyle('border-color border-width');
        }
        count++;
        
        if (count >= 10) { // Đã tăng nhịp đếm từ 6 lên 10 để chớp nháy đúng 5 lần
            clearInterval(intervalId);
            node.removeStyle('border-color border-width');
            node.removeScratch('flashInterval');
        }
    }, 500);

    // 2. Lưu state
    node.scratch('flashInterval', intervalId);
}

/**
 * 4. HÀM VẼ MINDMAP
 */
function renderMindmap(projectCode) {
    const localLoader = document.getElementById("drawing-local-loader");
    const cyArea = document.getElementById('cy');
    if(localLoader) localLoader.style.display = "flex";
    cyArea.style.opacity = "0";

    // Thực hiện tải song song cấu trúc bản vẽ từ Drive và toàn bộ tác vụ trong Sheet
    Promise.all([
        callBackend("getMindmapData", projectCode),
        callBackend("getAllTasksByProject", projectCode)
    ]).then(([mindmapData, projectTasks]) => {
        if(localLoader) localLoader.style.display = "none";
        currentlyRenderedProject = projectCode; 

        // Khởi tạo và đồng bộ dữ liệu vào Cache trên RAM Client
        drawingTaskCache = {};
        
        // 1. Khởi tạo mảng trống cho tất cả FileID thuộc dự án để tránh gọi mạng đơn lẻ
        if (mindmapData && mindmapData.files) {
            mindmapData.files.forEach(f => {
                drawingTaskCache[f.fileId] = [];
            });
        }

        // 2. Điền dữ liệu tác vụ thực tế tải hàng loạt từ server vào Cache
        if (projectTasks && Array.isArray(projectTasks)) {
            projectTasks.forEach(task => {
                if (drawingTaskCache[task.fileId] !== undefined) {
                    drawingTaskCache[task.fileId].push({
                        taskId: task.taskId,
                        description: task.description,
                        team: task.team
                    });
                }
            });
        }

        if (!mindmapData || !mindmapData.files || mindmapData.files.length === 0) {
            cyArea.style.opacity = "1";
            cyArea.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#FFBA08;font-style:italic;">Dự án [${projectCode}] chưa có bản vẽ!</div>`;
            return;
        }
        if (cyInstance) { cyInstance.destroy(); cyInstance = null; }
        cyArea.innerHTML = "";

        setTimeout(() => {
            cyInstance = cytoscape({
                container: cyArea, elements: buildCytoscapeElements(mindmapData), pixelRatio: 2,
                autoungrabify: true, userPanningEnabled: true, userZoomingEnabled: true,
                style: [
                    { selector: 'node', style: { 'background-color': '#021a31', 'label': 'data(label)', 'color': '#fff', 'font-family': 'Poppins, sans-serif', 'font-size': 18, 'text-valign': 'center', 'text-halign': 'center', 'width': 220, 'height': 68, 'shape': 'round-rectangle', 'border-width': 1.5, 'border-color': '#FFBA08', 'text-wrap': 'wrap', 'text-max-width': 180, 'line-height': 1.4, 'overlay-opacity': 0 } },
                    { selector: 'node[id="root"]', style: { 'font-size': 26, 'font-weight': 'bold', 'color': '#FFBA08', 'background-color': '#FFBA08', 'background-opacity': 0.15, 'width': 140, 'height': 60, 'border-width': 1.5, 'border-color': '#FFBA08' } },
                    { selector: 'node[?isDept]', style: { 'width': 60, 'height': 40, 'font-size': 18, 'background-color': '#021a31', 'border-color': 'data(color)', 'border-width': 1.5, 'color': 'data(color)', 'font-weight': 'bold' } },
                    { 
                        selector: 'node[?fileId]', 
                        style: { 
                            'background-color': '#293e5b', 'border-width': 1.5, 'border-color': 'data(color)', 
                            'font-size': 18, 'font-weight': 'bold', 'text-wrap': 'wrap', 'text-max-width': 180, 
                            'width': 220, 'height': 95, 'text-valign': 'center', 'line-height': 1.4,
                            'color': (el) => el.data('color').toUpperCase() === '#FFBA08' ? '#FFFFFF' : el.data('color')
                        } 
                    },
                    { selector: 'node[?isDate]', style: { 'width': 110, 'height': 40, 'background-opacity': 0, 'border-color': '#FFBA08', 'border-width': 1.5, 'font-size': 18, 'font-weight': 'bold', 'color': '#FFBA08', 'shape': 'round-rectangle', 'text-valign': 'center', 'text-halign': 'center' } },
                    { selector: 'edge', 
                        style: { 
                            'width': 1.5, 
                            'line-color': 'data(color)', 
                            'curve-style': 'taxi', 
                            'taxi-direction': 'horizontal', 
                            'target-arrow-shape': 'data(arrowShape)', 
                            'target-arrow-color': 'data(color)', 
                            'line-opacity': 0.8 
                        } 
                    },                    
                    { selector: 'node:selected', style: { 'background-color': '#FFBA08', 'background-opacity': 0.2, 'border-width': (el) => el.style('border-width') } }
                ]
            });
            cyInstance.resize();
            cyInstance.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 45, rankSep: 90, animate: false, fit: true, padding: 20, stop: () => { cyArea.style.opacity = "1"; cyInstance.resize(); } }).run();
            cyInstance.on('tap', 'node', (evt) => { if (evt.target.data('fileId')) updatePanelContent(evt.target.data()); });
            cyInstance.on('dbltap', 'node', (evt) => { if (evt.target.data('fileId') && evt.target.data('url') !== "#") window.open(evt.target.data('url'), '_blank'); });
            cyInstance.on('mouseover', 'node[?fileId]', () => document.getElementById('cy').style.cursor = 'pointer');
            cyInstance.on('mouseout', 'node[?fileId]', () => document.getElementById('cy').style.cursor = 'default');
        }, 100);
    }).catch(err => {
        if(localLoader) localLoader.style.display = "none";
        alert("Lỗi tải bản đồ: " + (err.message || err));
    });
}

function buildCytoscapeElements(data) {
    let elements = [], addedNodes = new Set();
    const GOLD = '#FFBA08', DEPT_COLORS = { 'STR': '#BCC6CC', 'ARC': '#50C878', 'MEP': '#CD7F32', 'KHÁC': GOLD };
    const DEPT_ORDER = { 'STR': 1, 'ARC': 2, 'MEP': 3, 'KHÁC': 4 };

    function addNode(id, label, parentId, nodeColor, fileId = null, url = null, isDept = false, isDate = false, type = null) {
        if (!addedNodes.has(id)) {
            elements.push({ 
                data: { id, label, color: nodeColor, fileId, url, isDept, isDate, type },
                selectable: !!fileId 
            });
            addedNodes.add(id);
            if (parentId) {
                elements.push({ 
                    data: { 
                        source: parentId, 
                        target: id, 
                        color: fileId ? nodeColor : GOLD,
                        arrowShape: fileId ? 'triangle' : 'none' // Ánh xạ mũi tên: Có fileId -> vẽ, Không -> ẩn
                    },
                    selectable: false 
                });
            }
        }
    }

    addNode('root', data.projectCode.toUpperCase(), null, GOLD); 
    addNode('branch_goc', 'BẢN VẼ TKTC', 'root', GOLD);
    addNode('branch_update', 'BẢN VẼ CẬP NHẬT', 'root', GOLD);
    addNode('branch_proposal', 'PHIẾU ĐỀ XUẤT', 'root', GOLD);

    if(data.files) {
        data.files.sort((a, b) => {
            if (a.type !== b.type) return (a.type === 'ORIGINAL' ? -1 : 1);
            if (a.sortValue !== b.sortValue) return a.sortValue - b.sortValue;
            return (DEPT_ORDER[a.dept.toUpperCase()] || 4) - (DEPT_ORDER[b.dept.toUpperCase()] || 4);
        });

        data.files.forEach(f => {
            // --- LOGIC LÀM SẠCH TÊN FILE NÂNG CAO ---
            const ext = ".pdf";
            let namePart = f.fileName.replace(/\.pdf$/i, "");
            const projectCode = (data.projectCode || "").toString();

            // 1. Danh sách mẫu cần xóa (Mã dự án, PĐX, BVTKTC, TKBVTC, STR, ARC, MEP, và ngày tháng 6 số)
            const patterns = [
                new RegExp(projectCode, 'gi'),
                /PĐX/gi, /BVTKTC/gi, /TKBVTC/gi, /STR/gi, /ARC/gi, /MEP/gi, /\d{6}/g
            ];

            patterns.forEach(p => {
                namePart = namePart.replace(p, "");
            });

            // 2. Thu gọn nhiều dấu gạch dưới liên tiếp thành 1 dấu (do xóa từ ở giữa để lại)
            // 3. Loại bỏ dấu gạch dưới hoặc khoảng trắng ở đầu và cuối tên
            let cleanName = namePart.replace(/_+/g, "_").replace(/\s+/g, " ").replace(/^[_ \s]+|[_ \s]+$/g, "");

            // 4. Nếu sau khi lọc tên bị rỗng, trả về tên gốc. Nếu không, ghép đuôi .pdf
            const smartName = cleanName ? (cleanName + ext) : f.fileName;
            
            const dateId = f.sortValue || 'nodate', deptKey = f.dept.toUpperCase(), deptColor = DEPT_COLORS[deptKey] || DEPT_COLORS['KHÁC'];
            
            if (f.type === 'ORIGINAL') {
                const dNode = 'date_goc_' + dateId, sNode = dNode + '_' + f.branch, deptId = sNode + '_' + f.dept;
                addNode(dNode, f.dateLabel || "--/--/----", 'branch_goc', GOLD, null, null, false, true);
                addNode(sNode, f.branch.toUpperCase(), dNode, GOLD);
                addNode(deptId, f.dept.toUpperCase(), sNode, deptColor, null, null, true);
                addNode(f.fileId, smartName, deptId, deptColor, f.fileId, f.url, false, false, f.type);
            } else {
                const bParent = f.type === 'UPDATE' ? 'branch_update' : 'branch_proposal';
                const dNode = 'date_alt_' + bParent + '_' + dateId;
                addNode(dNode, f.dateLabel || "--/--/----", bParent, GOLD, null, null, false, true);
                addNode(f.fileId, smartName, dNode, deptColor, f.fileId, f.url, false, false, f.type);
            }
        });
    }
    return elements;
}

/**
 * 5. PANEL CHI TIẾT & ROBOT EXTRACTION
 */
function updatePanelContent(nodeData) {
    currentFileId = nodeData.fileId;
    document.getElementById('dp-empty-state').style.display = 'none';
    document.getElementById('dp-content-state').style.display = 'flex';
    const fileName = nodeData.label.split('\n').pop();

    let aiZoneHTML = "";
    const isProcessable = (nodeData.type === 'UPDATE' || nodeData.type === 'PROPOSAL');

    if (isProcessable) {
        aiZoneHTML = `
            <div id="ai-paste-zone" class="scan-drop-zone" onclick="extractFromCurrentSelected()">
                <i class="bi bi-robot" id="ai-robot-icon" style="font-size:28px; color:#00BCD4; transition: all 0.3s;"></i>
                <div style="display:flex; flex-direction:column; align-items:center; pointer-events:none; text-align:center;">
                    <div id="ai-main-msg" style="font-size:11px; color:#E0E0E0; font-weight:700; letter-spacing:1px; margin-top:5px;">AI DATA EXTRACTION</div>
                    <div id="ai-sub-msg" style="font-size:10px; color:#95A1AF; margin-top:6px; font-style:italic;">Trích xuất hạng mục từ ${nodeData.type === 'UPDATE' ? 'Bản vẽ cập nhật' : 'Phiếu đề xuất'}</div>
                </div>
            </div>`;
    } else {
        aiZoneHTML = `
            <div class="scan-drop-zone" style="cursor: default; border-color: rgba(149, 161, 175, 0.1); background: rgba(0,0,0,0.1);">
                <i class="bi bi-robot" style="font-size:28px; color:#505966; opacity: 0.3;"></i>
                <div style="text-align:center;">
                    <div style="font-size:10px; color:#505966; font-weight:700; letter-spacing:1px; margin-top:5px;">AI NOT SUPPORTED</div>
                    <div style="font-size:10px; color:#505966; margin-top:4px;">Chỉ hỗ trợ PHIẾU ĐỀ XUẤT / BẢN VẼ CẬP NHẬT</div>
                </div>
            </div>`;
    }

    document.getElementById('dp-file-list').innerHTML = `
        <div class="existing-file-wrapper">
            <div class="existing-file-info" onclick="window.open('${nodeData.url}', '_blank')" style="flex:1; overflow:hidden; display:flex; align-items:center;">
                <i class="bi bi-file-earmark-pdf-fill file-pdf" style="margin-right:10px"></i>
                <span class="file-name-text" style="color:#FFBA08 !important; font-size:11px">${fileName}</span>
            </div>
            <div onclick="closeFileDetail()" style="padding:10px; cursor:pointer; opacity:0.5"><i class="bi bi-x-lg"></i></div>
        </div>
        ${aiZoneHTML}`;
    
    const taskListContainer = document.getElementById('dp-task-list');
    if (isProcessable) {
        renderTaskList_Drawing(currentFileId);
        document.querySelector('button[onclick="addNewTaskItem()"]').style.display = 'block';
    } else {
        taskListContainer.innerHTML = `<div class="empty-msg" style="color:#505966; font-size:11px; font-style:italic; padding:15px; text-align:center;">Không có dữ liệu trích xuất từ bản vẽ thiết kế thi công.</div>`;
        document.querySelector('button[onclick="addNewTaskItem()"]').style.display = 'none';
    }
}

/**
 * KHỞI TẠO SỰ KIỆN KÉO THẢ BẢN VẼ TRÊN WEB APP (GHIM SÁT ĐÁY PANEL)
 */
function initDrawingUploadZone() {
    const zone = document.getElementById('drawing-upload-zone');
    const input = document.getElementById('drawing-upload-input');
    if (!zone || !input || zone.dataset.bound) return;
    
    zone.dataset.bound = "true"; // Ghim cờ chặn gán trùng sự kiện gây lặp luồng
    
    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            uploadDrawingChunked(e.target.files[0]);
        }
        input.value = "";
    });
    
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            uploadDrawingChunked(e.dataTransfer.files[0]);
        }
    });
}

/**
 * THỰC THI CẮT NHỎ VÀ TẢI TỆP TIN TRỰC TIẾP LÊN DRIVE (RESUMABLE UPLOAD ENGINE)
 */
async function uploadDrawingChunked(file) {
    const zone = document.getElementById("drawing-upload-zone");
    const stateEmpty = document.getElementById("drawing-state-empty");
    const stateUploading = document.getElementById("drawing-state-uploading");
    const statusText = document.getElementById("drawing-upload-status");
    const progressBar = document.getElementById("drawing-upload-progress");
    
    if (!zone || !stateEmpty || !stateUploading || !statusText || !progressBar) return;
    
    // 1. Chuyển đổi trạng thái giao diện sang Đang xử lý
    stateEmpty.style.display = "none";
    stateUploading.style.display = "flex";
    statusText.textContent = "INITIALIZING SESSION...";
    progressBar.style.width = "0%";
    
    try {
        // 2. Gọi API Backend xin phiên Upload mã hóa tạm thời từ Google
        const session = await callBackend("getDrawingUploadSession_Backend", {
            fileName: file.name,
            fileSize: file.size
        });
        
        if (!session || !session.success) {
            throw new Error(session ? session.error : "Không thể khởi tạo phiên làm việc với Google Drive.");
        }
        
        const uploadUrl = session.uploadUrl;
        const chunkSize = 5 * 1024 * 1024; // Cắt tệp thành từng lát 5MB (Chuẩn kích cỡ tối ưu nhất của Drive API)
        const totalChunks = Math.ceil(file.size / chunkSize);
        
        // 3. Tiến hành tải tuần tự các mảnh trực tiếp từ trình duyệt lên máy chủ Google
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunkBlob = file.slice(start, end);
            
            statusText.textContent = `UPLOADING... ${Math.round((i / totalChunks) * 100)}%`;
            
            // Gửi trực tiếp HTTP PUT không qua trung gian Apps Script
            const response = await fetch(uploadUrl, {
                method: "PUT",
                headers: {
                    "Content-Range": `bytes ${start}-${end - 1}/${file.size}`
                },
                body: chunkBlob
            });
            
            // Trạng thái 308 (Resume Incomplete) nghĩa là Google nhận tốt mảnh này và đợi mảnh tiếp theo
            // Trạng thái 200/201 là hoàn thành tải lên toàn bộ tệp tin thành công
            if (response.status !== 308 && response.status !== 200 && response.status !== 201) {
                throw new Error(`Google API phản hồi lỗi ${response.status} khi tải mảnh số ${i + 1}.`);
            }
            
            const percent = Math.round(((i + 1) / totalChunks) * 100);
            progressBar.style.width = percent + "%";
        }
        
        statusText.textContent = "SYNCING MINDMAP...";
        progressBar.style.width = "100%";
        
        showToast_PL(`🚀 Tải lên bản vẽ ${file.name} thành công!`, "success");
        
        // Vẽ lại sơ đồ tư duy bản vẽ ngầm tức thì
        if (selectedProjectDrawing) {
            renderMindmap(selectedProjectDrawing);
        }
        
    } catch (e) {
        console.error("Lỗi tải tệp phân mảnh:", e);
        alert(e.message || e);
    } finally {
        // Trả lại trạng thái trống sẵn sàng nhận file mới
        stateEmpty.style.display = "flex";
        stateUploading.style.display = "none";
    }
}

function renderTaskList_Drawing(id) {
    const container = document.getElementById('dp-task-list');
    if (drawingTaskCache[id]) { 
        displayTasksHTML(drawingTaskCache[id]); 
        drawingTaskSnapshot = JSON.parse(JSON.stringify(drawingTaskCache[id])); // Tạo snapshot từ cache
        return; 
    }
    container.innerHTML = `<div style="color:#95A1AF; font-size:11px; padding:10px;">Loading...</div>`;
    callBackend("getTasksByFileId", id).then(tasks => {
        drawingTaskCache[id] = tasks; 
        drawingTaskSnapshot = JSON.parse(JSON.stringify(tasks)); 
        displayTasksHTML(tasks); 
    }).catch(err => {
        container.innerHTML = `<div style="color:red; font-size:11px; padding:10px;">Lỗi tải dữ liệu</div>`;
    });
}

function displayTasksHTML(tasks) {
    const container = document.getElementById('dp-task-list');
    const xd = tasks.filter(t => t.team === 'XD'), mep = tasks.filter(t => t.team === 'MEP');
    container.innerHTML = `
        <div class="group-label" style="color:#FFBA08; font-size:13px;"><i class="bi bi-bricks" style="margin-right:6px;"></i> Xây dựng </div>
        <div id="drop-zone-XD" class="task-group-container" ondragover="allowDrop(event)" ondrop="handleDrop(event, 'XD')">${renderGroupItems(xd)}</div>
        <div class="group-label" style="color:#00BCD4; margin-top:15px; font-size:13px;"><i class="bi bi-lightning-charge" style="margin-right:6px;"></i> Cơ điện </div>
        <div id="drop-zone-MEP" class="task-group-container" ondragover="allowDrop(event)" ondrop="handleDrop(event, 'MEP')">${renderGroupItems(mep)}</div>`;
}

function renderGroupItems(items) {
    if (items.length === 0) return `<div class="empty-msg" style="color:#505966; font-size:11px; font-style:italic; padding:15px; text-align:center;">Không có dữ liệu ...</div>`;
    return items.map(t => `<div class="task-item" draggable="false" ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)" id="task-${t.taskId}"><div class="drag-handle" onmousedown="this.parentElement.setAttribute('draggable', 'true')"><i class="bi bi-grip-vertical"></i></div><input type="text" class="task-desc-edit" value="${t.description}" onblur="updateTaskDescInline('${t.taskId}', this.value)" onkeydown="if(event.key==='Enter') this.blur()"><i class="bi bi-trash3-fill" style="color:#ff4d4d; cursor:pointer; font-size:14px; opacity:0.5;" onclick="deleteTask_Drawing('${t.taskId}')"></i></div>`).join("");
}

/**
 * 6. LOGIC KÉO THẢ
 */
function handleDragStart(e) { draggedElement = e.currentTarget; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", draggedElement.id); draggedElement.after(placeholder); setTimeout(() => { draggedElement.classList.add('dragging'); document.body.appendChild(draggedElement); }, 0); }

function allowDrop(e) {
    e.preventDefault();
    const container = e.currentTarget; 
    const draggingOverItem = e.target.closest('.task-item:not(.dragging)');
    if (!draggedElement) return;
    e.dataTransfer.dropEffect = "move";
    if (draggingOverItem && draggingOverItem !== placeholder) {
        const rect = draggingOverItem.getBoundingClientRect();
        if (e.clientY < (rect.top + rect.height / 2)) { if (placeholder.nextSibling !== draggingOverItem) draggingOverItem.before(placeholder); } 
        else { if (placeholder !== draggingOverItem.nextSibling) draggingOverItem.after(placeholder); }
    } else if ((e.target === container || container.classList.contains('task-group-container')) && !container.contains(placeholder)) {
        const msg = container.querySelector('.empty-msg'); if (msg) msg.style.display = 'none';
        container.appendChild(placeholder);
    }
}

function handleDragEnd(e) { if (!draggedElement) return; if (placeholder.parentElement) placeholder.replaceWith(draggedElement); draggedElement.classList.remove('dragging'); draggedElement.setAttribute('draggable', 'false'); draggedElement = null; }

/**
 * 7. AI EXTRACTION ENGINE
 */
async function slicePDFEngine(buffer) {
    const pdfDoc = await PDFLib.PDFDocument.load(buffer), newDoc = await PDFLib.PDFDocument.create();
    const pages = Array.from({length: Math.min(3, pdfDoc.getPageCount())}, (_, i) => i);
    const copied = await newDoc.copyPages(pdfDoc, pages); copied.forEach(p => newDoc.addPage(p));
    return btoa(new Uint8Array(await newDoc.save()).reduce((d, b) => d + String.fromCharCode(b), ''));
}

async function extractFromCurrentSelected(isConfirmed = false) {
    const zone = document.getElementById('ai-paste-zone');
    const mainMsg = document.getElementById('ai-main-msg');
    const subMsg = document.getElementById('ai-sub-msg');
    const taskList = document.getElementById('dp-task-list');
    const selectedNode = cyInstance.$(':selected')[0];
    if (!zone || !currentFileId || !selectedNode) return;
    const fileType = selectedNode.data('type'); 
    const hasExistingData = drawingTaskCache[currentFileId] && drawingTaskCache[currentFileId].length > 0;

    if (hasExistingData && !isConfirmed) {
        zone.classList.add('ai-zone-alert');
        mainMsg.style.color = "#fff"; mainMsg.textContent = "XÁC NHẬN GHI ĐÈ DỮ LIỆU?";
        subMsg.innerHTML = `<div style="margin-top:8px; display:flex; gap:10px; justify-content:center; pointer-events:auto;"><button onclick="event.stopPropagation(); extractFromCurrentSelected(true)" class="btn-primary-luxury" style="height:24px; padding:0 10px; font-size:9px; background:#ff4d4d !important; border-color:#ff4d4d !important;">YES</button><button onclick="event.stopPropagation(); resetAIZoneUI()" class="btn-secondary-luxury" style="height:24px; padding:0 10px; font-size:9px;">CANCEL</button></div>`;
        return;
    }

    zone.classList.remove('ai-zone-alert'); zone.classList.add('ai-extracting-active');
    mainMsg.style.color = "#00BCD4"; mainMsg.textContent = "AI DATA ANALYSIS IN PROGRESS";
    subMsg.textContent = "Vui lòng chờ trong giây lát ...";

    try {
        const base64 = await serverCall('getFileBase64ForAI', currentFileId);
        const binary = atob(base64), bytes = new Uint8Array(binary.length);
        for (let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const sliced = await slicePDFEngine(bytes.buffer);
        const res = await serverCall('extractDataOnly', sliced, "application/pdf", fileType);
        if (res.error) throw new Error(res.error);

        let tasks = res.notes || [];
        const unique = []; const seen = new Set();
        tasks.forEach(t => {
            const n = (t.note || "").trim();
            if (n !== "" && !seen.has(n.toUpperCase())) {
                unique.push({ note: n, dept: (t.dept || "XD").toUpperCase() === "MEP" ? "MEP" : "XD" });
                seen.add(n.toUpperCase());
            }
        });

        await serverCall('batchAddTasksBackend', selectedProjectDrawing, currentFileId, unique, isConfirmed);
        delete drawingTaskCache[currentFileId];
        renderTaskList_Drawing(currentFileId);
        resetAIZoneUI();
    } catch (e) { alert("Lỗi: " + e.message); resetAIZoneUI(); renderTaskList_Drawing(currentFileId); }
}

function resetAIZoneUI() {
    const zone = document.getElementById('ai-paste-zone');
    const mainMsg = document.getElementById('ai-main-msg');
    const subMsg = document.getElementById('ai-sub-msg');
    if (!zone) return;
    zone.classList.remove('ai-extracting-active'); zone.classList.remove('ai-zone-alert');
    mainMsg.style.color = "#E0E0E0"; mainMsg.textContent = "AI DATA EXTRACTION";
    subMsg.innerHTML = "Trích xuất hạng mục cập nhật thay đổi";
}

/**
 * 8. CORE UTILS
 */

function syncManual() {
    // 1. Buộc quét lại danh sách dự án mới nhất từ Drive (Force Refresh)
    fetchActiveProjectsForDrawing(true);
    
    // 2. Đồng bộ và vẽ lại Mindmap của dự án hiện tại đang chọn
    if (selectedProjectDrawing) {
        const localLoader = document.getElementById("drawing-local-loader");
        if (localLoader) localLoader.style.display = "flex";
        drawingTaskCache = {};
        currentlyRenderedProject = "";
        renderMindmap(selectedProjectDrawing);
    }
}

function resetMindmapView() { if (cyInstance) cyInstance.animate({ fit: { padding: 20 }, duration: 400 }); }

/**
 * HÀM HIỂN THỊ VÀ XỬ LÝ ĐẾM NGƯỢC 10s
 */
function triggerDrawingSync_10s() {
    const statusBar = document.getElementById("sync-status-bar");
    const statusText = document.getElementById("sync-status-text");
    
    clearInterval(syncCountdownInterval);
    clearTimeout(saveOrderTimer);
    
    let timeLeft = 10;
    statusBar.style.height = "32px";
    statusBar.style.marginBottom = "15px";
    statusBar.style.borderColor = "rgba(0, 188, 212, 0.3)";
    statusText.innerHTML = `Auto-sync in <b style="font-size: 12px; color: #fff;">${timeLeft}s</b>`;

    syncCountdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            statusText.innerHTML = `Auto-sync in <b style="font-size: 12px; color: #fff;">${timeLeft}s</b>`;
        } else {
            clearInterval(syncCountdownInterval);
            statusText.innerHTML = `<i class="bi bi-arrow-repeat rotation"></i> SAVING...`;
        }
    }, 1000);

    saveOrderTimer = setTimeout(() => {
        const finalTasks = drawingTaskCache[currentFileId].filter(t => t.description.trim() !== "");
        
        callBackend('updateTasksOrderBackend', [selectedProjectDrawing, currentFileId, finalTasks])
            .then(() => {
                saveOrderTimer = null; 
                drawingTaskCache[currentFileId] = finalTasks; 
                drawingTaskSnapshot = JSON.parse(JSON.stringify(finalTasks));
                statusBar.style.height = "0";
                statusBar.style.marginBottom = "0";
                statusBar.style.borderColor = "transparent";
                displayTasksHTML(finalTasks); 
                showToast_PL("🚀 Synced!", "success");
            })
            .catch(err => console.error("Lỗi đồng bộ:", err));
    }, 10000);
}

function syncDrawingImmediately() {
    clearInterval(syncCountdownInterval);
    clearTimeout(saveOrderTimer);
    saveOrderTimer = null;

    const statusBar = document.getElementById("sync-status-bar");
    const finalTasks = drawingTaskCache[currentFileId].filter(t => t.description.trim() !== "");

    callBackend('updateTasksOrderBackend', [selectedProjectDrawing, currentFileId, finalTasks])
        .then(() => {
            drawingTaskCache[currentFileId] = finalTasks;
            drawingTaskSnapshot = JSON.parse(JSON.stringify(finalTasks));
            if (statusBar) {
                statusBar.style.height = "0";
                statusBar.style.marginBottom = "0";
                statusBar.style.borderColor = "transparent";
            }
            displayTasksHTML(finalTasks);
            showToast_PL("✅ Đã cập nhật hạng mục mới!", "success");
        })
        .catch(err => console.error("Lỗi đồng bộ:", err));
}

function cancelDrawingSync() {
    clearInterval(syncCountdownInterval);
    clearTimeout(saveOrderTimer);
    saveOrderTimer = null;
    
    if (drawingTaskSnapshot) {
        drawingTaskCache[currentFileId] = JSON.parse(JSON.stringify(drawingTaskSnapshot));
        displayTasksHTML(drawingTaskCache[currentFileId]);
    }
    
    const statusBar = document.getElementById("sync-status-bar");
    if (statusBar) {
        statusBar.style.height = "0";
        statusBar.style.marginBottom = "0";
        statusBar.style.borderColor = "transparent";
    }
}

function handleDrop(e, targetTeam) {
    e.preventDefault();
    if (!draggedElement || !placeholder.parentElement) return;
    placeholder.replaceWith(draggedElement);
    draggedElement.classList.remove('dragging');
    
    const allItems = Array.from(document.querySelectorAll('.task-item'));
    const updatedTasks = allItems.map(el => {
        const id = el.id.replace('task-', '');
        const oldData = drawingTaskCache[currentFileId].find(t => t.taskId === id);
        return { 
            ...oldData, 
            team: el.closest('.task-group-container').id.replace('drop-zone-', '') 
        };
    });

    const isUnchanged = updatedTasks.length === drawingTaskSnapshot.length && 
        updatedTasks.every((t, i) => 
            t.taskId === drawingTaskSnapshot[i].taskId && 
            t.team === drawingTaskSnapshot[i].team
        );

    if (isUnchanged) {
        // Nếu không đổi -> Tắt thanh đếm ngược ngay lập tức
        if (saveOrderTimer) cancelDrawingSync();
        return;
    }

    // Nếu có đổi -> Tiến hành đếm ngược 10s
    drawingTaskCache[currentFileId] = updatedTasks;
    triggerDrawingSync_10s();
}

function addNewTaskItem() {
    const tempId = "T-" + Date.now();
    // Tạo item trống mặc định cho ngăn XD
    const newItem = { taskId: tempId, description: "", team: "XD" };
    
    if (!drawingTaskCache[currentFileId]) drawingTaskCache[currentFileId] = [];
    drawingTaskCache[currentFileId].push(newItem);
    
    // Render lại UI để hiện field trống
    displayTasksHTML(drawingTaskCache[currentFileId]);
    
    // Tự động focus vào ô input vừa tạo và cuộn nội bộ an toàn (Chống giật khung hình tổng)
    setTimeout(() => {
        const newInput = document.querySelector(`#task-${tempId} .task-desc-edit`);
        if (newInput) {
            newInput.focus();
            
            // Tính toán tọa độ và cuộn nội bộ bằng scrollTo (Không dùng scrollIntoView gây lệch layout)
            const scrollContainer = document.querySelector("#dp-content-state > div");
            if (scrollContainer) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const inputRect = newInput.getBoundingClientRect();
                const relativeTop = inputRect.top - containerRect.top + scrollContainer.scrollTop;
                
                scrollContainer.scrollTo({
                    top: relativeTop - (containerRect.height / 2) + (inputRect.height / 2),
                    behavior: 'smooth'
                });
            }
        }
    }, 100);
}

function updateTaskDescInline(id, val) {
    const taskIndex = drawingTaskCache[currentFileId].findIndex(x => x.taskId === id);
    if (taskIndex === -1) return;

    const trimmedVal = val.trim();
    const isNewItem = id.startsWith("T-");
    
    // Nếu để trống -> Xóa
    if (trimmedVal === "") {
        drawingTaskCache[currentFileId].splice(taskIndex, 1);
        displayTasksHTML(drawingTaskCache[currentFileId]);
        
        // Nếu là hàng cũ bị xóa trắng nội dung -> Sync 10s để cập nhật
        if (!isNewItem) triggerDrawingSync_10s();
        else cancelDrawingSync(); // Hàng mới bấm thêm rồi bỏ -> Chỉ dọn UI
    } else {
        // NẾU CÓ NỘI DUNG -> CẬP NHẬT CACHE
        if (drawingTaskCache[currentFileId][taskIndex].description !== trimmedVal) {
            drawingTaskCache[currentFileId][taskIndex].description = trimmedVal;
            
            // "NHẬP XONG LÀ DỨT LUÔN" -> Sync ngay lập tức
            syncDrawingImmediately();
        }
    }
}

function deleteTask_Drawing(id) {
    drawingTaskCache[currentFileId] = drawingTaskCache[currentFileId].filter(x => x.taskId !== id);
    displayTasksHTML(drawingTaskCache[currentFileId]);
    triggerDrawingSync_10s();
}
