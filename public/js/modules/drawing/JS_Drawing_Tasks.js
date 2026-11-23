// =========================================================================
// MODULE: DRAWING 4/4 - FILE PANEL, RENAME/DELETE, XD/MEP TASKS & GEMINI AI
// =========================================================================

(() => {
  const BD = window.__BconsDrawing;
  const S = BD.state;

  // =========================================================================
  // PANEL CHI TIẾT NODE + RENAME / DELETE BẢN VẼ
  // =========================================================================
  function updatePanelContent(nodeData) {
    S.currentFileId = nodeData.fileId;
    document.getElementById("dp-empty-state").style.display = "none";
    document.getElementById("dp-content-state").style.display = "flex";

    const fileNameWithExt = (nodeData.fullName || nodeData.label || "").split("\n").pop();
    const fileNameClean = fileNameWithExt.replace(/\.(pdf|xlsx|xls)$/i, "");

    let aiZoneHTML = "";
    const isProcessable = (nodeData.type === "UPDATE" || nodeData.type === "PROPOSAL");
    const isCurrentlyExtracting = S.activeAiFiles.has(nodeData.fileId);

    if (isProcessable) {
      const activeClass = isCurrentlyExtracting ? "ai-extracting-active" : "";
      const titleText = isCurrentlyExtracting ? "AI DATA ANALYSIS IN PROGRESS" : "AI DATA EXTRACTION";
      const titleColor = isCurrentlyExtracting ? "#00BCD4" : "#FFFFFF";
      const subText = isCurrentlyExtracting ? "Vui lòng chờ trong giây lát ..." : "Chọn để trích xuất nội dung tự động";

      aiZoneHTML = `
        <div id="ai-paste-zone" class="ai-command-button ${activeClass}" onclick="extractFromCurrentSelected()">
          <div class="ai-icon-frame">
            <i class="bi bi-robot" id="ai-robot-icon" style="font-size: 24px; color: #00BCD4; transition: all 0.3s;"></i>
          </div>
          <div class="ai-command-text-wrapper">
            <div id="ai-main-msg" style="font-size: 11.5px; color: ${titleColor}; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;">${titleText}</div>
            <div id="ai-sub-msg" style="font-size: 10px; color: #95A1AF; margin-top: 4px; font-style: italic; letter-spacing: 0.2px;">${subText}</div>
          </div>
        </div>`;
    } else {
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

    document.getElementById("dp-file-list").innerHTML = `
      <div class="existing-file-wrapper" style="padding-right: 5px !important;">
        <div class="existing-file-info" onclick="window.open('${nodeData.url}', '_blank')" style="flex:1; overflow:hidden; display:flex; align-items:center;">
          <i class="bi bi-file-earmark-pdf-fill file-pdf" style="margin-right:10px"></i>
          <span class="file-name-text" style="color:#FFBA08 !important; font-size:12px; font-weight:700;">${fileNameClean}</span>
        </div>

        <div class="existing-file-action" style="width: 32px; display: flex; align-items: center; justify-content: center; position: relative;">
          <button type="button" class="btn-icon-edit" onclick="triggerEditDrawing_Client('${nodeData.fileId}', '${escapeStr(nodeData.fullName || fileNameWithExt)}')">
            <i class="bi bi-pencil-square"></i>
          </button>
          <div class="trash-note-pop" style="bottom: -30px !important;">Rename</div>
        </div>
        <div class="existing-file-action" style="width: 32px; display: flex; align-items: center; justify-content: center; position: relative;">
          <button type="button" class="btn-icon-delete" onclick="triggerDeleteDrawing_Client('${nodeData.fileId}', '${escapeStr(nodeData.fullName || fileNameWithExt)}')">
            <i class="bi bi-trash3"></i>
          </button>
          <div class="trash-note-pop note-remove-red" style="bottom: -30px !important;">Delete</div>
        </div>
        <div style="width: 1px; height: 24px; background: rgba(255, 255, 255, 0.12); align-self: center; margin: 0 4px; flex-shrink: 0;"></div>
        <div class="existing-file-action" style="width: 32px; display: flex; align-items: center; justify-content: center; position: relative; margin-right: 5px;">
          <button type="button" class="btn-close-x" onclick="closeFileDetail()" title="Đóng">
            <i class="bi bi-x-lg"></i>
          </button>
          <div class="trash-note-pop note-close-grey" style="bottom: -30px !important;">Close</div>
        </div>
      </div>
      ${aiZoneHTML}`;

    const confirmDeleteBtn = document.getElementById("confirmDeleteDrawingBtn");
    if (confirmDeleteBtn) confirmDeleteBtn.onclick = executeActualDeleteDrawing_Client;

    const confirmEditBtn = document.getElementById("confirmEditDrawingBtn");
    if (confirmEditBtn) confirmEditBtn.onclick = executeActualEditDrawing_Client;

    const taskListContainer = document.getElementById("dp-task-list");
    if (isProcessable) {
      renderTaskList_Drawing(S.currentFileId);
      const addBtn = document.querySelector('button[onclick="addNewTaskItem()"]');
      if (addBtn) addBtn.style.display = "block";
    } else {
      taskListContainer.innerHTML = `<div class="empty-msg" style="color:#505966; font-size:11px; font-style:italic; padding:15px; text-align:center;">Không có dữ liệu trích xuất từ bản vẽ thiết kế thi công.</div>`;
      const addBtn = document.querySelector('button[onclick="addNewTaskItem()"]');
      if (addBtn) addBtn.style.display = "none";
    }
  }

  function triggerEditDrawing_Client(fileId, fileName) {
    S.fileIdToEdit_Drawing = fileId;
    const overlay = document.getElementById("drawing-edit-confirm-overlay");
    const dialog = overlay ? overlay.querySelector(".scan-delete-dialog") : null;
    const input = document.getElementById("drawing-edit-input-val");
    if (overlay && input) {
      const extMatch = fileName.match(/\.(pdf|xlsx|xls)$/i);
      S.fileExtToEdit_Drawing = extMatch ? extMatch[0] : ".pdf";

      input.value = fileName.replace(/\.(pdf|xlsx|xls)$/i, "").trim();
      input.setAttribute("maxlength", "58");
      input.oninput = function() {
        if (this.value.length > 58) this.value = this.value.slice(0, 58);
      };

      overlay.style.display = "flex";
      setTimeout(() => {
        overlay.style.opacity = "1";
        if (dialog) dialog.style.transform = "scale(1)";
        input.focus();
        input.select();
      }, 10);
    }
  }

  function cancelEditDrawing_Client() {
    const overlay = document.getElementById("drawing-edit-confirm-overlay");
    const dialog = overlay ? overlay.querySelector(".scan-delete-dialog") : null;
    if (overlay) {
      overlay.style.opacity = "0";
      if (dialog) dialog.style.transform = "scale(0.9)";
      setTimeout(() => { overlay.style.display = "none"; }, 200);
    }
  }

  function executeActualEditDrawing_Client() {
    if (!S.fileIdToEdit_Drawing) return;
    const rawVal = document.getElementById("drawing-edit-input-val").value.trim();
    if (!rawVal) return alert("Sếp phải nhập tên file bản vẽ hợp lệ!");

    if (rawVal.length > 58) {
      showToast_PL(`⚠️ Tên file tối đa 58 ký tự (Hiện tại: ${rawVal.length} ký tự)!`, "error");
      return;
    }

    if (/\.(pdf|xlsx|xls)$/i.test(rawVal)) {
      showToast_PL("⚠️ Không nhập đuôi .pdf vào tên file!", "error");
      return;
    }

    const { isValid, fileType: newFileType } = BD.upload.validateDrawingFilename(rawVal);
    if (!isValid) {
      showToast_PL("⚠️ Tên file không đúng cú pháp quy định!", "error");
      return;
    }

    const newVal = rawVal + S.fileExtToEdit_Drawing;
    const targetFileId = S.fileIdToEdit_Drawing;
    const projKey = (S.selectedProjectDrawing || "").toUpperCase().trim();
    S.fileIdToEdit_Drawing = "";

    cancelEditDrawing_Client();

    let originalLabel = "";
    let originalFullName = "";
    let originalType = "";
    let originalDatePart = "";
    let nodeToEdit = null;

    if (S.cyInstance) {
      nodeToEdit = S.cyInstance.getElementById(targetFileId);
      if (nodeToEdit.length > 0) {
        originalLabel = nodeToEdit.data("label");
        originalFullName = nodeToEdit.data("fullName");
        originalType = nodeToEdit.data("type");
        originalDatePart = (originalFullName || "").split("_")[0];

        let namePart = rawVal;
        const projectCode = S.selectedProjectDrawing.toString();

        const patterns = [
          new RegExp(projectCode, "gi"),
          /PĐX/gi, /BVTKTC/gi, /TKBVTC/gi, /STR/gi, /ARC/gi, /MEP/gi, /\d{6}/g
        ];

        patterns.forEach(p => { namePart = namePart.replace(p, ""); });
        let cleanName = namePart.replace(/_+/g, "_").replace(/\s+/g, " ").replace(/^[_ \s]+|[_ \s]+$/g, "");
        const smartName = cleanName ? cleanName : rawVal;

        nodeToEdit.data("label", smartName);
        nodeToEdit.data("fullName", newVal);
        nodeToEdit.data("type", newFileType);

        if (S.projectFullDataCache_Drawing[projKey] && S.projectFullDataCache_Drawing[projKey].files) {
          const targetFileCache = S.projectFullDataCache_Drawing[projKey].files.find(f => f.fileId === targetFileId);
          if (targetFileCache) {
            targetFileCache.fileName = newVal;
            targetFileCache.type = newFileType;
          }
        }
        if (S.projectFilesCache_Drawing[projKey]) {
          const targetFileCache2 = S.projectFilesCache_Drawing[projKey].find(f => f.fileId === targetFileId);
          if (targetFileCache2) {
            targetFileCache2.fileName = newVal;
            targetFileCache2.type = newFileType;
          }
        }

        window.closeFileDetail();
      }
    }

    showToast_PL("✏️ Đã đổi tên bản vẽ thành công!", "success");

    const newDatePart = rawVal.split("_")[0];
    const isStructureChanged = (originalType && newFileType && originalType !== newFileType) ||
                               (originalDatePart && newDatePart && originalDatePart !== newDatePart);

    callBackend("renameAndRouteDrawingFile_Backend", { fileId: targetFileId, newFileName: newVal })
      .then(res => {
        if (res && isStructureChanged && S.selectedProjectDrawing) {
          delete S.projectFullDataCache_Drawing[projKey];
          BD.mindmap.renderMindmap(S.selectedProjectDrawing, true);
        }
      })
      .catch(err => {
        console.error("Lỗi đổi tên tệp ngầm:", err);
        showToast_PL("⚠️ Lỗi mạng! Không thể sửa tên trên Drive, đang khôi phục...", "error");
        if (nodeToEdit && nodeToEdit.length > 0) {
          nodeToEdit.data("label", originalLabel);
          nodeToEdit.data("fullName", originalFullName);
          nodeToEdit.data("type", originalType);
        }
        delete S.projectFullDataCache_Drawing[projKey];
        if (S.selectedProjectDrawing) {
          BD.mindmap.renderMindmap(S.selectedProjectDrawing, true);
        }
      });
  }

  function triggerDeleteDrawing_Client(fileId, fileName) {
    S.fileIdToDelete_Drawing = fileId;
    const overlay = document.getElementById("drawing-delete-confirm-overlay");
    const dialog = overlay ? overlay.querySelector(".scan-delete-dialog") : null;
    const nameDisplay = document.getElementById("delete-drawing-filename");

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
    const overlay = document.getElementById("drawing-delete-confirm-overlay");
    const dialog = overlay ? overlay.querySelector(".scan-delete-dialog") : null;
    if (overlay) {
      overlay.style.opacity = "0";
      if (dialog) dialog.style.transform = "scale(0.9)";
      setTimeout(() => { overlay.style.display = "none"; }, 200);
    }
  }

  function executeActualDeleteDrawing_Client() {
    if (!S.fileIdToDelete_Drawing) return;

    const targetFileId = S.fileIdToDelete_Drawing;
    S.fileIdToDelete_Drawing = "";

    cancelDeleteDrawing_Client();

    const cy = S.cyInstance;
    if (cy) {
      const nodeToDelete = cy.getElementById(targetFileId);
      if (nodeToDelete.length > 0) {
        window.closeFileDetail();

        cy.nodes().forEach(n => n.scratch("startPos", { ...n.position() }));
        const startZoom = cy.zoom();
        const startPan = { ...cy.pan() };

        BD.mindmap.removeEmptyParents_Drawing(nodeToDelete);

        cy.layout({
          name: "dagre",
          rankDir: "LR",
          nodeSep: 45,
          rankSep: 80,
          animate: false,
          fit: false,
          padding: 20,
          sort: (a, b) => {
            const getPri = (n) => {
              if (n.id() === "root") return 1;
              if (["branch_goc", "branch_update", "branch_proposal"].includes(n.id())) return 2;
              if (n.data("isDate")) return 3;
              if (n.id().includes("_Thân") || n.id().includes("_Hầm")) return 4;
              if (n.data("isDept")) return 5;
              return 6;
            };
            const pA = getPri(a);
            const pB = getPri(b);
            if (pA !== pB) return pA - pB;

            const svA = a.data("sortValue") || 0;
            const svB = b.data("sortValue") || 0;
            if (svA !== svB) return svB - svA;

            const nameA = a.data("fullName") || a.data("label") || "";
            const nameB = b.data("fullName") || b.data("label") || "";
            return nameB.localeCompare(nameA, "vi", { numeric: true, sensitivity: "base" });
          },
          stop: () => {
            BD.mindmap.enforceBidirectionalLayout();

            const endPositions = new Map();
            cy.nodes().forEach(n => endPositions.set(n.id(), { ...n.position() }));

            cy.fit(null, 20);
            const targetZoom = cy.zoom();
            const targetPan = { ...cy.pan() };

            cy.zoom(startZoom);
            cy.pan(startPan);
            cy.nodes().forEach(n => {
              const startPos = n.scratch("startPos");
              if (startPos) n.position(startPos);
            });

            cy.nodes().forEach(n => {
              n.animate({
                position: endPositions.get(n.id()),
                duration: 350,
                easing: "ease-out-cubic"
              });
            });

            cy.animate({
              zoom: targetZoom,
              pan: targetPan,
              duration: 350,
              easing: "ease-out-cubic"
            });
          }
        }).run();
      }
    }

    showToast_PL("🗑️ Đã xóa bản vẽ thành công!", "success");

    callBackend("deleteDrawingFileAndTasks_Backend", targetFileId)
      .catch(err => {
        console.error("Lỗi xóa tệp ngầm:", err);
        showToast_PL("⚠️ Không thể xóa bản vẽ trên Drive! Đang đồng bộ lại sơ đồ...", "error");
        if (S.selectedProjectDrawing) {
          BD.mindmap.renderMindmap(S.selectedProjectDrawing);
        }
      });
  }

  // =========================================================================
  // HIỂN THỊ & QUẢN LÝ TASK XD / MEP + KÉO THẢ SẮP XẾP
  // =========================================================================
  function renderTaskList_Drawing(id) {
    const container = document.getElementById("dp-task-list");
    if (S.drawingTaskCache[id]) {
      displayTasksHTML(S.drawingTaskCache[id]);
      S.drawingTaskSnapshot = JSON.parse(JSON.stringify(S.drawingTaskCache[id]));
      return;
    }
    container.innerHTML = `<div style="color:#95A1AF; font-size:11px; padding:10px;">Loading...</div>`;
    callBackend("getTasksByFileId", id).then(tasks => {
      S.drawingTaskCache[id] = tasks;
      S.drawingTaskSnapshot = JSON.parse(JSON.stringify(tasks));
      displayTasksHTML(tasks);
    }).catch(() => {
      container.innerHTML = `<div style="color:red; font-size:11px; padding:10px;">Lỗi tải dữ liệu</div>`;
    });
  }

  function displayTasksHTML(tasks) {
    const container = document.getElementById("dp-task-list");
    const xd = tasks.filter(t => t.team === "XD"), mep = tasks.filter(t => t.team === "MEP");
    container.innerHTML = `
      <div class="group-label" style="color:#FFBA08; font-size:13px;"><i class="bi bi-bricks" style="margin-right:6px;"></i> Xây dựng </div>
      <div id="drop-zone-XD" class="task-group-container"
           ondragenter="handleDragEnterZone(event)"
           ondragover="allowDrop(event)"
           ondragleave="handleDragLeaveZone(event)"
           ondrop="handleDrop(event, 'XD')">${renderGroupItems(xd)}</div>
      <div class="group-label" style="color:#00BCD4; margin-top:15px; font-size:13px;"><i class="bi bi-lightning-charge" style="margin-right:6px;"></i> Cơ điện </div>
      <div id="drop-zone-MEP" class="task-group-container"
           ondragenter="handleDragEnterZone(event)"
           ondragover="allowDrop(event)"
           ondragleave="handleDragLeaveZone(event)"
           ondrop="handleDrop(event, 'MEP')">${renderGroupItems(mep)}</div>`;
  }

  function renderGroupItems(items) {
    if (!items || items.length === 0) {
      return `<div class="empty-msg" style="color:#505966; font-size:11px; font-style:italic; height:38px; display:flex; align-items:center; justify-content:center; padding:0; margin:0;">Không có dữ liệu ...</div>`;
    }

    return items.map(t => `
      <div class="task-item" draggable="false" ondragstart="handleDragStart(event)" ondragend="handleDragEnd(event)" id="task-${t.taskId}">
        <div class="drag-handle" onmousedown="this.parentElement.setAttribute('draggable', 'true')">
          <i class="bi bi-grip-vertical"></i>
        </div>
        <input type="text" class="task-desc-edit" value="${t.description || ""}"
               onfocus="this.parentElement.setAttribute('draggable', 'false')"
               onblur="updateTaskDescInline('${t.taskId}', this.value)"
               onkeydown="if(event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); this.blur(); }">
        <i class="bi bi-trash3-fill" style="color:#ff4d4d; cursor:pointer; font-size:14px; opacity:0.5; transition: opacity 0.2s;"
           onmouseover="this.style.opacity='1'"
           onmouseout="this.style.opacity='0.5'"
           onclick="deleteTask_Drawing('${t.taskId}')"></i>
      </div>`
    ).join("");
  }

  function handleDragStart(e) {
    S.draggedElement = e.currentTarget;
    S.isDropCommitted = false;

    S.originalTaskContainer = S.draggedElement.parentElement;
    const siblings = Array.from(S.originalTaskContainer.querySelectorAll(".task-item"));
    S.originalTaskIndex = siblings.indexOf(S.draggedElement);

    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", S.draggedElement.id);

    try {
      const scaleY = 0.85;
      const rect = S.draggedElement.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      const wrapper = document.createElement("div");
      wrapper.style.position = "fixed";
      wrapper.style.top = "-9999px";
      wrapper.style.left = "-9999px";
      wrapper.style.width = w + "px";
      wrapper.style.height = (h * scaleY) + "px";
      wrapper.style.pointerEvents = "none";
      wrapper.style.opacity = "1";

      const ghost = S.draggedElement.cloneNode(true);
      ghost.classList.remove("is-dragging");

      const ghostInput = ghost.querySelector("input");
      const origInput = S.draggedElement.querySelector("input");
      if (ghostInput && origInput) ghostInput.value = origInput.value;

      ghost.style.width = w + "px";
      ghost.style.height = h + "px";
      ghost.style.margin = "0";
      ghost.style.background = "#546375";
      ghost.style.opacity = "1";
      ghost.style.border = "1px solid rgba(255, 255, 255, 0.25)";
      ghost.style.borderRadius = "6px";
      ghost.style.boxShadow = "0 12px 28px rgba(0, 0, 0, 0.85)";
      ghost.style.transform = `scaleY(${scaleY})`;
      ghost.style.transformOrigin = "0 0";

      wrapper.appendChild(ghost);
      document.body.appendChild(wrapper);

      const clickX = e.clientX ? (e.clientX - rect.left) : 16;
      const clickY = e.clientY ? (e.clientY - rect.top) : (h / 2);
      e.dataTransfer.setDragImage(wrapper, Math.max(14, clickX), clickY * scaleY);

      setTimeout(() => wrapper.remove(), 0);
    } catch (err) {
      console.warn("Lỗi drag image:", err);
    }

    setTimeout(() => {
      if (S.draggedElement) S.draggedElement.classList.add("is-dragging");
    }, 0);
  }

  function allowDrop(e) {
    e.preventDefault();
    if (!S.draggedElement) return;
    e.dataTransfer.dropEffect = "move";

    const container = e.currentTarget;
    container.classList.add("drag-over-active");

    const draggingOverItem = e.target.closest("#dp-task-list .task-item");

    if (draggingOverItem && draggingOverItem !== S.draggedElement) {
      const isDraggingDown = !!(S.draggedElement.compareDocumentPosition(draggingOverItem) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (isDraggingDown) draggingOverItem.after(S.draggedElement);
      else draggingOverItem.before(S.draggedElement);
    } else if (container && !container.contains(S.draggedElement)) {
      const emptyMsg = container.querySelector(".empty-msg");
      if (emptyMsg) emptyMsg.before(S.draggedElement);
      else container.appendChild(S.draggedElement);
    }

    document.querySelectorAll("#dp-task-list .task-group-container").forEach(group => {
      const taskCount = group.querySelectorAll(".task-item").length;
      const emptyMsg = group.querySelector(".empty-msg");
      if (emptyMsg) emptyMsg.style.display = taskCount > 0 ? "none" : "flex";
    });
  }

  function finalizeTaskReorder(isCanceled = false) {
    document.querySelectorAll("#dp-task-list .task-group-container").forEach(c => {
      c.classList.remove("drag-over-active");
    });

    if (!S.draggedElement) return;

    if (isCanceled && S.originalTaskContainer) {
      const siblings = Array.from(S.originalTaskContainer.querySelectorAll(".task-item")).filter(el => el !== S.draggedElement);
      if (S.originalTaskIndex >= 0 && S.originalTaskIndex < siblings.length) {
        siblings[S.originalTaskIndex].before(S.draggedElement);
      } else {
        S.originalTaskContainer.appendChild(S.draggedElement);
      }
    }

    S.draggedElement.classList.remove("is-dragging");
    S.draggedElement.setAttribute("draggable", "false");
    S.draggedElement = null;
    S.originalTaskContainer = null;
    S.originalTaskIndex = -1;
    S.isDropCommitted = false;

    document.querySelectorAll("#dp-task-list .task-group-container").forEach(group => {
      const taskCount = group.querySelectorAll(".task-item").length;
      const emptyMsg = group.querySelector(".empty-msg");
      if (emptyMsg) emptyMsg.style.display = taskCount > 0 ? "none" : "flex";
    });

    if (isCanceled || !S.currentFileId || !S.drawingTaskCache[S.currentFileId]) return;

    if (!S.drawingTaskSnapshot) {
      S.drawingTaskSnapshot = JSON.parse(JSON.stringify(S.drawingTaskCache[S.currentFileId]));
    }

    const taskElements = Array.from(document.querySelectorAll("#dp-task-list .task-item"));
    const updatedTasks = taskElements.map(el => {
      const id = el.id.replace("task-", "");
      const oldData = S.drawingTaskCache[S.currentFileId].find(t => t.taskId === id) || {};
      const groupContainer = el.closest(".task-group-container");
      const teamCode = groupContainer ? groupContainer.id.replace("drop-zone-", "") : (oldData.team || "XD");
      return {
        taskId: id,
        description: el.querySelector(".task-desc-edit")?.value || oldData.description || "",
        team: teamCode
      };
    });

    const isUnchanged = updatedTasks.length === S.drawingTaskSnapshot.length &&
      updatedTasks.every((t, i) =>
        t.taskId === S.drawingTaskSnapshot[i].taskId &&
        t.team === S.drawingTaskSnapshot[i].team
      );

    if (isUnchanged) {
      if (S.saveOrderTimer) cancelDrawingSync();
      return;
    }

    S.drawingTaskCache[S.currentFileId] = updatedTasks;
    triggerDrawingSync_10s();
  }

  function handleDragEnterZone(e) {
    const zone = e.currentTarget;
    if (zone && zone.classList.contains("task-group-container")) {
      zone.classList.add("drag-over-active");
    }
  }

  function handleDragLeaveZone(e) {
    const zone = e.currentTarget;
    if (zone && !zone.contains(e.relatedTarget)) {
      zone.classList.remove("drag-over-active");
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    S.isDropCommitted = true;
    finalizeTaskReorder(false);
  }

  function handleDragEnd(e) {
    const isCanceled = !S.isDropCommitted || (e.dataTransfer && e.dataTransfer.dropEffect === "none");
    finalizeTaskReorder(isCanceled);
  }

  // =========================================================================
  // AUTO-SYNC 10S & THAO TÁC INLINE TRÊN TASK
  // =========================================================================
  function triggerDrawingSync_10s() {
    const statusBar = document.getElementById("sync-status-bar");
    const statusText = document.getElementById("sync-status-text");
    if (!statusBar || !statusText) return;

    clearInterval(S.syncCountdownInterval);
    clearTimeout(S.saveOrderTimer);

    let timeLeft = 10;
    statusBar.style.height = "32px";
    statusBar.style.marginBottom = "15px";
    statusBar.style.borderColor = "rgba(0, 188, 212, 0.3)";
    statusText.innerHTML = `Auto-sync in <b style="font-size: 12px; color: #fff;">${timeLeft}s</b>`;

    S.syncCountdownInterval = setInterval(() => {
      timeLeft--;
      if (timeLeft > 0) {
        statusText.innerHTML = `Auto-sync in <b style="font-size: 12px; color: #fff;">${timeLeft}s</b>`;
      } else {
        clearInterval(S.syncCountdownInterval);
        statusText.innerHTML = `<i class="bi bi-arrow-repeat rotation"></i> SAVING...`;
      }
    }, 1000);

    S.saveOrderTimer = setTimeout(() => {
      const finalTasks = (S.drawingTaskCache[S.currentFileId] || []).filter(t => (t.description || "").trim() !== "");

      callBackend("updateTasksOrderBackend", [S.selectedProjectDrawing, S.currentFileId, finalTasks])
        .then(() => {
          S.saveOrderTimer = null;
          S.drawingTaskCache[S.currentFileId] = finalTasks;
          S.drawingTaskSnapshot = JSON.parse(JSON.stringify(finalTasks));

          const projKey = (S.selectedProjectDrawing || "").toUpperCase().trim();
          if (S.projectFullDataCache_Drawing[projKey] && S.projectFullDataCache_Drawing[projKey].tasks) {
            S.projectFullDataCache_Drawing[projKey].tasks = S.projectFullDataCache_Drawing[projKey].tasks.filter(t => t.fileId !== S.currentFileId);
            S.projectFullDataCache_Drawing[projKey].tasks.push(...finalTasks.map(t => ({
              taskId: t.taskId,
              fileId: S.currentFileId,
              description: t.description,
              team: t.team
            })));
          }

          statusBar.style.height = "0";
          statusBar.style.marginBottom = "0";
          statusBar.style.borderColor = "transparent";
          displayTasksHTML(finalTasks);
          showToast_PL("🚀 Synced tasks successfully!", "success");
        })
        .catch(err => {
          console.error("Lỗi đồng bộ:", err);
          statusText.innerHTML = `<span style="color:#ff4d4d;">SYNC FAILED!</span>`;
        });
    }, 10000);
  }

  function syncDrawingImmediately() {
    clearInterval(S.syncCountdownInterval);
    clearTimeout(S.saveOrderTimer);
    S.saveOrderTimer = null;

    const statusBar = document.getElementById("sync-status-bar");
    const finalTasks = S.drawingTaskCache[S.currentFileId].filter(t => t.description.trim() !== "");

    callBackend("updateTasksOrderBackend", [S.selectedProjectDrawing, S.currentFileId, finalTasks])
      .then(() => {
        S.drawingTaskCache[S.currentFileId] = finalTasks;
        S.drawingTaskSnapshot = JSON.parse(JSON.stringify(finalTasks));
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
    clearInterval(S.syncCountdownInterval);
    clearTimeout(S.saveOrderTimer);
    S.saveOrderTimer = null;

    if (S.drawingTaskSnapshot) {
      S.drawingTaskCache[S.currentFileId] = JSON.parse(JSON.stringify(S.drawingTaskSnapshot));
      displayTasksHTML(S.drawingTaskCache[S.currentFileId]);
    }

    const statusBar = document.getElementById("sync-status-bar");
    if (statusBar) {
      statusBar.style.height = "0";
      statusBar.style.marginBottom = "0";
      statusBar.style.borderColor = "transparent";
    }
  }

  function addNewTaskItem() {
    if (!S.drawingTaskSnapshot) {
      S.drawingTaskSnapshot = JSON.parse(JSON.stringify(S.drawingTaskCache[S.currentFileId] || []));
    }

    const tempId = "T-" + Date.now();
    const newItem = { taskId: tempId, description: "", team: "XD" };

    if (!S.drawingTaskCache[S.currentFileId]) S.drawingTaskCache[S.currentFileId] = [];
    S.drawingTaskCache[S.currentFileId].push(newItem);

    displayTasksHTML(S.drawingTaskCache[S.currentFileId]);

    setTimeout(() => {
      const newInput = document.querySelector(`#task-${tempId} .task-desc-edit`);
      if (newInput) {
        newInput.focus();
        const scrollContainer = document.querySelector("#dp-content-state > div");
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const inputRect = newInput.getBoundingClientRect();
          const relativeTop = inputRect.top - containerRect.top + scrollContainer.scrollTop;

          scrollContainer.scrollTo({
            top: relativeTop - (containerRect.height / 2) + (inputRect.height / 2),
            behavior: "smooth"
          });
        }
      }
    }, 100);
  }

  function updateTaskDescInline(id, val) {
    const taskIndex = S.drawingTaskCache[S.currentFileId].findIndex(x => x.taskId === id);
    if (taskIndex === -1) return;

    const trimmedVal = val.trim();
    const isNewItem = id.startsWith("T-");

    if (!isNewItem && !S.drawingTaskSnapshot) {
      S.drawingTaskSnapshot = JSON.parse(JSON.stringify(S.drawingTaskCache[S.currentFileId] || []));
    }

    if (trimmedVal === "") {
      S.drawingTaskCache[S.currentFileId].splice(taskIndex, 1);
      displayTasksHTML(S.drawingTaskCache[S.currentFileId]);
      if (checkTasksUnchanged()) cancelDrawingSync();
      else triggerDrawingSync_10s();
    } else if (S.drawingTaskCache[S.currentFileId][taskIndex].description !== trimmedVal) {
      S.drawingTaskCache[S.currentFileId][taskIndex].description = trimmedVal;
      if (checkTasksUnchanged()) cancelDrawingSync();
      else triggerDrawingSync_10s();
    }
  }

  function deleteTask_Drawing(id) {
    const isNewItem = id.startsWith("T-");
    if (!isNewItem && !S.drawingTaskSnapshot) {
      S.drawingTaskSnapshot = JSON.parse(JSON.stringify(S.drawingTaskCache[S.currentFileId] || []));
    }

    S.drawingTaskCache[S.currentFileId] = S.drawingTaskCache[S.currentFileId].filter(x => x.taskId !== id);
    displayTasksHTML(S.drawingTaskCache[S.currentFileId]);

    if (checkTasksUnchanged()) cancelDrawingSync();
    else triggerDrawingSync_10s();
  }

  function checkTasksUnchanged() {
    if (!S.drawingTaskSnapshot || !S.drawingTaskCache[S.currentFileId]) return true;

    const active = S.drawingTaskCache[S.currentFileId];
    const snap = S.drawingTaskSnapshot;

    if (active.length !== snap.length) return false;

    return active.every((t, i) =>
      t.taskId === snap[i].taskId &&
      t.team === snap[i].team &&
      t.description.trim() === snap[i].description.trim()
    );
  }

  function isRenderedCanvasBlank(srcCanvas) {
    const sw = 80, sh = 110;
    const sample = document.createElement("canvas");
    sample.width = sw;
    sample.height = sh;
    const sCtx = sample.getContext("2d", { willReadFrequently: true });
    sCtx.drawImage(srcCanvas, 0, 0, sw, sh);
    const data = sCtx.getImageData(0, 0, sw, sh).data;

    let darkPixels = 0;
    const total = sw * sh;
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (gray < 185) darkPixels++;
    }
    sample.width = 0;
    sample.height = 0;
    return (darkPixels / total) * 100 < 0.1;
  }

  function countHorizontalGridLines(canvas) {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return 0;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const xProbes = [Math.floor(w * 0.35), Math.floor(w * 0.5), Math.floor(w * 0.65)];
    let maxLines = 0;

    for (const x of xProbes) {
      const startY = Math.floor(h * 0.15), endY = Math.floor(h * 0.85);
      const imgData = ctx.getImageData(x, startY, 1, endY - startY).data;
      let lines = 0, inLine = false;

      for (let i = 0; i < imgData.length; i += 4) {
        const isDark = (imgData[i] * 0.299 + imgData[i + 1] * 0.587 + imgData[i + 2] * 0.114) < 180;
        if (isDark && !inLine) { inLine = true; lines++; }
        else if (!isDark && inLine) { inLine = false; }
      }
      if (lines > maxLines) maxLines = lines;
    }
    return maxLines;
  }

  async function renderPdfPagesToImagesForAI(pdfSource, fileType = "UPDATE") {
    const pdf = await pdfjsLib.getDocument(pdfSource).promise;
    const images = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    // PĐX tối đa 3 trang văn bản hành chính; BVCN tối đa 8 trang danh mục
    const MAX_SAFE_PAGES = (fileType === "PROPOSAL") ? 3 : 8;

    try {
      for (let p = 1; p <= Math.min(MAX_SAFE_PAGES, pdf.numPages); p++) {
        const page = await pdf.getPage(p);

        // CHỐT CHẶN 0ms (Trang 1): Kiểm tra text vector nếu file có sẵn layer văn bản số
        if (p === 1) {
          try {
            const tc = await page.getTextContent();
            if (tc && tc.items && tc.items.length > 15) {
              const p1Text = tc.items.map(it => it.str || "").join(" ").toLowerCase();
              const p1Norm = typeof removeVietnameseDiacritics === "function" ? removeVietnameseDiacritics(p1Text) : p1Text;
              const isUpdateValid = p1Norm.includes("danh muc phan phoi");
              const isProposalValid = p1Norm.includes("phieu de xuat") || p1Norm.includes("de xuat") || p1Norm.includes("pdx");

              if (fileType === "UPDATE" && !isUpdateValid) {
                console.warn(`[AI Pipeline] Dừng ngay lập tức tại Trang 1: File không chứa tiêu đề Danh mục phân phối.`);
                page.cleanup();
                break;
              }
              if (fileType === "PROPOSAL" && !isProposalValid) {
                console.warn(`[AI Pipeline] Dừng ngay lập tức tại Trang 1: File không chứa tiêu đề Phiếu đề xuất.`);
                page.cleanup();
                break;
              }
            }
          } catch (probeErr) {}
        }

        const vp1 = page.getViewport({ scale: 1.0 });

        // CHỐT CHẶN 1 (0ms): Nếu gặp trang Khổ Ngang (A3/A2/A1 bản vẽ đính kèm) -> Dừng ngay lập tức!
        if (vp1.width > vp1.height) {
          console.log(`[AI Pipeline] Dừng quét tại Trang ${p}: Phát hiện bắt đầu sang trang Bản vẽ Khổ Ngang (${Math.round(vp1.width)}x${Math.round(vp1.height)}).`);
          page.cleanup();
          break;
        }

        const longSide = Math.max(vp1.width, vp1.height) || 842;
        const ocrScale = Math.min(1.8, 1400 / longSide);
        const viewport = page.getViewport({ scale: ocrScale });

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport: viewport, intent: "print" }).promise;
        page.cleanup();

        if (isRenderedCanvasBlank(canvas)) {
          continue;
        }

        // CHỐT CHẶN 2: Với BVCN, kiểm tra vạch kẻ bảng; với PĐX, bỏ qua kiểm tra vạch kẻ
        if (fileType === "UPDATE" && p > 1) {
          const gridLineCount = countHorizontalGridLines(canvas);
          if (gridLineCount < 6) {
            console.log(`[AI Pipeline] Dừng quét tại Trang ${p}: Không còn phát hiện lưới bảng biểu danh mục (Chỉ có ${gridLineCount} vạch kẻ).`);
            break;
          }
        }

        const b64 = canvas.toDataURL("image/jpeg", 0.72).replace(/^data:image\/\w+;base64,/, "");
        images.push(b64);
        console.log(`[AI Pipeline] -> Đã nhận diện Trang hợp lệ: Trang ${p} (${fileType})`);
      }
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      try { pdf.destroy(); } catch (e) {}
    }
    return images;
  }

  function updateAiButtonUI(fileId) {
    if (S.currentFileId !== fileId) return;

    const zone = document.getElementById("ai-paste-zone");
    const mainMsg = document.getElementById("ai-main-msg");
    const subMsg = document.getElementById("ai-sub-msg");
    if (!zone || !mainMsg || !subMsg) return;

    if (S.activeAiFiles.has(fileId)) {
      zone.classList.remove("ai-zone-alert");
      zone.classList.add("ai-extracting-active");
      mainMsg.style.color = "#00BCD4";
      mainMsg.textContent = "AI DATA ANALYSIS IN PROGRESS";
      subMsg.textContent = "Vui lòng chờ trong giây lát ...";
    } else {
      zone.classList.remove("ai-extracting-active", "ai-zone-alert");
      mainMsg.style.color = "#FFFFFF";
      mainMsg.textContent = "AI DATA EXTRACTION";
      subMsg.textContent = "Chọn để trích xuất nội dung tự động";
    }
  }

  function resetAIZoneUI() {
    if (S.currentFileId) updateAiButtonUI(S.currentFileId);
  }

  async function extractFromCurrentSelected(isConfirmed = false) {
    let targetFileId = S.currentFileId;
    let targetProjectCode = S.selectedProjectDrawing;
    if (!targetFileId || S.activeAiFiles.has(targetFileId)) return;

    let targetNode = S.cyInstance ? S.cyInstance.getElementById(targetFileId) : null;
    let fileType = (targetNode && targetNode.length > 0) ? targetNode.data("type") : "UPDATE";
    let targetFileName = (targetNode && targetNode.length > 0) ? (targetNode.data("fullName") || targetNode.data("label") || targetFileId) : targetFileId;
    let cleanFileName = targetFileName.replace(/\.(pdf|xlsx|xls)$/i, "");

    let hasExistingData = S.drawingTaskCache[targetFileId] && S.drawingTaskCache[targetFileId].length > 0;

    if (hasExistingData && !isConfirmed) {
      let zone = document.getElementById("ai-paste-zone");
      let mainMsg = document.getElementById("ai-main-msg");
      let subMsg = document.getElementById("ai-sub-msg");
      if (zone && mainMsg && subMsg) {
        zone.classList.add("ai-zone-alert");
        mainMsg.style.color = "#fff";
        mainMsg.textContent = "XÁC NHẬN GHI ĐÈ DỮ LIỆU?";
        subMsg.innerHTML = `<div style="margin-top:8px; display:flex; gap:10px; justify-content:center; pointer-events:auto;"><button onclick="event.stopPropagation(); extractFromCurrentSelected(true)" class="btn-danger-luxury" style="height:24px; padding:0 12px; font-size:9.5px; border-radius: 6px !important; border:none;">YES</button><button onclick="event.stopPropagation(); resetAIZoneUI()" class="btn-secondary-luxury" style="height:24px; padding:0 12px; font-size:9.5px; border-radius: 6px !important;">CANCEL</button></div>`;
      }
      return;
    }

    S.activeAiFiles.add(targetFileId);
    updateAiButtonUI(targetFileId);

    (async () => {
      let perfStart = performance.now();
      console.log(`%c[AI Pipeline] 🚀 BẮT ĐẦU: "${cleanFileName}" (${fileType})`, "color: #00BCD4; font-weight: bold; font-size: 12px;");

      try {

        // BƯỚC 1: LẤY LINK STREAM TỪ DRIVE (KHÔNG TẢI TOÀN BỘ FILE NHỊ PHÂN)
        let tStreamStart = performance.now();
        let streamInfo = await serverCall("getDriveFileStreamInfo_Backend", targetFileId);
        if (!streamInfo || !streamInfo.downloadUrl || !streamInfo.token) {
          throw new Error("Không thể kết nối lấy luồng dữ liệu từ Google Drive.");
        }
        let durStream = ((performance.now() - tStreamStart) / 1000).toFixed(2);
        console.log(`%c[AI Pipeline] [1/4] Lấy luồng Drive thành công: ${durStream}s (Sẵn sàng Range Requests)`, "color: #90CAF9;");

        // BƯỚC 2: RENDER PDF SANG ẢNH (PDF.js CHỈ TẢI VÀI TRĂM KB CỦA CÁC TRANG CẦN THIẾT)
        let tRenderStart = performance.now();
        const pdfSource = {
          url: streamInfo.downloadUrl,
          httpHeaders: { Authorization: "Bearer " + streamInfo.token },
          disableAutoFetch: true, // Ép PDF.js chỉ tải đúng phần byte nó cần, không tải toàn bộ 18MB
          disableStream: false
        };
        let imagesBase64 = await renderPdfPagesToImagesForAI(pdfSource, fileType);
        let durRender = ((performance.now() - tRenderStart) / 1000).toFixed(2);
        console.log(`%c[AI Pipeline] [2/4] Render PDF.js ra ${imagesBase64.length} trang ảnh A4: ${durRender}s`, "color: #80CBC4;");

        // BƯỚC 3: GỌI BACKEND CLOUD VISION + GEMINI TEXT-ONLY
        let tBackendStart = performance.now();
        let res = await serverCall("extractDataFromImages", imagesBase64, fileType);
        let durBackend = ((performance.now() - tBackendStart) / 1000).toFixed(2);
        console.log(`%c[AI Pipeline] [3/4] Backend Vision OCR + Gemini Text: ${durBackend}s`, "color: #CE93D8; font-weight: bold;");

        if (!res || res.error) {
          throw new Error(res?.error || "AI không thể nhận diện dữ liệu bản vẽ.");
        }

        // BƯỚC 4: LỌC TRÙNG VÀ LƯU DATABASE SHEET
        let tSaveStart = performance.now();
        let tasks = (res && Array.isArray(res.notes)) ? res.notes : [];
        let unique = [];
        let seen = new Set();
        tasks.forEach(t => {
          let n = (typeof t === "object" && t ? (t.note || "") : String(t || "")).trim();
          let dept = (typeof t === "object" && t && t.dept) ? t.dept : "XD";
          if (n !== "" && !seen.has(n.toUpperCase())) {
            unique.push({ note: n, dept: dept.toUpperCase() === "MEP" ? "MEP" : "XD" });
            seen.add(n.toUpperCase());
          }
        });

        await serverCall("batchAddTasksBackend", targetProjectCode, targetFileId, unique, isConfirmed);

        let newTasksList = unique.map((t, idx) => ({
          taskId: "T-" + Date.now() + "-" + idx,
          fileId: targetFileId,
          description: t.note,
          team: t.dept
        }));
        S.drawingTaskCache[targetFileId] = newTasksList;

        let projKey = (targetProjectCode || "").toUpperCase().trim();
        if (S.projectFullDataCache_Drawing[projKey] && S.projectFullDataCache_Drawing[projKey].tasks) {
          if (isConfirmed) {
            S.projectFullDataCache_Drawing[projKey].tasks = S.projectFullDataCache_Drawing[projKey].tasks.filter(t => t.fileId !== targetFileId);
          }
          S.projectFullDataCache_Drawing[projKey].tasks.push(...newTasksList);
        }

        let durSave = ((performance.now() - tSaveStart) / 1000).toFixed(2);
        let durTotal = ((performance.now() - perfStart) / 1000).toFixed(2);

        console.log(`%c[AI Pipeline] [4/4] Lưu Database Task_Log: ${durSave}s (${unique.length} hạng mục)`, "color: #A5D6A7;");
        console.log(`%c[AI Pipeline] ✔ HOÀN THÀNH XUẤT SẮC TOÀN TIẾN TRÌNH: ${durTotal}s (Stream Auth: ${durStream}s | Render (Smart Fetch): ${durRender}s | AI Backend: ${durBackend}s | Save: ${durSave}s)`, "color: #00E676; font-weight: bold; font-size: 12px;");

        showToast_PL(`🚀 Đã trích xuất xong: <b>${cleanFileName}</b>`, "success");
      } catch (err) {
        let durFailed = ((performance.now() - perfStart) / 1000).toFixed(2);
        console.error(`%c[AI Pipeline] ❌ THẤT BẠI sau ${durFailed}s: ${err.message || err}`, "color: #FF5252; font-weight: bold;", err);
        showToast_PL(`⚠️ Lỗi AI [${cleanFileName}]: ${err.message || err}`, "error");
      } finally {
        S.activeAiFiles.delete(targetFileId);
        if (S.currentFileId === targetFileId) {
          updateAiButtonUI(targetFileId);
          renderTaskList_Drawing(targetFileId);
        }
      }
    })();
  }

  window.updatePanelContent = updatePanelContent;
  window.triggerEditDrawing_Client = triggerEditDrawing_Client;
  window.cancelEditDrawing_Client = cancelEditDrawing_Client;
  window.executeActualEditDrawing_Client = executeActualEditDrawing_Client;
  window.triggerDeleteDrawing_Client = triggerDeleteDrawing_Client;
  window.cancelDeleteDrawing_Client = cancelDeleteDrawing_Client;
  window.executeActualDeleteDrawing_Client = executeActualDeleteDrawing_Client;
  window.handleDragStart = handleDragStart;
  window.allowDrop = allowDrop;
  window.handleDragEnterZone = handleDragEnterZone;
  window.handleDragLeaveZone = handleDragLeaveZone;
  window.handleDrop = handleDrop;
  window.handleDragEnd = handleDragEnd;
  window.syncDrawingImmediately = syncDrawingImmediately;
  window.cancelDrawingSync = cancelDrawingSync;
  window.addNewTaskItem = addNewTaskItem;
  window.updateTaskDescInline = updateTaskDescInline;
  window.deleteTask_Drawing = deleteTask_Drawing;
  window.resetAIZoneUI = resetAIZoneUI;
  window.extractFromCurrentSelected = extractFromCurrentSelected;
})();