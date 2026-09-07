
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
let drawingUploadQueue = []; 
let isUploading_Drawing = false;
let projectFilesCache_Drawing = {};
let pendingFetches_Drawing = new Set();

/**
 * 2. KHỞI CHẠY & NẠP DỰ ÁN (ĐỒNG BỘ BỘ NẠP ĐÁY BẢNG HƯỚNG DẪN TĨNH)
 */
function loadDrawingModule() {
    if (!isDrawingListLoaded) fetchActiveProjectsForDrawing();
    
    // 🚀 ĐỒNG BỘ BẮT BUỘC: Luôn khởi tạo bộ lắng nghe kéo thả/click chọn file ngay khi nạp mô-đun
    setTimeout(initDrawingUploadZone, 100);

    if (selectedProjectDrawing) {
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
                    <i class="bi bi-diagram-3-fill" style="font-size: 46px; color: rgba(255, 18, 8, 0.25); margin-bottom: 18px; filter: drop-shadow(0 0 10px rgba(255,18,8,0.03));"></i>
                    <h3 style="color: rgba(255, 18, 8, 0.35); font-size: 16px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 10px 0; font-family: 'Poppins', sans-serif;">MAP NOT INITIALIZED</h3>
                    <p style="color: rgba(255, 255, 255, 0.25); font-size: 12px; line-height: 1.6; max-width: 400px; margin: 0; font-style: italic;">Vui lòng chọn một Dự án bên phải để khởi tạo hồ sơ bản vẽ Mindmap.</p>
                </div>
            `;
        }
    }
}

/* --- public/JS_Drawing.js --- */

function fetchActiveProjectsForDrawing(forceRefresh = false) {
    // 🚀 ƯU TIÊN 1: Nếu danh sách đã được nạp chung trong SYSTEM_DATA từ lúc sếp mở trang, lấy ra dùng ngay lập tức (0 giây)
    if (!forceRefresh && SYSTEM_DATA && SYSTEM_DATA.drawingProjects && SYSTEM_DATA.drawingProjects.length > 0) {
        activeDrawingProjects = SYSTEM_DATA.drawingProjects;
        isDrawingListLoaded = true;
        return;
    }

    // ƯU TIÊN 2: Tránh gọi trùng lặp nếu danh sách đã tải
    if (!forceRefresh && isDrawingListLoaded && activeDrawingProjects.length > 0) return;

    const input = document.getElementById("drawing-project-search");
    const syncBtnIcon = document.querySelector("#btn-sync-drawing i");

    if (syncBtnIcon && syncBtnIcon.classList.contains('spinning')) return;

    if (input) {
        input.disabled = true;
        input.placeholder = "Loading projects from Drive...";
    }
    if (syncBtnIcon) syncBtnIcon.classList.add('spinning');

    // 🚀 DỰ PHÒNG: Chỉ gọi mạng nếu chưa nạp hoặc sếp chủ động bấm nút làm mới (forceRefresh = true)
    callBackend("getActiveProjectFolders_Backend").then(folderNames => {
        activeDrawingProjects = folderNames || [];
        isDrawingListLoaded = true;
        
        // Đồng bộ ngược lại vào SYSTEM_DATA để bộ nhớ đệm luôn sạch
        if (!SYSTEM_DATA) SYSTEM_DATA = {};
        SYSTEM_DATA.drawingProjects = activeDrawingProjects;
        
        if (input) {
            input.disabled = false;
            input.placeholder = "Project";
        }
        if (syncBtnIcon) syncBtnIcon.classList.remove('spinning');
    }).catch(err => {
        console.error("Lỗi tải danh sách thư mục từ Drive:", err);
        isDrawingListLoaded = false; 
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
    document.getElementById('dp-empty-state').style.display = 'flex';
    document.getElementById('dp-content-state').style.display = 'none';
    
    // Kích hoạt bộ lắng nghe ngay khi chọn dự án
    setTimeout(initDrawingUploadZone, 200);
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
 * HÀM CƯỠNG CHẾ TỌA ĐỘ DỌC: Ép sơ đồ gióng thẳng hàng trục đứng chuẩn xác theo thời gian
 */
function enforceBidirectionalLayout() {
    if (!cyInstance) return;

    const rootNode = cyInstance.getElementById('root');
    if (rootNode.length === 0) return;
    const rootPos = rootNode.position();
    const Y_root = rootPos.y;

    const branchProposal = cyInstance.getElementById('branch_proposal');
    const branchGoc = cyInstance.getElementById('branch_goc');
    const branchUpdate = cyInstance.getElementById('branch_update');

    // ==========================================================
    // 1. CỤM BÊN TRÁI: LẬT TRỤC X VÀ SẮP XẾP NGÀY NỘI BỘ
    // ==========================================================
    const leftBranchIds = ['branch_proposal', 'branch_goc'];
    leftBranchIds.forEach(branchId => {
        const branch = cyInstance.getElementById(branchId);
        if (branch.length === 0) return;

        const leftElements = branch.union(branch.successors());
        leftElements.forEach(el => {
            if (el.isNode()) {
                const currentX = el.position('x');
                if (currentX > rootPos.x) {
                    const diffX = currentX - rootPos.x;
                    el.position('x', rootPos.x - diffX);
                }
            }
        });

        const dateNodes = branch.outgoers('node').filter(n => n.data('isDate'));
        if (dateNodes.length > 1) {
            const sortedDateNodes = dateNodes.toArray().sort((a, b) => {
                return (b.data('sortValue') || 0) - (a.data('sortValue') || 0);
            });

            const allElements = dateNodes.union(dateNodes.successors());
            let currentY = allElements.boundingBox().y1;

            sortedDateNodes.forEach(dateNode => {
                const cluster = dateNode.union(dateNode.successors());
                const clusterBB = cluster.boundingBox();
                const diffY = currentY - clusterBB.y1;

                cluster.forEach(el => {
                    if (el.isNode()) el.position('y', el.position('y') + diffY);
                });
                currentY += clusterBB.h + 20;
            });
        }
    });

    // ==========================================================
    // 2. CÂN ĐỐI CÁNH TRÁI: ROOT NẰM CHÍNH GIỮA ĐỀ XUẤT VÀ TKTC
    // ==========================================================
    if (branchProposal.length > 0 && branchGoc.length > 0) {
        const propDates = branchProposal.outgoers('node').filter(n => n.data('isDate'));
        const propCluster = propDates.length > 0 ? propDates.union(propDates.successors()) : branchProposal;
        const propBB = propCluster.boundingBox();

        const gocDates = branchGoc.outgoers('node').filter(n => n.data('isDate'));
        const gocCluster = gocDates.length > 0 ? gocDates.union(gocDates.successors()) : branchGoc;
        const gocBB = gocCluster.boundingBox();

        const minCenterDist = Math.max(120, propBB.h / 2 + gocBB.h / 2 + 40);
        const halfDist = minCenterDist / 2;

        const targetPropY = Y_root - halfDist;
        branchProposal.position('y', targetPropY);
        if (propDates.length > 0) {
            const diffY = targetPropY - (propBB.y1 + propBB.h / 2);
            propCluster.forEach(el => { if (el.isNode()) el.position('y', el.position('y') + diffY); });
        }

        const targetGocY = Y_root + halfDist;
        branchGoc.position('y', targetGocY);
        if (gocDates.length > 0) {
            const diffY = targetGocY - (gocBB.y1 + gocBB.h / 2);
            gocCluster.forEach(el => { if (el.isNode()) el.position('y', el.position('y') + diffY); });
        }
    } else if (branchProposal.length > 0) {
        branchProposal.position('y', Y_root);
        const propDates = branchProposal.outgoers('node').filter(n => n.data('isDate'));
        if (propDates.length > 0) {
            const propCluster = propDates.union(propDates.successors());
            const diffY = Y_root - (propCluster.boundingBox().y1 + propCluster.boundingBox().h / 2);
            propCluster.forEach(el => { if (el.isNode()) el.position('y', el.position('y') + diffY); });
        }
    } else if (branchGoc.length > 0) {
        branchGoc.position('y', Y_root);
        const gocDates = branchGoc.outgoers('node').filter(n => n.data('isDate'));
        if (gocDates.length > 0) {
            const gocCluster = gocDates.union(gocDates.successors());
            const diffY = Y_root - (gocCluster.boundingBox().y1 + gocCluster.boundingBox().h / 2);
            gocCluster.forEach(el => { if (el.isNode()) el.position('y', el.position('y') + diffY); });
        }
    }

    // ==========================================================
    // 3. CỤM BÊN PHẢI: BẢN VẼ CẬP NHẬT CĂN TÂM TRỤC CHÍNH XÁC
    // ==========================================================
    if (branchUpdate.length > 0) {
        // Đặt node mẹ BẢN VẼ CẬP NHẬT thẳng hàng ngang qua tâm Root
        branchUpdate.position('y', Y_root);

        const dateNodes = branchUpdate.outgoers('node').filter(n => n.data('isDate'));
        if (dateNodes.length > 0) {
            if (dateNodes.length > 1) {
                const sortedDateNodes = dateNodes.toArray().sort((a, b) => {
                    return (b.data('sortValue') || 0) - (a.data('sortValue') || 0);
                });

                const allElements = dateNodes.union(dateNodes.successors());
                let currentY = allElements.boundingBox().y1;

                sortedDateNodes.forEach(dateNode => {
                    const cluster = dateNode.union(dateNode.successors());
                    const clusterBB = cluster.boundingBox();
                    const diffY = currentY - clusterBB.y1;

                    cluster.forEach(el => {
                        if (el.isNode()) el.position('y', el.position('y') + diffY);
                    });
                    currentY += clusterBB.h + 20;
                });
            }

            // 🚀 CĂN GIỮA TUYỆT ĐỐI: Gióng trung điểm của toàn bộ 8 ngày/file khớp với trục Y của BẢN VẼ CẬP NHẬT
            const allRightElements = dateNodes.union(dateNodes.successors());
            const rightBB = allRightElements.boundingBox();
            const rightCenterY = rightBB.y1 + rightBB.h / 2;
            const diffCenterY = Y_root - rightCenterY;

            allRightElements.forEach(el => {
                if (el.isNode()) el.position('y', el.position('y') + diffCenterY);
            });
        }
    }
}

/**
 * 4. HÀM VẼ MINDMAP (ĐÃ FIX LỖI CHỒNG NODE VÀ LỆCH TÂM)
 */
function renderMindmap(projectCode, forceRefresh = false) {
    const localLoader = document.getElementById("drawing-local-loader");
    const cyArea = document.getElementById('cy');
    const projKey = (projectCode || "").toUpperCase().trim();

    // 🚀 ƯU TIÊN 1: Nạp tức thì từ RAM (0.0 giây) nếu đã từng mở dự án này
    if (!forceRefresh && projectFullDataCache_Drawing[projKey]) {
        const cachedData = projectFullDataCache_Drawing[projKey];
        currentlyRenderedProject = projectCode;
        drawingTaskCache = {};
        
        cachedData.files.forEach(f => { drawingTaskCache[f.fileId] = []; });
        cachedData.tasks.forEach(task => {
            if (drawingTaskCache[task.fileId] !== undefined) {
                drawingTaskCache[task.fileId].push(task);
            }
        });
        
        projectFilesCache_Drawing[projKey] = cachedData.files;
        drawCytoscapeGraph(projectCode, cachedData.files, cyArea, localLoader);
        return;
    }

    if (localLoader) localLoader.style.display = "flex";
    cyArea.style.opacity = "0";

    // 🚀 ƯU TIÊN 2: Chỉ gọi 1 request gộp duy nhất thay vì 2 request độc lập
    callBackend("getProjectDrawingFullData", projectCode).then(fullData => {
        if (!fullData || !fullData.files) {
            throw new Error("Không nhận được dữ liệu cấu trúc bản vẽ từ máy chủ!");
        }

        // Lưu vào RAM cache để lần sau mở tức thì
        projectFullDataCache_Drawing[projKey] = fullData;
        currentlyRenderedProject = projectCode;
        projectFilesCache_Drawing[projKey] = fullData.files;

        drawingTaskCache = {};
        fullData.files.forEach(f => { drawingTaskCache[f.fileId] = []; });
        fullData.tasks.forEach(task => {
            if (drawingTaskCache[task.fileId] !== undefined) {
                drawingTaskCache[task.fileId].push(task);
            }
        });

        if (fullData.files.length === 0) {
            if (localLoader) localLoader.style.display = "none";
            cyArea.style.opacity = "1";
            cyArea.innerHTML = `<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#FFBA08;font-style:italic;">Dự án [${projectCode}] chưa có bản vẽ!</div>`;
            return;
        }

        drawCytoscapeGraph(projectCode, fullData.files, cyArea, localLoader);
    }).catch(err => {
        if (localLoader) localLoader.style.display = "none";
        alert("Lỗi tải bản đồ: " + (err.message || err));
    });
}

