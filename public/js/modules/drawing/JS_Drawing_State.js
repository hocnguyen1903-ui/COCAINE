// =========================================================================
// MODULE: DRAWING 1/4 - STATE, PROJECT SEARCH, MODULE INIT & CATEGORY SEARCH
// =========================================================================

(() => {
  const BD = (window.__BconsDrawing = window.__BconsDrawing || {});

  // 1. Huy hiệu Ghim ĐÃ GHIM (viền xanh lá) & CHƯA GHIM (viền vàng mờ)
  const PIN_ACTIVE_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="14" fill="#021a31" stroke="#2ECC71" stroke-width="2"/>
  <g transform="translate(9.6, 9.8) scale(1.05)" fill="#2ECC71">
    <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
  </g>
</svg>
`.trim());

  const PIN_DIM_SVG = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="14" fill="#021a31" stroke="#FFBA08" stroke-width="2"/>
  <g transform="translate(9.6, 9.8) scale(1.05)" fill="rgba(255, 186, 8, 0.3)">
    <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146z"/>
  </g>
</svg>
`.trim());

  BD.const = {
    PIN_ACTIVE_SVG,
    PIN_DIM_SVG
  };

  // 2. State dùng chung (khởi tạo trước khi đọc localStorage để tránh lỗi TDZ)
  const S = (BD.state = {
    cyInstance: null,
    selectedProjectDrawing: "",
    currentlyRenderedProject: "",
    activeDrawingProjects: [],
    isDrawingListLoaded: false,
    currentFileId: "",
    drawingTaskCache: {},
    drawingTaskSnapshot: null,
    saveOrderTimer: null,
    syncCountdownInterval: null,
    draggedElement: null,
    drawingUploadQueue: [],
    isUploading_Drawing: false,
    projectFilesCache_Drawing: {},
    projectFullDataCache_Drawing: {},
    pendingFetches_Drawing: new Set(),
    activeAiFiles: new Set(),
    pinnedDrawingNodes: new Set(),
    fileIdToEdit_Drawing: "",
    fileExtToEdit_Drawing: ".pdf",
    fileIdToDelete_Drawing: "",
    originalTaskIndex: -1,
    originalTaskContainer: null,
    isDropCommitted: false
  });

  try {
    const bootTok = localStorage.getItem("bcons_session_token");
    if (bootTok && bootTok.startsWith("BCONS2.")) {
      const cachedProjects = localStorage.getItem("bcons_cached_drawing_projects");
      if (cachedProjects) {
        S.activeDrawingProjects = JSON.parse(cachedProjects) || [];
        if (S.activeDrawingProjects.length > 0) {
          S.isDrawingListLoaded = true;
        }
      }
    }
  } catch (e) {
    console.warn("Lỗi đọc cache dự án Drawing:", e);
  }

  try {
    const cachedPinned = localStorage.getItem("bcons_pinned_drawing_nodes");
    if (cachedPinned) S.pinnedDrawingNodes = new Set(JSON.parse(cachedPinned));
  } catch (e) {}

  function syncDrawingButtonState() {
    const syncBtn = document.getElementById("btn-sync-drawing");
    if (syncBtn) syncBtn.disabled = !S.selectedProjectDrawing;
  }
  BD.syncDrawingButtonState = syncDrawingButtonState;

  // =========================================================================
  // KHỞI CHẠY MODULE & QUẢN LÝ DỰ ÁN
  // =========================================================================
  function loadDrawingModule() {
    syncDrawingButtonState();
    if (!S.isDrawingListLoaded) fetchActiveProjectsForDrawing();

    setTimeout(() => {
      if (typeof window.initDrawingUploadZone === "function") {
        window.initDrawingUploadZone();
      }
    }, 100);

    if (S.selectedProjectDrawing) {
      if (S.cyInstance && S.selectedProjectDrawing === S.currentlyRenderedProject) {
        setTimeout(() => {
          S.cyInstance.resize();
          S.cyInstance.fit(null, 20);
        }, 300);
      } else {
        BD.mindmap.renderMindmap(S.selectedProjectDrawing);
      }
    } else {
      const cyArea = document.getElementById("cy");
      if (cyArea && (cyArea.innerHTML.trim() === "" || cyArea.querySelector(".existing-file-wrapper") === null)) {
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

  function fetchActiveProjectsForDrawing(forceRefresh = false) {
    const sessionTok = localStorage.getItem("bcons_session_token");
    if (!sessionTok || !sessionTok.startsWith("BCONS2.")) return;

    const input = document.getElementById("drawing-project-search");
    const syncBtnIcon = document.querySelector("#btn-sync-drawing i");

    if (forceRefresh && syncBtnIcon) {
      syncBtnIcon.classList.add("spinning");
    }

    if (input) {
      input.disabled = false;
      input.placeholder = "Project";
    }

    callBackend("getActiveProjectFolders_Backend").then(folderNames => {
      if (folderNames && Array.isArray(folderNames) && folderNames.length > 0) {
        S.activeDrawingProjects = folderNames;
        S.isDrawingListLoaded = true;
        localStorage.setItem("bcons_cached_drawing_projects", JSON.stringify(folderNames));
      }
      if (syncBtnIcon) syncBtnIcon.classList.remove("spinning");
    }).catch(err => {
      console.error("Lỗi cập nhật ngầm danh sách dự án Drawing:", err);
      if (syncBtnIcon) syncBtnIcon.classList.remove("spinning");
    });
  }

  function filterProject_Drawing(input) {
    const drop = document.getElementById("drawing-project-drop");
    const query = input.value.toLowerCase().trim();
    const sharedStyle = "text-align:center; justify-content:center; color:rgba(255, 255, 255, 0.8); font-size:14px; font-style:italic; font-weight:normal; text-transform:lowercase; width:100%;";

    if (S.activeDrawingProjects.length === 0) {
      drop.innerHTML = `<div class="hoc-tooltip disable-hover" style="${sharedStyle}">-- No projects available --</div>`;
      drop.classList.add("show");
      return;
    }

    const matched = [];
    const unmatched = [];

    S.activeDrawingProjects.forEach(name => {
      if (name.toLowerCase().includes(query)) matched.push(name);
      else unmatched.push(name);
    });

    if (query !== "" && matched.length === 0) {
      drop.innerHTML = `<div class="hoc-tooltip disable-hover" style="${sharedStyle}">Không có dữ liệu</div>`;
      drop.classList.add("show");
      return;
    }

    const fullSortedList = [...matched, ...unmatched];

    drop.innerHTML = fullSortedList.map((name, index) => {
      const isFirst = (index === 0);
      const itemClass = isFirst ? "hoc-tooltip drawing-first-item active" : "hoc-tooltip";
      const enterBadge = isFirst ? `<span class="drawing-enter-badge">↵ Enter</span>` : "";
      const safeName = typeof escapeStr === "function" ? escapeStr(name) : name;

      return `<div class="${itemClass}" onmousedown="selectProject_Drawing('${safeName}'); event.preventDefault();">
                <span class="dd-label" style="text-align: left; width: 100%;">${name}</span>
                ${enterBadge}
              </div>`;
    }).join("");
    drop.classList.add("show");
  }

  function selectFirstProject_Drawing() {
    const drop = document.getElementById("drawing-project-drop");
    const firstItem = drop.querySelector(".hoc-tooltip:not(.disable-hover)");
    if (firstItem) {
      const name = firstItem.querySelector(".dd-label").textContent;
      selectProject_Drawing(name);
    }
  }

  async function selectProject_Drawing(projectName) {
    S.currentlyRenderedProject = "";
    S.selectedProjectDrawing = projectName;
    syncDrawingButtonState();
    const input = document.getElementById("drawing-project-search");
    const searchInput = document.getElementById("drawing-category-search");
    if (input) input.value = projectName;
    if (searchInput) searchInput.value = "";
    document.getElementById("drawing-project-drop").classList.remove("show");
    document.getElementById("dp-empty-state").style.display = "flex";
    document.getElementById("dp-content-state").style.display = "none";

    setTimeout(() => {
      if (typeof window.initDrawingUploadZone === "function") {
        window.initDrawingUploadZone();
      }
    }, 200);

    const localLoader = document.getElementById("drawing-local-loader");
    if (localLoader) localLoader.style.display = "flex";

    try {
      if (typeof isDrawingLibsLoaded !== "undefined" && !isDrawingLibsLoaded) {
        const textEl = localLoader ? localLoader.querySelector(".loader-text") : null;
        if (textEl) textEl.textContent = "DOWNLOADING LIBRARIES...";

        await lazyLoadDrawingLibs();

        if (textEl) textEl.textContent = "MINDMAP GENERATING";
      }

      BD.mindmap.renderMindmap(projectName);
    } catch (e) {
      showToast_PL("⚠️ Lỗi tải thư viện sơ đồ. Vui lòng kiểm tra mạng!", "error");
      if (localLoader) localLoader.style.display = "none";
    }
  }

  function closeFileDetail() {
    document.getElementById("dp-empty-state").style.display = "flex";
    document.getElementById("dp-content-state").style.display = "none";
    S.currentFileId = "";

    if (S.cyInstance) S.cyInstance.$(":selected").unselect();
  }

  // =========================================================================
  // TÌM KIẾM HẠNG MỤC XUYÊN DỰ ÁN & ĐỒNG BỘ THỦ CÔNG
  // =========================================================================
  function executeCategorySearch(query) {
    if (!S.selectedProjectDrawing || !query.trim() || !S.cyInstance) return;

    const keywords = query.toLowerCase().trim().split(/\s+/).filter(k => k.length > 0);
    const searchInput = document.getElementById("drawing-category-search");
    const searchIcon = document.getElementById("drawing-search-icon");

    searchInput.style.opacity = "0.5";
    searchInput.disabled = true;
    if (searchIcon) {
      if (searchIcon.dataset.originalColor === undefined) {
        searchIcon.dataset.originalColor = searchIcon.style.color || "";
      }
      searchIcon.style.color = "#00fbff";
      searchIcon.classList.add("icon-flashing-centered");
    }

    callBackend("getAllTasksByProject", S.selectedProjectDrawing)
      .then(projectTasks => {
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
        S.cyInstance.nodes().forEach(node => {
          if (matchingFileIds.has(node.data("fileId"))) {
            BD.mindmap.flashNode_Drawing(node);
            foundCount++;
          }
        });
        showToast_PL(`Đã tìm thấy ${foundCount} mục!`, "success");
      })
      .catch(err => {
        searchInput.style.opacity = "1";
        searchInput.disabled = false;
        if (searchIcon) {
          searchIcon.style.color = searchIcon.dataset.originalColor;
          searchIcon.classList.remove("icon-flashing-centered");
        }
        alert("Lỗi server: " + (err.message || err));
      });
  }

  function syncManual() {
    if (!S.selectedProjectDrawing) return;
    fetchActiveProjectsForDrawing(true);

    delete S.projectFullDataCache_Drawing[S.selectedProjectDrawing.toUpperCase()];
    const localLoader = document.getElementById("drawing-local-loader");
    if (localLoader) localLoader.style.display = "flex";
    S.drawingTaskCache = {};
    S.currentlyRenderedProject = "";
    BD.mindmap.renderMindmap(S.selectedProjectDrawing, true);
  }

  function resetMindmapView() {
    if (S.cyInstance) S.cyInstance.animate({ fit: { padding: 20 }, duration: 400 });
  }

  window.loadDrawingModule = loadDrawingModule;
  window.fetchActiveProjectsForDrawing = fetchActiveProjectsForDrawing;
  window.filterProject_Drawing = filterProject_Drawing;
  window.selectFirstProject_Drawing = selectFirstProject_Drawing;
  window.selectProject_Drawing = selectProject_Drawing;
  window.closeFileDetail = closeFileDetail;
  window.executeCategorySearch = executeCategorySearch;
  window.syncManual = syncManual;
  window.resetMindmapView = resetMindmapView;
})();