/**
 * HÀM TÁCH BIỆT DỰNG GRAPH CYTOSCAPE (TĂNG HIỆU NĂNG TÁI SỬ DỤNG)
 */
function drawCytoscapeGraph(projectCode, filesList, cyArea, localLoader) {
    if (cyInstance) { cyInstance.destroy(); cyInstance = null; }
    cyArea.innerHTML = "";

    setTimeout(() => {
        cyInstance = cytoscape({
            container: cyArea, elements: buildCytoscapeElements({ projectCode: projectCode, files: filesList }), pixelRatio: 2,
            autoungrabify: true, userPanningEnabled: true, userZoomingEnabled: true,
            style: [
                { 
                    selector: 'node', 
                    style: { 
                        'background-color': '#021a31', 
                        'label': 'data(label)', 
                        'color': '#fff', 
                        'font-family': 'Poppins, sans-serif', 
                        'font-size': 18, 
                        'font-weight': 'bold', 
                        'text-valign': 'center', 
                        'text-halign': 'center', 
                        'width': 220, 
                        'height': 68, 
                        'shape': 'round-rectangle', 
                        'border-width': 1.5, 
                        'border-color': '#FFBA08', 
                        'text-wrap': 'wrap', 
                        'text-max-width': 180, 
                        'line-height': 1.4, 
                        'overlay-opacity': 0 
                    } 
                },
                { 
                    selector: 'node[id="root"]', 
                    style: { 
                        'font-size': 24, 
                        'font-weight': '800', 
                        'color': '#FFBA08', 
                        'background-color': '#021a31', 
                        'background-opacity': 0.95, 
                        'width': 125, 
                        'height': 110, 
                        'shape': 'hexagon', 
                        'border-style': 'double', 
                        'border-width': 4, 
                        'border-color': '#FFBA08',
                        'text-valign': 'center',
                        'text-halign': 'center'
                    } 
                },
                { 
                    selector: 'node[?isDept]', 
                    style: { 
                        'width': 60, 
                        'height': 40, 
                        'font-size': 18, 
                        'background-color': '#021a31', 
                        'border-color': 'data(color)', 
                        'border-width': 1.5, 
                        'color': 'data(color)', 
                        'font-weight': 'bold' 
                    } 
                },
                { 
                    selector: 'node[?fileId]', 
                    style: { 
                        'background-color': '#293e5b', 
                        'border-width': 1.5, 
                        'border-color': 'data(color)', 
                        'font-size': 18, 
                        'font-weight': 'normal',
                        'text-wrap': 'wrap', 
                        'text-max-width': 200, 
                        'width': 240, 
                        'height': 100, 
                        'text-valign': 'center', 
                        'line-height': 1.4,
                        'color': (el) => el.data('color').toUpperCase() === '#FFBA08' ? '#FFFFFF' : el.data('color')
                    } 
                },
                { 
                    selector: 'node[?isDate]', 
                    style: { 
                        'width': 125, 
                        'height': 44, 
                        'background-opacity': 0, 
                        'border-color': '#FFBA08', 
                        'border-width': 1.5, 
                        'font-size': 18, 
                        'font-weight': 'bold', 
                        'color': '#FFBA08', 
                        'shape': 'round-rectangle', 
                        'text-valign': 'center', 
                        'text-halign': 'center' 
                    } 
                },
                { 
                    selector: 'edge', 
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

        const branchGoc = cyInstance.getElementById('branch_goc');
        if (branchGoc.length > 0 && branchGoc.successors().length > 0) {
            branchGoc.data('collapsed', true);
            branchGoc.data('originalLabel', branchGoc.data('label'));
            branchGoc.data('label', branchGoc.data('originalLabel') + ' [ + ]');
            
            branchGoc.scratch('hiddenElements', branchGoc.successors());
            cyInstance.remove(branchGoc.successors());
        }

        cyInstance.resize();
        
        cyInstance.layout({ 
            name: 'dagre', 
            rankDir: 'LR', 
            nodeSep: 45, 
            rankSep: 80, 
            animate: false, 
            fit: true, 
            padding: 20, 
            sort: (a, b) => {
                const getPri = (n) => {
                    if (n.id() === 'root') return 1;
                    if (['branch_goc', 'branch_update', 'branch_proposal'].includes(n.id())) return 2;
                    if (n.data('isDate')) return 3;
                    if (n.id().includes('_Thân') || n.id().includes('_Hầm')) return 4;
                    if (n.data('isDept')) return 5;
                    return 6;
                };
                const pA = getPri(a);
                const pB = getPri(b);
                if (pA !== pB) return pA - pB;
                
                const svA = a.data('sortValue') || 0;
                const svB = b.data('sortValue') || 0;
                if (svA !== svB) {
                    return svB - svA;
                }
                
                const nameA = a.data('fullName') || a.data('label') || "";
                const nameB = b.data('fullName') || b.data('label') || "";
                return nameB.localeCompare(nameA, 'vi', { numeric: true, sensitivity: 'base' });
            },
            stop: () => { 
                enforceBidirectionalLayout();
                if (localLoader) localLoader.style.display = "none";
                cyArea.style.opacity = "1"; 
                cyInstance.resize(); 
                cyInstance.fit(null, 20);
            } 
        }).run();
        
        cyInstance.on('tap', 'node#branch_goc', function(evt) {
            const node = evt.target;
            const isCollapsed = node.data('collapsed');

            cyInstance.nodes().forEach(n => {
                n.scratch('startPos', { ...n.position() });
            });
            const startZoom = cyInstance.zoom();
            const startPan = { ...cyInstance.pan() };

            if (isCollapsed) {
                const hiddenElements = node.scratch('hiddenElements');
                if (hiddenElements) {
                    cyInstance.add(hiddenElements);

                    const parentPos = node.position();
                    hiddenElements.forEach(el => {
                        if (el.isNode()) {
                            el.position({ x: parentPos.x, y: parentPos.y });
                            el.scratch('startPos', { x: parentPos.x, y: parentPos.y });
                        }
                    });
                }
                node.data('collapsed', false);
                node.data('label', node.data('originalLabel') + ' [ - ]');
            } else {
                if (node.successors().length === 0) return;

                node.data('collapsed', true);
                node.data('label', node.data('originalLabel') + ' [ + ]');

                node.scratch('hiddenElements', node.successors());
                cyInstance.remove(node.successors());

                closeFileDetail();
            }

            cyInstance.layout({ 
                name: 'dagre', 
                rankDir: 'LR', 
                nodeSep: 45, 
                rankSep: 80, 
                animate: false, 
                fit: false, 
                padding: 20,
                sort: (a, b) => {
                    const getPri = (n) => {
                        if (n.id() === 'root') return 1;
                        if (['branch_goc', 'branch_update', 'branch_proposal'].includes(n.id())) return 2;
                        if (n.data('isDate')) return 3;
                        if (n.id().includes('_Thân') || n.id().includes('_Hầm')) return 4;
                        if (n.data('isDept')) return 5;
                        return 6;
                    };
                    const pA = getPri(a);
                    const pB = getPri(b);
                    if (pA !== pB) return pA - pB;
                    
                    const svA = a.data('sortValue') || 0;
                    const svB = b.data('sortValue') || 0;
                    if (svA !== svB) {
                        return svB - svA; 
                    }
                    
                    const nameA = a.data('fullName') || a.data('label') || "";
                    const nameB = b.data('fullName') || b.data('label') || "";
                    return nameB.localeCompare(nameA, 'vi', { numeric: true, sensitivity: 'base' });
                },
                stop: () => {
                    enforceBidirectionalLayout(); 
                    
                    const endPositions = new Map();
                    cyInstance.nodes().forEach(n => endPositions.set(n.id(), { ...n.position() }));

                    cyInstance.fit(null, 20);
                    const targetZoom = cyInstance.zoom();
                    const targetPan = { ...cyInstance.pan() };

                    cyInstance.zoom(startZoom);
                    cyInstance.pan(startPan);
                    
                    cyInstance.nodes().forEach(n => {
                        const startPos = n.scratch('startPos');
                        if (startPos) n.position(startPos);
                    });

                    cyInstance.nodes().forEach(n => {
                        n.animate({
                            position: endPositions.get(n.id()),
                            duration: 350,
                            easing: 'ease-out-cubic'
                        });
                    });
                    
                    cyInstance.animate({
                        zoom: targetZoom,
                        pan: targetPan,
                        duration: 350,
                        easing: 'ease-out-cubic'
                    });
                }
            }).run();
        });

        cyInstance.on('tap', 'node', (evt) => { if (evt.target.data('fileId')) updatePanelContent(evt.target.data()); });
        cyInstance.on('dbltap', 'node', (evt) => { if (evt.target.data('fileId') && evt.target.data('url') !== "#") window.open(evt.target.data('url'), '_blank'); });
        cyInstance.on('mouseover', 'node[?fileId]', () => document.getElementById('cy').style.cursor = 'pointer');
        cyInstance.on('mouseout', 'node[?fileId]', () => document.getElementById('cy').style.cursor = 'default');
        
        cyInstance.on('mouseover', 'node#branch_goc', () => document.getElementById('cy').style.cursor = 'pointer');
        cyInstance.on('mouseout', 'node#branch_goc', () => document.getElementById('cy').style.cursor = 'default');
        
    }, 100);
}

function buildCytoscapeElements(data) {
    let elements = [], addedNodes = new Set();
    const GOLD = '#FFBA08', DEPT_COLORS = { 'STR': '#BCC6CC', 'ARC': '#50C878', 'MEP': '#CD7F32', 'KHÁC': GOLD };
    const DEPT_ORDER = { 'STR': 1, 'ARC': 2, 'MEP': 3, 'KHÁC': 4 };

    function addNode(id, label, parentId, nodeColor, fileId = null, url = null, isDept = false, isDate = false, type = null, fullName = null, sortValue = 0) {
        if (!addedNodes.has(id)) {
            elements.push({ 
                data: { id, label, color: nodeColor, fileId, url, isDept, isDate, type, fullName, sortValue },
                selectable: !!fileId 
            });
            addedNodes.add(id);
            if (parentId) {
                elements.push({ 
                    data: { 
                        source: parentId, 
                        target: id, 
                        color: fileId ? nodeColor : GOLD,
                        arrowShape: fileId ? 'triangle' : 'none'
                    },
                    selectable: false 
                });
            }
        }
    }

    addNode('root', data.projectCode.toUpperCase(), null, GOLD, null, null, false, false, null, null, 0); 
    addNode('branch_goc', 'BẢN VẼ TKTC', 'root', GOLD, null, null, false, false, null, null, 0);
    addNode('branch_update', 'BẢN VẼ CẬP NHẬT', 'root', GOLD, null, null, false, false, null, null, 0);
    addNode('branch_proposal', 'PHIẾU ĐỀ XUẤT', 'root', GOLD, null, null, false, false, null, null, 0);

    if(data.files) {
        const TYPE_PRIORITY = { 'PROPOSAL': 1, 'UPDATE': 2, 'ORIGINAL': 3 };
        
        data.files.sort((a, b) => {
            const pA = TYPE_PRIORITY[a.type] || 4;
            const pB = TYPE_PRIORITY[b.type] || 4;
            if (pA !== pB) return pA - pB;
            
            const svA = a.sortValue || 0;
            const svB = b.sortValue || 0;
            if (svA !== svB) {
                return svB - svA;
            }
            
            return a.fileName.localeCompare(b.fileName, 'vi', { numeric: true, sensitivity: 'base' });
        });

        const seenFiles = new Set();

        data.files.forEach(f => {
            let namePart = f.fileName.replace(/\.(pdf|xlsx|xls)$/i, "");
            const projectCode = (data.projectCode || "").toString();

            const patterns = [
                new RegExp(projectCode, 'gi'),
                /PĐX/gi, /BVTKTC/gi, /TKBVTC/gi, /STR/gi, /ARC/gi, /MEP/gi, /\d{6}/g
            ];

            patterns.forEach(p => {
                namePart = namePart.replace(p, "");
            });

            let cleanName = namePart.replace(/_+/g, "_").replace(/\s+/g, " ").replace(/^[_ \s]+|[_ \s]+$/g, "");
            // Loại bỏ hoàn toàn đuôi mở rộng .pdf / .xlsx / .xls trên nhãn hiển thị
            const smartName = cleanName ? cleanName : f.fileName.replace(/\.(pdf|xlsx|xls)$/i, "");
            
            const dateId = f.sortValue || 'nodate', deptKey = f.dept.toUpperCase(), deptColor = DEPT_COLORS[deptKey] || DEPT_COLORS['KHÁC'];
            const formattedDateLabel = (f.dateLabel || "--/--/----").replace(/\//g, "-");
            
            if (f.type === 'ORIGINAL') {
                const dNode = 'date_goc_' + dateId;
                addNode(dNode, formattedDateLabel, 'branch_goc', GOLD, null, null, false, true, null, null, f.sortValue);
                
                if (f.branch === 'Chung') {
                    const sNodeThân = dNode + '_Thân', deptIdThân = sNodeThân + '_' + f.dept;
                    const sNodeHầm = dNode + '_Hầm', deptIdHầm = sNodeHầm + '_' + f.dept;
                    
                    const dupKey = f.fileName.toUpperCase() + "_" + deptIdThân;
                    if (seenFiles.has(dupKey)) return;
                    seenFiles.add(dupKey);

                    addNode(sNodeThân, 'THÂN', dNode, GOLD, null, null, false, false, null, null, f.sortValue);
                    addNode(deptIdThân, f.dept.toUpperCase(), sNodeThân, deptColor, null, null, true, false, null, null, f.sortValue);

                    addNode(sNodeHầm, 'HẦM', dNode, GOLD, null, null, false, false, null, null, f.sortValue);
                    addNode(deptIdHầm, f.dept.toUpperCase(), sNodeHầm, deptColor, null, null, true, false, null, null, f.sortValue);

                    addNode(f.fileId, smartName, null, deptColor, f.fileId, f.url, false, false, f.type, f.fileName, f.sortValue);

                    elements.push({ data: { source: deptIdThân, target: f.fileId, color: deptColor, arrowShape: 'triangle' }, selectable: false });
                    elements.push({ data: { source: deptIdHầm, target: f.fileId, color: deptColor, arrowShape: 'triangle' }, selectable: false });
                } else {
                    const sNode = dNode + '_' + f.branch, deptId = sNode + '_' + f.dept;
                    
                    const dupKey = f.fileName.toUpperCase() + "_" + deptId;
                    if (seenFiles.has(dupKey)) return;
                    seenFiles.add(dupKey);

                    addNode(sNode, f.branch.toUpperCase(), dNode, GOLD, null, null, false, false, null, null, f.sortValue);
                    addNode(deptId, f.dept.toUpperCase(), sNode, deptColor, null, null, true, false, null, null, f.sortValue);
                    
                    addNode(f.fileId, smartName, deptId, deptColor, f.fileId, f.url, false, false, f.type, f.fileName, f.sortValue);
                }
            } else {
                const bParent = f.type === 'UPDATE' ? 'branch_update' : 'branch_proposal';
                const dNode = 'date_alt_' + bParent + '_' + dateId;
                
                const dupKey = f.fileName.toUpperCase() + "_" + dNode;
                if (seenFiles.has(dupKey)) return;
                seenFiles.add(dupKey);

                addNode(dNode, formattedDateLabel, bParent, GOLD, null, null, false, true, null, null, f.sortValue);
                
                addNode(f.fileId, smartName, dNode, deptColor, f.fileId, f.url, false, false, f.type, f.fileName, f.sortValue);
            }
        });
    }
    return elements;
}

function updatePanelContent(nodeData) {
    currentFileId = nodeData.fileId;
    document.getElementById('dp-empty-state').style.display = 'none';
    document.getElementById('dp-content-state').style.display = 'flex';
    
    const fileNameWithExt = nodeData.label.split('\n').pop();
    // Tách lọc bỏ phần đuôi mở rộng .pdf / .xlsx / .xls theo yêu cầu của sếp
    const fileNameClean = fileNameWithExt.replace(/\.(pdf|xlsx|xls)$/i, "");

    let aiZoneHTML = "";
    const isProcessable = (nodeData.type === 'UPDATE' || nodeData.type === 'PROPOSAL');

    if (isProcessable) {
        // Giao diện AI tương lai (Sleek Horizontal)
        aiZoneHTML = `
            <div id="ai-paste-zone" class="ai-command-button" onclick="extractFromCurrentSelected()">
                <div class="ai-icon-frame">
                    <i class="bi bi-robot" id="ai-robot-icon" style="font-size: 24px; color: #00BCD4; transition: all 0.3s;"></i>
                </div>
                <div class="ai-command-text-wrapper">
                    <div id="ai-main-msg" style="font-size: 11.5px; color: #FFFFFF; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;">AI DATA EXTRACTION</div>
                    <div id="ai-sub-msg" style="font-size: 10px; color: #95A1AF; margin-top: 4px; font-style: italic; letter-spacing: 0.2px;">Chọn để trích xuất nội dung tự động</div>
                </div>
            </div>`;
    } else {
        // Giao diện khóa ngầm của bản vẽ gốc
        aiZoneHTML = `
            <div class="ai-command-button ai-command-disabled">
                <div class="ai-icon-frame" style="background: rgba(149, 161, 175, 0.05); border-color: rgba(149, 161, 175, 0.2);">
                    <i class="bi bi-robot" style="font-size: 24px; color: #505966; opacity: 0.4;"></i>
                </div>
                <div class="ai-command-text-wrapper">
                    <div style="font-size: 11.5px; color: #505966; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;">AI NOT SUPPORTED</div>
                    <div style="font-size: 10px; color: #505966; margin-top: 4px; font-style: italic; letter-spacing: 0.2px;">Chỉ áp dụng cho Phiếu đề xuất / Bản vẽ Cập nhật</div>
                </div>
            </div>`;
    }

    // 🚀 CẬP NHẬT GIAO DIỆN: Đổ dữ liệu nodeData.fullName (tên đầy đủ nguyên bản) vào nút Sửa Pencil
    document.getElementById('dp-file-list').innerHTML = `
        <div class="existing-file-wrapper" style="padding-right: 5px !important;">
            <div class="existing-file-info" onclick="window.open('${nodeData.url}', '_blank')" style="flex:1; overflow:hidden; display:flex; align-items:center;">
                <i class="bi bi-file-earmark-pdf-fill file-pdf" style="margin-right:10px"></i>
                <span class="file-name-text" style="color:#FFBA08 !important; font-size:12px; font-weight:700;">${fileNameClean}</span>
            </div>
            <div class="existing-file-action" style="width: 32px; display: flex; align-items: center; justify-content: center; position: relative;">
                <button type="button" class="btn-trash-simple btn-scale-hover" onclick="triggerEditDrawing_Client('${nodeData.fileId}', '${escapeStr(nodeData.fullName || fileNameWithExt)}')" style="color: #FFBA08 !important;">
                    <i class="bi bi-pencil-square" style="font-size: 15px;"></i>
                </button>
                <div class="trash-note-pop" style="bottom: -30px !important;">Rename</div>
            </div>
            <div class="existing-file-action" style="width: 32px; display: flex; align-items: center; justify-content: center; position: relative;">
                <button type="button" class="btn-trash-simple btn-scale-hover btn-trash-red" onclick="triggerDeleteDrawing_Client('${nodeData.fileId}', '${escapeStr(nodeData.fullName || fileNameWithExt)}')" style="color: #ff4d4d !important;">
                    <i class="bi bi-trash3" style="font-size: 14px;"></i>
                </button>
                <div class="trash-note-pop note-remove-red" style="bottom: -30px !important;">Delete</div>
            </div>
            <div style="width: 1px; height: 24px; background: rgba(255, 255, 255, 0.12); align-self: center; margin: 0 4px; flex-shrink: 0;"></div>
            <div class="existing-file-action" style="width: 32px; display: flex; align-items: center; justify-content: center; position: relative; margin-right: 5px;">
                <button type="button" class="btn-trash-simple btn-scale-hover" onclick="closeFileDetail()" style="color: #E0E0E0 !important; opacity:0.75;">
                    <i class="bi bi-x-lg" style="font-size: 15px; font-weight: bold;"></i>
                </button>
                <div class="trash-note-pop note-close-grey" style="bottom: -30px !important;">Close</div>
            </div>
        </div>
        ${aiZoneHTML}`;
    
    // Gán nút bấm thực thi xác nhận
    const confirmDeleteBtn = document.getElementById("confirmDeleteDrawingBtn");
    if (confirmDeleteBtn) confirmDeleteBtn.onclick = executeActualDeleteDrawing_Client;

    const confirmEditBtn = document.getElementById("confirmEditDrawingBtn");
    if (confirmEditBtn) confirmEditBtn.onclick = executeActualEditDrawing_Client;

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
 * ==========================================================================
 * 9. TIẾN TRÌNH CHỈNH SỬA TÊN BẢN VẼ VÀ TỰ ĐỘNG TÁI ĐỊNH TUYẾN
 * ==========================================================================
 */
let fileIdToEdit_Drawing = "";
let fileExtToEdit_Drawing = ".pdf";

function triggerEditDrawing_Client(fileId, fileName) {
    fileIdToEdit_Drawing = fileId;
    const overlay = document.getElementById('drawing-edit-confirm-overlay');
    const input = document.getElementById('drawing-edit-input-val');
    if (overlay && input) {
        const extMatch = fileName.match(/\.(pdf|xlsx|xls)$/i);
        fileExtToEdit_Drawing = extMatch ? extMatch[0] : ".pdf";
        
        input.value = fileName.replace(/\.(pdf|xlsx|xls)$/i, "").trim();
        input.setAttribute('maxlength', '58');
        
        // Chặn cứng không cho gõ hoặc dán vượt quá 58 ký tự
        input.oninput = function() {
            if (this.value.length > 58) {
                this.value = this.value.slice(0, 58);
            }
        };
        
        overlay.style.display = "flex";
        setTimeout(() => { 
            overlay.classList.add('show'); 
            input.focus();
            input.select();
        }, 10);
    }
}

function handleQueueItemInput(inputEl, index) {
    if (inputEl.value.length > 58) {
        inputEl.value = inputEl.value.slice(0, 58);
    }
    drawingUploadQueue[index].name = inputEl.value;
    
    // Cập nhật số đếm ký tự trực tiếp không giật DOM
    const counter = document.getElementById(`char-counter-${index}`);
    if (counter) {
        counter.textContent = `(${inputEl.value.length}/58)`;
        counter.style.color = inputEl.value.length >= 58 ? '#FFBA08' : '#505966';
    }
}

function cancelEditDrawing_Client() {
    const overlay = document.getElementById('drawing-edit-confirm-overlay');
    if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { overlay.style.display = "none"; }, 200);
    }
}

function executeActualEditDrawing_Client() {
    if (!fileIdToEdit_Drawing) return;
    const rawVal = document.getElementById('drawing-edit-input-val').value.trim();
    if (!rawVal) return alert("Sếp phải nhập tên file bản vẽ hợp lệ!");

    if (rawVal.length > 58) {
        showToast_PL(`⚠️ Tên file tối đa 58 ký tự (Hiện tại: ${rawVal.length} ký tự)!`, "error");
        return;
    }

    if (/\.(pdf|xlsx|xls)$/i.test(rawVal)) {
        showToast_PL("⚠️ Không nhập đuôi .pdf vào tên file!", "error");
        return;
    }

    const { isValid, fileType: newFileType } = validateDrawingFilename(rawVal);
    if (!isValid) {
        showToast_PL("⚠️ Tên file không đúng cú pháp quy định!", "error");
        return;
    }

    const newVal = rawVal + fileExtToEdit_Drawing;
    const targetFileId = fileIdToEdit_Drawing;
    const projKey = (selectedProjectDrawing || "").toUpperCase().trim();
    fileIdToEdit_Drawing = "";
    
    cancelEditDrawing_Client();

    let originalLabel = "";
    let originalFullName = "";
    let originalType = "";
    let originalDatePart = "";
    let nodeToEdit = null;

    if (cyInstance) {
        nodeToEdit = cyInstance.getElementById(targetFileId);
        if (nodeToEdit.length > 0) {
            originalLabel = nodeToEdit.data('label');
            originalFullName = nodeToEdit.data('fullName');
            originalType = nodeToEdit.data('type');
            originalDatePart = (originalFullName || "").split("_")[0];

            let namePart = rawVal;
            const projectCode = selectedProjectDrawing.toString();

            const patterns = [
                new RegExp(projectCode, 'gi'),
                /PĐX/gi, /BVTKTC/gi, /TKBVTC/gi, /STR/gi, /ARC/gi, /MEP/gi, /\d{6}/g
            ];

            patterns.forEach(p => { namePart = namePart.replace(p, ""); });
            let cleanName = namePart.replace(/_+/g, "_").replace(/\s+/g, " ").replace(/^[_ \s]+|[_ \s]+$/g, "");
            const smartName = cleanName ? cleanName : rawVal;

            // 1. Cập nhật trực tiếp tên hiển thị và dữ liệu trên Node (0ms)
            nodeToEdit.data('label', smartName);
            nodeToEdit.data('fullName', newVal);
            nodeToEdit.data('type', newFileType);
            
            // 2. Cập nhật trực tiếp vào RAM Cache
            if (projectFullDataCache_Drawing[projKey] && projectFullDataCache_Drawing[projKey].files) {
                const targetFileCache = projectFullDataCache_Drawing[projKey].files.find(f => f.fileId === targetFileId);
                if (targetFileCache) {
                    targetFileCache.fileName = newVal;
                    targetFileCache.type = newFileType;
                }
            }
            if (projectFilesCache_Drawing[projKey]) {
                const targetFileCache2 = projectFilesCache_Drawing[projKey].find(f => f.fileId === targetFileId);
                if (targetFileCache2) {
                    targetFileCache2.fileName = newVal;
                    targetFileCache2.type = newFileType;
                }
            }
            
            closeFileDetail();
        }
    }

    showToast_PL("✏️ Đã đổi tên bản vẽ thành công!", "success");

    // 3. KIỂM TRA XEM CÓ THAY ĐỔI CẤU TRÚC (ĐỔI LOẠI NHÁNH HOẶC ĐỔI NGÀY THÁNG) HAY KHÔNG
    const newDatePart = rawVal.split("_")[0];
    const isStructureChanged = (originalType && newFileType && originalType !== newFileType) || 
                               (originalDatePart && newDatePart && originalDatePart !== newDatePart);

    // 4. GỌI BACKEND XỬ LÝ NGẦM TRÊN DRIVE VÀ DATABASE SHEET
    callBackend("renameAndRouteDrawingFile_Backend", { fileId: targetFileId, newFileName: newVal })
        .then(res => {
            // Chỉ vẽ lại sơ đồ khi việc đổi tên làm file phải chuyển sang nhánh khác hoặc cụm ngày khác
            if (res && isStructureChanged && selectedProjectDrawing) {
                delete projectFullDataCache_Drawing[projKey];
                renderMindmap(selectedProjectDrawing, true);
            }
        })
        .catch(err => {
            console.error("Lỗi đổi tên tệp ngầm:", err);
            showToast_PL("⚠️ Lỗi mạng! Không thể sửa tên trên Drive, đang khôi phục...", "error");
            if (nodeToEdit && nodeToEdit.length > 0) {
                nodeToEdit.data('label', originalLabel);
                nodeToEdit.data('fullName', originalFullName);
                nodeToEdit.data('type', originalType);
            }
            delete projectFullDataCache_Drawing[projKey];
            if (selectedProjectDrawing) {
                renderMindmap(selectedProjectDrawing, true);
            }
        });
}

/**
 * ==========================================================================
 * 10. TIẾN TRÌNH XÓA FILE BẢN VẼ GIẢ ĐỊNH (OPTIMISTIC NODE REMOVAL)
 * ==========================================================================
 */
let fileIdToDelete_Drawing = "";

function triggerDeleteDrawing_Client(fileId, fileName) {
    fileIdToDelete_Drawing = fileId;
    const overlay = document.getElementById('drawing-delete-confirm-overlay');
    const dialog = overlay ? overlay.querySelector('.scan-delete-dialog') : null;
    const nameDisplay = document.getElementById('delete-drawing-filename');
    
    if (overlay && nameDisplay) {
        nameDisplay.textContent = fileName;
        overlay.style.display = "flex";
        setTimeout(() => { 
            overlay.style.opacity = "1"; 
            if (dialog) dialog.style.transform = "scale(1)"; 
        }, 10);
    }
}

function cancelDeleteDrawing_Client() {
    const overlay = document.getElementById('drawing-delete-confirm-overlay');
    const dialog = overlay ? overlay.querySelector('.scan-delete-dialog') : null;
    if (overlay) {
        overlay.style.opacity = "0";
        if (dialog) dialog.style.transform = "scale(0.9)";
        setTimeout(() => { overlay.style.display = "none"; }, 200);
    }
}

function executeActualDeleteDrawing_Client() {
    if (!fileIdToDelete_Drawing) return;
    
    const targetFileId = fileIdToDelete_Drawing; 
    fileIdToDelete_Drawing = "";                  
    
    cancelDeleteDrawing_Client();
    
    if (cyInstance) {
        const nodeToDelete = cyInstance.getElementById(targetFileId);
        if (nodeToDelete.length > 0) {
            closeFileDetail(); // Đóng panel chi tiết trước

            // 🚀 1. LƯU TỌA ĐỘ VÀ CAMERA HIỆN TẠI TRƯỚC KHI XÓA
            cyInstance.nodes().forEach(n => {
                n.scratch('startPos', { ...n.position() });
            });
            const startZoom = cyInstance.zoom();
            const startPan = { ...cyInstance.pan() };
            
            // Xóa đệ quy node và các nhánh cha rỗng
            removeEmptyParents_Drawing(nodeToDelete);

            // 🚀 2. TÍNH TOÁN VỊ TRÍ MỚI NGẦM (animate: false để không bị giật lệch hướng)
            cyInstance.layout({
                name: 'dagre',
                rankDir: 'LR',
                nodeSep: 45,
                rankSep: 80,
                animate: false,
                fit: false,
                padding: 20,
                sort: (a, b) => {
                    const getPri = (n) => {
                        if (n.id() === 'root') return 1;
                        if (['branch_goc', 'branch_update', 'branch_proposal'].includes(n.id())) return 2;
                        if (n.data('isDate')) return 3;
                        if (n.id().includes('_Thân') || n.id().includes('_Hầm')) return 4;
                        if (n.data('isDept')) return 5;
                        return 6;
                    };
                    const pA = getPri(a);
                    const pB = getPri(b);
                    if (pA !== pB) return pA - pB;
                    
                    const svA = a.data('sortValue') || 0;
                    const svB = b.data('sortValue') || 0;
                    if (svA !== svB) {
                        return svB - svA;
                    }
                    
                    const nameA = a.data('fullName') || a.data('label') || "";
                    const nameB = b.data('fullName') || b.data('label') || "";
                    return nameB.localeCompare(nameA, 'vi', { numeric: true, sensitivity: 'base' });
                },
                stop: () => {
                    // Áp dụng bố cục 2 nhánh đối xứng ngầm
                    enforceBidirectionalLayout();
                    
                    // Lưu tọa độ đích của các node còn lại
                    const endPositions = new Map();
                    cyInstance.nodes().forEach(n => endPositions.set(n.id(), { ...n.position() }));

                    // Đo đạc thông số Camera Fit lý tưởng ngầm (0ms)
                    cyInstance.fit(null, 20);
                    const targetZoom = cyInstance.zoom();
                    const targetPan = { ...cyInstance.pan() };

                    // Trả lại vị trí xuất phát để chuẩn bị bay
                    cyInstance.zoom(startZoom);
                    cyInstance.pan(startPan);
                    cyInstance.nodes().forEach(n => {
                        const startPos = n.scratch('startPos');
                        if (startPos) n.position(startPos);
                    });

                    // 🚀 3. CHẠY HOẠT ẢNH ĐỒNG BỘ 1 NHỊP DUY NHẤT: Node trượt mượt mà & Camera co giãn êm ái
                    cyInstance.nodes().forEach(n => {
                        n.animate({
                            position: endPositions.get(n.id()),
                            duration: 350,
                            easing: 'ease-out-cubic'
                        });
                    });

                    cyInstance.animate({
                        zoom: targetZoom,
                        pan: targetPan,
                        duration: 350,
                        easing: 'ease-out-cubic'
                    });
                }
            }).run();
        }
    }
    
    showToast_PL("🗑️ Đã xóa bản vẽ thành công!", "success");
    
    // Xóa ngầm trên Drive và Sheet
    callBackend("deleteDrawingFileAndTasks_Backend", targetFileId)
        .catch(err => {
            console.error("Lỗi xóa tệp ngầm:", err);
            showToast_PL("⚠️ Không thể xóa bản vẽ trên Drive! Đang đồng bộ lại sơ đồ...", "error");
            if (selectedProjectDrawing) {
                renderMindmap(selectedProjectDrawing);
            }
        });
}

function removeEmptyParents_Drawing(node) {
    if (!cyInstance || !node) return;
    
    // 1. Tìm các cạnh đi vào node này (cạnh nối từ node cha tới node hiện tại)
    const parentEdges = node.incomers('edge');
    const parents = parentEdges.sources(); // Lấy danh sách các node cha
    
    // 2. Xóa node hiện tại khỏi sơ đồ (Cytoscape tự động xóa tất cả các cạnh kết nối với nó)
    cyInstance.remove(node);
    
    // 3. Quét đệ quy ngược lên các node cha
    parents.forEach(parent => {
        const parentId = parent.id();
        
        // Danh sách các nhánh gốc cố định của hệ thống tuyệt đối không được xóa
        const isPermanentRoot = ['root', 'branch_goc', 'branch_update', 'branch_proposal'].includes(parentId);
        
        if (!isPermanentRoot) {
            // Kiểm tra xem sau khi con bị xóa, node cha này còn cạnh đi ra (tức là còn con khác) nào không
            const outgoingEdges = parent.outgoers('edge');
            
            if (outgoingEdges.length === 0) {
                // Nếu node cha hoàn toàn trống rỗng, tiếp tục dọn dẹp đệ quy ngược lên trên
                removeEmptyParents_Drawing(parent);
            }
        }
    });
}

/**
 * KHỞI TẠO SỰ KIỆN KÉO THẢ BẢN VẼ TRÊN WEB APP (ĐÃ NÂNG CẤP HỖ TRỢ MULTIPLE FILES)
 */
function initDrawingUploadZone() {
    const zone = document.getElementById('drawing-upload-zone');
    const input = document.getElementById('drawing-upload-input');
    if (!zone || !input || zone.dataset.bound) return;
    
    zone.dataset.bound = "true"; 
    
    zone.addEventListener('click', (e) => {
        const stateEmpty = document.getElementById("drawing-state-empty");
        if (stateEmpty && stateEmpty.style.display !== "none") {
            input.click();
        }
    });
    input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            addFilesToDrawingQueue(e.target.files);
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
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addFilesToDrawingQueue(e.dataTransfer.files);
        }
    });
}

function addFilesToDrawingQueue(files) {
    if (!files || !files.length) return;
    
    const incomingFiles = Array.from(files).filter(f => {
        const name = f.name.toLowerCase();
        return name.endsWith(".pdf") || name.endsWith(".xls") || name.endsWith(".xlsx");
    });
    
    if (incomingFiles.length === 0) {
        showToast_PL("⚠️ Chỉ chấp nhận định dạng PDF hoặc Excel!", "error");
        return;
    }

    incomingFiles.forEach(newFile => {
        const isDuplicateInQueue = drawingUploadQueue.some(oldItem => 
            oldItem.rawName === newFile.name && oldItem.size === newFile.size
        );
        if (!isDuplicateInQueue) {
            const extMatch = newFile.name.match(/\.(pdf|xlsx|xls)$/i);
            const ext = extMatch ? extMatch[0] : ".pdf";
            const cleanNameWithoutExt = newFile.name.replace(/\.(pdf|xlsx|xls)$/i, "").trim();
            
            drawingUploadQueue.push({
                file: newFile,
                name: cleanNameWithoutExt, // Hiển thị không có đuôi .pdf
                rawName: newFile.name,
                ext: ext,
                size: newFile.size
            });
        }
    });
    renderDrawingQueueUI();
}

function renderDrawingQueueUI() {
    const stateEmpty = document.getElementById("drawing-state-empty");
    const stateQueue = document.getElementById("drawing-state-queue");
    const stateUploading = document.getElementById("drawing-state-uploading");
    const queueList = document.getElementById("drawing-queue-list");
    
    if (!stateEmpty || !stateQueue || !stateUploading || !queueList) return;
    
    if (!isUploading_Drawing) {
        if (drawingUploadQueue.length === 0) {
            stateEmpty.style.display = "flex";
            stateQueue.style.display = "none";
            stateUploading.style.display = "none";
            return;
        }
        
        stateEmpty.style.display = "none";
        stateQueue.style.display = "flex";
        stateUploading.style.display = "none";
    }
    
    let html = "";
    drawingUploadQueue.forEach((fileItem, index) => {
        const fileSizeMB = (fileItem.size / (1024 * 1024)).toFixed(2);
        const { isValid, fileType } = validateDrawingFilename(fileItem.name);
        const isDuplicateOnDrive = checkIsDuplicateOnDrive(fileItem.name + fileItem.ext);
        
        let iconClass = "bi-file-earmark-x-fill";
        let iconColor = "#ff4d4d"; 
        
        if (isValid) {
            if (fileType === "ORIGINAL") {
                iconClass = "bi-file-earmark-fill";
                iconColor = "#50C878";
            } else if (fileType === "UPDATE") {
                iconClass = "bi-file-earmark-arrow-up-fill";
                iconColor = "#00BCD4";
            } else if (fileType === "PROPOSAL") {
                iconClass = "bi-file-earmark-medical-fill";
                iconColor = "#FFBA08";
            }
        }
        
        html += `
        <div class="task-item" style="margin-bottom: 5px; border-color: ${isValid ? 'transparent' : 'rgba(255,77,77,0.3)'}; background: ${isValid ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255,77,77,0.05)'};">
                <i class="bi ${iconClass}" style="color: ${iconColor} !important; font-size: 14px; flex-shrink: 0; margin-right: 5px;"></i>
                
                <input type="text" value="${fileItem.name}" 
                       maxlength="58"
                       class="task-desc-edit" 
                       style="color: ${isValid ? 'rgba(255, 255, 255, 0.8)' : '#ff7777'} !important; font-weight: 500; height: 100%;"
                       oninput="handleQueueItemInput(this, ${index})"
                       onchange="renameFileInDrawingQueue(this.value, ${index})"
                       onclick="event.stopPropagation();"
                >
                
                ${isDuplicateOnDrive && isValid ? `
                    <span style="font-size: 9px; color: #FFBA08; font-weight: bold; background: rgba(255,186,8,0.08); border: 1.2px solid rgba(255,186,8,0.3); padding: 1.5px 6px; border-radius: 4px; margin-right: 8px; flex-shrink: 0; display: inline-flex; align-items: center; gap: 3px;">
                        <i class="bi bi-exclamation-triangle-fill" style="font-size: 9px;"></i>TRÙNG FILE
                    </span>` : ''
                }
                
                <span id="char-counter-${index}" style="font-size: 9.5px; color: ${fileItem.name.length >= 58 ? '#FFBA08' : '#505966'}; font-style: italic; flex-shrink: 0; margin-right: 10px;">
                    (${fileItem.name.length}/58)
                </span>
                
                <i class="bi bi-trash3-fill" style="color:#ff4d4d; cursor:pointer; font-size:14px; opacity:0.5; transition: opacity 0.2s;" 
                   onmouseover="this.style.opacity='1'" 
                   onmouseout="this.style.opacity='0.5'" 
                   onclick="removeFileFromDrawingQueue(event, ${index})"></i>
            </div>`;
    });
    
    queueList.innerHTML = html;
}

function removeFileFromDrawingQueue(event, index) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    drawingUploadQueue.splice(index, 1);
    
    // SỬA TẠI ĐÂY: Reset giá trị input thuần về rỗng để xóa cache trình duyệt
    const fileInput = document.getElementById('drawing-upload-input');
    if (fileInput) fileInput.value = "";
    
    renderDrawingQueueUI();
}

function clearDrawingUploadQueue(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    drawingUploadQueue = [];
    
    // SỬA TẠI ĐÂY: Reset giá trị input thuần về rỗng khi hủy hàng chờ
    const fileInput = document.getElementById('drawing-upload-input');
    if (fileInput) fileInput.value = "";
    
    renderDrawingQueueUI();
}

/**
 * TRUYỀN TẢI LÔ TUẦN TỰ (XÓA RAM CACHE & HIỂN THỊ FILE MỚI NGAY TỨC THÌ LÊN MINDMAP)
 */
async function startDrawingQueueUpload(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (isUploading_Drawing || drawingUploadQueue.length === 0) return;
    
    const stateQueue = document.getElementById("drawing-state-queue");
    const stateUploading = document.getElementById("drawing-state-uploading");
    const statusText = document.getElementById("drawing-upload-status");
    const progressBar = document.getElementById("drawing-upload-progress");
    const fileInput = document.getElementById("drawing-upload-input");
    
    if (!stateQueue || !stateUploading || !statusText || !progressBar) return;
    
    // 1. Kiểm tra tiến trình check trùng lặp ngầm
    let isCheckingDuplicates = false;
    for (let f of drawingUploadQueue) {
        const parts = f.name.split("_");
        if (parts.length >= 2) {
            const projectCode = parts[1].trim().toUpperCase();
            if (pendingFetches_Drawing.has(projectCode)) {
                isCheckingDuplicates = true;
                break;
            }
        }
    }
    
    if (isCheckingDuplicates) {
        showToast_PL("⏳ Đang kiểm tra trùng lặp, vui lòng đợi 1 giây rồi tiếp tục!", "error");
        return;
    }

    // 2. Kiểm tra định dạng tên file hợp lệ
    let hasInvalidFile = false;
    for (let f of drawingUploadQueue) {
        const { isValid } = validateDrawingFilename(f.name);
        if (!isValid) {
            hasInvalidFile = true;
            break;
        }
    }
    
    if (hasInvalidFile) {
        showToast_PL("⚠️ Sai tên file (đỏ). Hãy sửa trước khi UP!", "error");
        return;
    }
    
    // 3. Kiểm tra trùng lặp trên Drive
    let hasDuplicateFile = false;
    for (let f of drawingUploadQueue) {
        if (checkIsDuplicateOnDrive(f.name + f.ext)) {
            hasDuplicateFile = true;
            break;
        }
    }
    
    if (hasDuplicateFile) {
        showToast_PL("⚠️ Trùng tên hoặc file đã được UP. Vui lòng kiểm tra lại!", "error");
        return;
    }
    
    isUploading_Drawing = true;
    stateQueue.style.display = "none";
    stateUploading.style.display = "flex";
    progressBar.style.width = "0%";
    
    try {
        const filesToUpload = [...drawingUploadQueue]; 
        
        for (let idx = 0; idx < filesToUpload.length; idx++) {
            let fileItem = filesToUpload[idx];
            const physicalFileName = fileItem.name + fileItem.ext;
            
            statusText.textContent = `[${idx + 1}/${filesToUpload.length}] INIT SESSION...`;
            
            const session = await callBackend("getDrawingUploadSession_Backend", {
                fileName: physicalFileName,
                fileSize: fileItem.size,
                mimeType: fileItem.file.type || (fileItem.ext === ".pdf" ? "application/pdf" : "application/octet-stream")
            });
            
            if (!session || !session.success) {
                throw new Error(`Lỗi tải tệp [${physicalFileName}]: ` + (session ? session.error : "Không thể khởi tạo phiên."));
            }
            
            const uploadUrl = session.uploadUrl;
            const chunkSize = 5 * 1024 * 1024; 
            const totalChunks = Math.ceil(fileItem.size / chunkSize);
            
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, fileItem.size);
                const chunkBlob = fileItem.file.slice(start, end);
                
                const currentOverallPercent = Math.round(((idx / filesToUpload.length) * 100) + (((i + 1) / totalChunks) * (100 / filesToUpload.length)));
                statusText.textContent = `[${idx + 1}/${filesToUpload.length}] UPLOADING... ${currentOverallPercent}%`;
                progressBar.style.width = currentOverallPercent + "%";
                
                try {
                    const response = await fetch(uploadUrl, {
                        method: "PUT",
                        headers: { "Content-Range": `bytes ${start}-${end - 1}/${fileItem.size}` },
                        body: chunkBlob
                    });
                    
                    if (response.status !== 308 && response.status !== 200 && response.status !== 201) {
                        throw new Error(`Google API phản hồi lỗi ${response.status} khi tải mảnh số ${i + 1}.`);
                    }
                } catch (fetchError) {
                    const isLastChunk = (i === totalChunks - 1);
                    const isFetchError = fetchError.message.includes("Failed to fetch") || fetchError.name === "TypeError";
                    if (isLastChunk && isFetchError) {
                        console.warn("[CORS Warning] Bypassed final chunk browser CORS block.");
                        break; 
                    } else throw fetchError;
                }
            }
            
            drawingUploadQueue = drawingUploadQueue.filter(item => item !== fileItem);
            renderDrawingQueueUI();
        }
        
        statusText.textContent = "SAVING TO DATABASE...";
        progressBar.style.width = "100%";
        
        // 4. Đồng bộ cấu trúc vào Sheet Drawing_Log và XÓA RAM CACHE cũ
        const uploadedProjectCodes = [...new Set(filesToUpload.map(f => {
            const parts = f.name.split("_");
            return parts.length >= 2 ? parts[1].trim().toUpperCase() : "";
        }).filter(Boolean))];

        for (const projCode of uploadedProjectCodes) {
            // 🚀 XÓA RAM CACHE để bắt buộc nạp dữ liệu mới
            delete projectFullDataCache_Drawing[projCode];
            await callBackend("syncDrawingsToSheet_Backend", projCode);
        }
        
        showToast_PL(`🚀 Đã tải lên và lưu trữ thành công!`, "success");
        
        // 5. Reset hàng chờ upload và khôi phục bảng SYSTEM GUIDELINES mặc định
        drawingUploadQueue = [];
        if (fileInput) fileInput.value = ""; 
        isUploading_Drawing = false;
        renderDrawingQueueUI();
        
        document.getElementById('dp-empty-state').style.display = 'flex';
        document.getElementById('dp-content-state').style.display = 'none';
        currentFileId = "";
        
        // 6. Ép vẽ lại Mindmap với cờ forceRefresh = true để nạp ngay file mới
        const targetProj = uploadedProjectCodes[0] || selectedProjectDrawing;
        if (targetProj) {
            selectedProjectDrawing = targetProj;
            currentlyRenderedProject = ""; 
            const projInput = document.getElementById("drawing-project-search");
            if (projInput) projInput.value = targetProj;
            renderMindmap(targetProj, true); // 🚀 BẬT CỜ ÉP LÀM MỚI TỨC THÌ
        }
        
    } catch (e) {
        console.error("Lỗi tải tệp phân mảnh:", e);
        alert(e.message || e);
        isUploading_Drawing = false;
        stateUploading.style.display = "none";
        stateQueue.style.display = "flex";
        renderDrawingQueueUI(); 
    } finally {
        isUploading_Drawing = false;
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
    
    return items.map(t => `
        <div class="task-item" draggable="false" ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)" id="task-${t.taskId}">
            <div class="drag-handle" onmousedown="this.parentElement.setAttribute('draggable', 'true')">
                <i class="bi bi-grip-vertical"></i>
            </div>
            
            <input type="text" class="task-desc-edit" value="${t.description}" 
                   onblur="updateTaskDescInline('${t.taskId}', this.value)" 
                   onkeydown="if(event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.blur(); }">
            
            <i class="bi bi-trash3-fill" style="color:#ff4d4d; cursor:pointer; font-size:14px; opacity:0.5; transition: opacity 0.2s;" 
               onmouseover="this.style.opacity='1'" 
               onmouseout="this.style.opacity='0.5'" 
               onclick="deleteTask_Drawing('${t.taskId}')"></i>
        </div>`
    ).join("");
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

let projectFullDataCache_Drawing = {};

function syncManual() {
    // 1. Quét lại danh sách dự án mới nhất từ Drive
    fetchActiveProjectsForDrawing(true);
    
    // 2. Xóa cache RAM và đồng bộ lại Mindmap dự án hiện tại
    if (selectedProjectDrawing) {
        delete projectFullDataCache_Drawing[selectedProjectDrawing.toUpperCase()];
        const localLoader = document.getElementById("drawing-local-loader");
        if (localLoader) localLoader.style.display = "flex";
        drawingTaskCache = {};
        currentlyRenderedProject = "";
        renderMindmap(selectedProjectDrawing, true);
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
    // 🚀 BỔ SUNG: Chụp lại trạng thái gốc trước khi chèn phần tử trống để cho phép hoàn tác xóa bỏ dòng mới hoàn toàn nếu bấm Undo
    if (!drawingTaskSnapshot) {
        drawingTaskSnapshot = JSON.parse(JSON.stringify(drawingTaskCache[currentFileId] || []));
    }

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

    if (!isNewItem && !drawingTaskSnapshot) {
        drawingTaskSnapshot = JSON.parse(JSON.stringify(drawingTaskCache[currentFileId] || []));
    }
    
    // Nếu để trống -> Xóa
    if (trimmedVal === "") {
        drawingTaskCache[currentFileId].splice(taskIndex, 1);
        displayTasksHTML(drawingTaskCache[currentFileId]);
        
        // 🚀 ĐỒNG BỘ TRẠNG THÁI REAL-TIME: 
        if (checkTasksUnchanged()) {
            cancelDrawingSync(); 
        } else {
            triggerDrawingSync_10s();
        }
    } else {
        // NẾU CÓ NỘI DUNG -> CẬP NHẬT CACHE
        if (drawingTaskCache[currentFileId][taskIndex].description !== trimmedVal) {
            drawingTaskCache[currentFileId][taskIndex].description = trimmedVal;
            
            // 🚀 ĐỒNG BỘ TRẠNG THÁI REAL-TIME:
            if (checkTasksUnchanged()) {
                cancelDrawingSync();
            } else {
                triggerDrawingSync_10s();
            }
        }
    }
}

function deleteTask_Drawing(id) {
    const isNewItem = id.startsWith("T-");
    
    if (!isNewItem && !drawingTaskSnapshot) {
        drawingTaskSnapshot = JSON.parse(JSON.stringify(drawingTaskCache[currentFileId] || []));
    }
    
    drawingTaskCache[currentFileId] = drawingTaskCache[currentFileId].filter(x => x.taskId !== id);
    displayTasksHTML(drawingTaskCache[currentFileId]);
    
    // 🚀 ĐỒNG BỘ TRẠNG THÁI REAL-TIME: 
    // Nếu danh sách quay về trùng khớp hoàn toàn với bản gốc trước khi sửa đổi, hủy đếm ngược ngay lập tức
    if (checkTasksUnchanged()) {
        cancelDrawingSync(); 
    } else {
        triggerDrawingSync_10s();
    }
}

function removeVietnameseDiacritics(str) {
  if (!str) return "";
  return str.normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Xóa các dấu thanh
            .replace(/đ/g, "d")
            .replace(/Đ/g, "D")
            .toLowerCase()
            .trim();
}

function renameFileInDrawingQueue(newName, index) {
    const trimmedName = newName.trim();
    if (!trimmedName) {
        showToast_PL("⚠️ Tên tệp tin không được phép để trống!", "error");
        renderDrawingQueueUI();
        return;
    }
    drawingUploadQueue[index].name = trimmedName.slice(0, 58);
    renderDrawingQueueUI();
}

/**
 * KIỂM TRA ĐỊNH DẠNG NGÀY THÁNG LỊCH THỰC TẾ (YYMMDD)
 */
function isValidYYMMDD(yyStr, mmStr, ddStr) {
    const yy = parseInt(yyStr, 10);
    const mm = parseInt(mmStr, 10);
    const dd = parseInt(ddStr, 10);
    
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    
    const year = 2000 + yy; // Quy ước chuẩn: năm 20YY
    const date = new Date(year, mm - 1, dd);
    
    // Kiểm tra xem ngày tháng lịch thực tế có bị tràn ngày (vd: 31/04 tự động nhảy sang 01/05) hay không
    return date.getFullYear() === year && date.getMonth() === (mm - 1) && date.getDate() === dd;
}

/**
 * HÀM CHUẨN HÓA KIỂM TRA ĐỊNH DẠNG TÊN BẢN VẼ (CHỐNG DƯ/THIẾU CÚ PHÁP CHẶT CHẼ)
 */
function validateDrawingFilename(fileName) {
    if (!fileName) return { isValid: false, fileType: "INVALID" };
    
    const trimmedName = fileName.trim();
    
    // 🚀 GIỚI HẠN ĐỘ DÀI: Tối đa 58 ký tự (bao gồm cả khoảng trắng)
    if (trimmedName.length > 58) {
        return { isValid: false, fileType: "INVALID" };
    }
    
    // Bắt buộc: Nếu người dùng cố tình nhập đuôi .pdf / .xlsx / .xls thì đánh dấu SAI TÊN (Báo màu đỏ)
    if (/\.(pdf|xlsx|xls)$/i.test(trimmedName)) {
        return { isValid: false, fileType: "INVALID" };
    }
    
    const parts = trimmedName.split("_");
    if (parts.length < 3) {
        return { isValid: false, fileType: "INVALID" };
    }
    
    // 1. Kiểm tra Ngày (Part 0: đúng 6 số YYMMDD và ngày lịch thực tế hợp lệ)
    const datePart = parts[0].trim();
    const dateMatch = datePart.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (!dateMatch) {
        return { isValid: false, fileType: "INVALID" };
    }
    const yy = dateMatch[1], mm = dateMatch[2], dd = dateMatch[3];
    if (!isValidYYMMDD(yy, mm, dd)) {
        return { isValid: false, fileType: "INVALID" };
    }
    
    // 2. Kiểm tra Mã Dự Án (Part 1: không được để trống)
    const projectCode = parts[1].trim();
    if (!projectCode || projectCode.length < 2) {
        return { isValid: false, fileType: "INVALID" };
    }
    
    // 3. Phân loại danh mục chặt chẽ dựa trên Token chính xác (Part 2)
    const cleanPart2 = removeVietnameseDiacritics(parts[2].trim());
    
    // A. PHIẾU ĐỀ XUẤT (PROPOSAL): Cú pháp YYMMDD_MãDA_PĐX_[Nội dung]
    const isProposalToken = /^(pdx|de xuat|proposal)$/.test(cleanPart2);
    if (isProposalToken) {
        const hasContent = parts.slice(3).join("_").trim().length > 0;
        if (hasContent) {
            return { isValid: true, fileType: "PROPOSAL" };
        }
        return { isValid: false, fileType: "INVALID" };
    }
    
    // B. BẢN VẼ CẬP NHẬT (UPDATE): Cú pháp YYMMDD_MãDA_Cập nhật [Nội dung] hoặc YYMMDD_MãDA_Cập nhật_[Nội dung]
    const updateMatch = cleanPart2.match(/^(cap nhat|update)(\s+.*)?$/);
    if (updateMatch) {
        const hasContentInPart2 = updateMatch[2] && updateMatch[2].trim().length > 0;
        const hasPart3 = parts.slice(3).join("_").trim().length > 0;
        if (hasContentInPart2 || hasPart3) {
            return { isValid: true, fileType: "UPDATE" };
        }
        return { isValid: false, fileType: "INVALID" };
    }
    
    // C. BẢN VẼ TKTC (ORIGINAL): Cú pháp YYMMDD_MãDA_BVTKTC_BộMôn_Phần [thân/hầm]
    const isOriginalToken = /^(bvtktc|tkbvtc|bo mon)$/.test(cleanPart2);
    if (isOriginalToken) {
        const hasDeptOrSection = parts.length >= 4 && parts[3].trim().length > 0;
        if (hasDeptOrSection) {
            return { isValid: true, fileType: "ORIGINAL" };
        }
        return { isValid: false, fileType: "INVALID" };
    }
    
    return { isValid: false, fileType: "INVALID" };
}

/**
 * KIỂM TRA XEM TÊN TỆP TIN ĐÃ TỒN TẠI TRÊN DRIVE DỰ ÁN NÀY CHƯA (DỰA TRÊN MINDMAP CHỦ THỂ)
 */
function checkIsDuplicateOnDrive(fileName) {
    const parts = fileName.split("_");
    if (parts.length < 2) return false;
    
    // Bóc tách mã dự án trực tiếp từ tên file sếp kéo vào
    const projectCode = parts[1].trim().toUpperCase();
    const filesList = projectFilesCache_Drawing[projectCode];
    
    // Nếu dự án này chưa có sẵn trong bộ nhớ tạm (Cache), kích hoạt tải ngầm ngay lập tức
    if (!filesList) {
        fetchProjectFilesSilently_Drawing(projectCode);
        return false;
    }
    
    // Hàm chuẩn hóa tiếng Việt dựng sẵn NFC và loại bỏ khoảng trắng thừa
    const cleanStr = (str) => {
        return (str || "")
            .normalize("NFC")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    };
    
    const upperName = cleanStr(fileName);
    
    // So khớp chéo trực tiếp trên danh sách tệp tin của dự án tương ứng
    const isDuplicate = filesList.some(f => {
        const originalDriveName = cleanStr(f.fileName);
        return originalDriveName === upperName;
    });
    
    console.log(`[Cross-Project Duplicate Check] Dự án: ${projectCode} | Tệp: "${fileName}" | Trùng: ${isDuplicate}`);
    return isDuplicate;
}

/**
 * TẢI NGẦM DANH SÁCH FILE CỦA DỰ ÁN CHỈ ĐỊNH ĐỂ KIỂM TRA CHÉO TRÙNG LẬP (SILENT BACKGROUND FETCH)
 */
function fetchProjectFilesSilently_Drawing(projectCode) {
    const code = projectCode.toUpperCase().trim();
    if (!code || projectFilesCache_Drawing[code] || pendingFetches_Drawing.has(code)) return;
    
    // Khóa luồng tạm thời để tránh sếp kéo nhiều file của cùng dự án gây spam gọi mạng
    pendingFetches_Drawing.add(code);
    
    // Gọi ngầm lên server quét thư mục Drive của dự án tương ứng
    callBackend("getMindmapData", code)
        .then(mindmapData => {
            pendingFetches_Drawing.delete(code);
            if (mindmapData && mindmapData.files) {
                // Lưu vào cache riêng của dự án
                projectFilesCache_Drawing[code] = mindmapData.files;
                
                // Vẽ lại giao diện hàng chờ để ngay lập tức hiển thị nhãn "Trùng tên"
                renderDrawingQueueUI();
            }
        })
        .catch(err => {
            pendingFetches_Drawing.delete(code);
            console.error(`[Silent Fetch] Không thể tải ngầm dữ liệu Drive cho dự án ${code}:`, err);
        });
}

/**
 * KIỂM TRA XEM DANH SÁCH HIỆN TẠI CÓ TRÙNG KHỚP HOÀN TOÀN VỚI BẢN SAO LƯU GỐC HAY KHÔNG
 */
function checkTasksUnchanged() {
    if (!drawingTaskSnapshot || !drawingTaskCache[currentFileId]) return true;
    
    const active = drawingTaskCache[currentFileId];
    const snap = drawingTaskSnapshot;
    
    if (active.length !== snap.length) return false;
    
    return active.every((t, i) => 
        t.taskId === snap[i].taskId && 
        t.team === snap[i].team &&
        t.description.trim() === snap[i].description.trim()
    );
}