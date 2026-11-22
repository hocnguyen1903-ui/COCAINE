// =========================================================================
// MODULE: DRAWING 3/4 - DRAG/DROP QUEUE, VALIDATION & RESUMABLE CHUNK UPLOAD
// =========================================================================

(() => {
  const BD = window.__BconsDrawing;
  const S = BD.state;

  // =========================================================================
  // KIỂM CHUẨN TÊN FILE & CHECK TRÙNG CHÉO TRÊN DRIVE
  // =========================================================================
  function removeVietnameseDiacritics(str) {
    if (!str) return "";
    return str.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .trim();
  }

  function isValidYYMMDD(yyStr, mmStr, ddStr) {
    const yy = parseInt(yyStr, 10);
    const mm = parseInt(mmStr, 10);
    const dd = parseInt(ddStr, 10);

    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;

    const year = 2000 + yy;
    const date = new Date(year, mm - 1, dd);
    return date.getFullYear() === year && date.getMonth() === (mm - 1) && date.getDate() === dd;
  }

  function validateDrawingFilename(fileName) {
    if (!fileName) return { isValid: false, fileType: "INVALID" };

    const trimmedName = fileName.trim();
    if (trimmedName.length > 58) {
      return { isValid: false, fileType: "INVALID" };
    }

    if (/\.(pdf|xlsx|xls)$/i.test(trimmedName)) {
      return { isValid: false, fileType: "INVALID" };
    }

    const parts = trimmedName.split("_");
    if (parts.length < 3) {
      return { isValid: false, fileType: "INVALID" };
    }

    // 1. Kiểm tra Ngày (YYMMDD hợp lệ)
    const datePart = parts[0].trim();
    const dateMatch = datePart.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (!dateMatch) {
      return { isValid: false, fileType: "INVALID" };
    }
    if (!isValidYYMMDD(dateMatch[1], dateMatch[2], dateMatch[3])) {
      return { isValid: false, fileType: "INVALID" };
    }

    // 2. Kiểm tra Mã Dự Án
    const projectCode = parts[1].trim();
    if (!projectCode || projectCode.length < 2) {
      return { isValid: false, fileType: "INVALID" };
    }

    // 3. Phân loại danh mục theo Token Part 2
    const cleanPart2 = removeVietnameseDiacritics(parts[2].trim());

    // A. PHIẾU ĐỀ XUẤT (PROPOSAL)
    if (/^(pdx|de xuat|proposal)$/.test(cleanPart2)) {
      const hasContent = parts.slice(3).join("_").trim().length > 0;
      return hasContent ? { isValid: true, fileType: "PROPOSAL" } : { isValid: false, fileType: "INVALID" };
    }

    // B. BẢN VẼ CẬP NHẬT (UPDATE)
    const updateMatch = cleanPart2.match(/^(cap nhat|update)(\s+.*)?$/);
    if (updateMatch) {
      const hasContentInPart2 = updateMatch[2] && updateMatch[2].trim().length > 0;
      const hasPart3 = parts.slice(3).join("_").trim().length > 0;
      return (hasContentInPart2 || hasPart3) ? { isValid: true, fileType: "UPDATE" } : { isValid: false, fileType: "INVALID" };
    }

    // C. BẢN VẼ TKTC (ORIGINAL)
    if (/^(bvtktc|tkbvtc|bo mon)$/.test(cleanPart2)) {
      const hasDeptOrSection = parts.length >= 4 && parts[3].trim().length > 0;
      return hasDeptOrSection ? { isValid: true, fileType: "ORIGINAL" } : { isValid: false, fileType: "INVALID" };
    }

    return { isValid: false, fileType: "INVALID" };
  }

  function checkIsDuplicateOnDrive(fileName) {
    const parts = fileName.split("_");
    if (parts.length < 2) return false;

    const projectCode = parts[1].trim().toUpperCase();
    const filesList = S.projectFilesCache_Drawing[projectCode];

    if (!filesList) {
      fetchProjectFilesSilently_Drawing(projectCode);
      return false;
    }

    const cleanStr = (str) => (str || "").normalize("NFC").replace(/\s+/g, " ").trim().toUpperCase();
    const upperName = cleanStr(fileName);

    const isDuplicate = filesList.some(f => cleanStr(f.fileName) === upperName);
    console.log(`[Cross-Project Duplicate Check] Dự án: ${projectCode} | Tệp: "${fileName}" | Trùng: ${isDuplicate}`);
    return isDuplicate;
  }

  function fetchProjectFilesSilently_Drawing(projectCode) {
    const code = projectCode.toUpperCase().trim();
    if (!code || S.projectFilesCache_Drawing[code] || S.pendingFetches_Drawing.has(code)) return;

    S.pendingFetches_Drawing.add(code);

    callBackend("getMindmapData", code)
      .then(mindmapData => {
        S.pendingFetches_Drawing.delete(code);
        if (mindmapData && mindmapData.files) {
          S.projectFilesCache_Drawing[code] = mindmapData.files;
          renderDrawingQueueUI();
        }
      })
      .catch(err => {
        S.pendingFetches_Drawing.delete(code);
        console.error(`[Silent Fetch] Không thể tải ngầm dữ liệu Drive cho dự án ${code}:`, err);
      });
  }

  // =========================================================================
  // VÙNG KÉO THẢ & HÀNG CHỜ UPLOAD
  // =========================================================================
  function initDrawingUploadZone() {
    const zone = document.getElementById("drawing-upload-zone");
    const input = document.getElementById("drawing-upload-input");
    if (!zone || !input || zone.dataset.bound) return;

    zone.dataset.bound = "true";

    zone.addEventListener("click", () => {
      const stateEmpty = document.getElementById("drawing-state-empty");
      if (stateEmpty && stateEmpty.style.display !== "none") {
        input.click();
      }
    });

    input.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        addFilesToDrawingQueue(e.target.files);
      }
      input.value = "";
    });

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
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
      const isDuplicateInQueue = S.drawingUploadQueue.some(oldItem =>
        oldItem.rawName === newFile.name && oldItem.size === newFile.size
      );
      if (!isDuplicateInQueue) {
        const extMatch = newFile.name.match(/\.(pdf|xlsx|xls)$/i);
        const ext = extMatch ? extMatch[0] : ".pdf";
        const cleanNameWithoutExt = newFile.name.replace(/\.(pdf|xlsx|xls)$/i, "").trim();

        S.drawingUploadQueue.push({
          file: newFile,
          name: cleanNameWithoutExt,
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

    if (!S.isUploading_Drawing) {
      if (S.drawingUploadQueue.length === 0) {
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
    S.drawingUploadQueue.forEach((fileItem, index) => {
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
        <div class="task-item" style="margin-bottom: 5px; border-color: ${isValid ? "transparent" : "rgba(255,77,77,0.3)"}; background: ${isValid ? "rgba(255, 255, 255, 0.04)" : "rgba(255,77,77,0.05)"};">
          <i class="bi ${iconClass}" style="color: ${iconColor} !important; font-size: 14px; flex-shrink: 0; margin-right: 5px;"></i>
          <input type="text" value="${fileItem.name}"
                 maxlength="58"
                 class="task-desc-edit"
                 style="color: ${isValid ? "rgba(255, 255, 255, 0.8)" : "#ff7777"} !important; font-weight: 500; height: 100%;"
                 oninput="handleQueueItemInput(this, ${index})"
                 onchange="renameFileInDrawingQueue(this.value, ${index})"
                 onclick="event.stopPropagation();">
          ${isDuplicateOnDrive && isValid ? `
            <span style="font-size: 9px; color: #FFBA08; font-weight: bold; background: rgba(255,186,8,0.08); border: 1.2px solid rgba(255,186,8,0.3); padding: 1.5px 6px; border-radius: 4px; margin-right: 8px; flex-shrink: 0; display: inline-flex; align-items: center; gap: 3px;">
              <i class="bi bi-exclamation-triangle-fill" style="font-size: 9px;"></i>TRÙNG FILE
            </span>` : ""}
          <span id="char-counter-${index}" style="font-size: 9.5px; color: ${fileItem.name.length >= 58 ? "#FFBA08" : "#505966"}; font-style: italic; flex-shrink: 0; margin-right: 10px;">
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

  function handleQueueItemInput(inputEl, index) {
    if (inputEl.value.length > 58) {
      inputEl.value = inputEl.value.slice(0, 58);
    }
    S.drawingUploadQueue[index].name = inputEl.value;

    const counter = document.getElementById(`char-counter-${index}`);
    if (counter) {
      counter.textContent = `(${inputEl.value.length}/58)`;
      counter.style.color = inputEl.value.length >= 58 ? "#FFBA08" : "#505966";
    }
  }

  function renameFileInDrawingQueue(newName, index) {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      showToast_PL("⚠️ Tên tệp tin không được phép để trống!", "error");
      renderDrawingQueueUI();
      return;
    }
    S.drawingUploadQueue[index].name = trimmedName.slice(0, 58);
    renderDrawingQueueUI();
  }

  function removeFileFromDrawingQueue(event, index) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    S.drawingUploadQueue.splice(index, 1);

    const fileInput = document.getElementById("drawing-upload-input");
    if (fileInput) fileInput.value = "";

    renderDrawingQueueUI();
  }

  function clearDrawingUploadQueue(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    S.drawingUploadQueue = [];

    const fileInput = document.getElementById("drawing-upload-input");
    if (fileInput) fileInput.value = "";

    renderDrawingQueueUI();
  }

  async function startDrawingQueueUpload(event) {
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (S.isUploading_Drawing || S.drawingUploadQueue.length === 0) return;

    const stateQueue = document.getElementById("drawing-state-queue");
    const stateUploading = document.getElementById("drawing-state-uploading");
    const statusText = document.getElementById("drawing-upload-status");
    const progressBar = document.getElementById("drawing-upload-progress");
    const fileInput = document.getElementById("drawing-upload-input");

    if (!stateQueue || !stateUploading || !statusText || !progressBar) return;

    let isCheckingDuplicates = false;
    for (let f of S.drawingUploadQueue) {
      const parts = f.name.split("_");
      if (parts.length >= 2) {
        const projectCode = parts[1].trim().toUpperCase();
        if (S.pendingFetches_Drawing.has(projectCode)) {
          isCheckingDuplicates = true;
          break;
        }
      }
    }

    if (isCheckingDuplicates) {
      showToast_PL("⏳ Đang kiểm tra trùng lặp, vui lòng đợi 1 giây rồi tiếp tục!", "error");
      return;
    }

    let hasInvalidFile = false;
    for (let f of S.drawingUploadQueue) {
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

    let hasDuplicateFile = false;
    for (let f of S.drawingUploadQueue) {
      if (checkIsDuplicateOnDrive(f.name + f.ext)) {
        hasDuplicateFile = true;
        break;
      }
    }

    if (hasDuplicateFile) {
      showToast_PL("⚠️ Trùng tên hoặc file đã được UP. Vui lòng kiểm tra lại!", "error");
      return;
    }

    S.isUploading_Drawing = true;
    stateQueue.style.display = "none";
    stateUploading.style.display = "flex";
    progressBar.style.width = "0%";

    try {
      const filesToUpload = [...S.drawingUploadQueue];

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
            } else {
              throw fetchError;
            }
          }
        }

        S.drawingUploadQueue = S.drawingUploadQueue.filter(item => item !== fileItem);
        renderDrawingQueueUI();
      }

      statusText.textContent = "SAVING TO DATABASE...";
      progressBar.style.width = "100%";

      const uploadedProjectCodes = [...new Set(filesToUpload.map(f => {
        const parts = f.name.split("_");
        return parts.length >= 2 ? parts[1].trim().toUpperCase() : "";
      }).filter(Boolean))];

      for (const projCode of uploadedProjectCodes) {
        delete S.projectFullDataCache_Drawing[projCode];
        await callBackend("syncDrawingsToSheet_Backend", projCode);
      }

      showToast_PL("🚀 Đã tải lên và lưu trữ thành công!", "success");

      S.drawingUploadQueue = [];
      if (fileInput) fileInput.value = "";
      S.isUploading_Drawing = false;
      renderDrawingQueueUI();

      document.getElementById("dp-empty-state").style.display = "flex";
      document.getElementById("dp-content-state").style.display = "none";
      S.currentFileId = "";

      const targetProj = uploadedProjectCodes[0] || S.selectedProjectDrawing;
      if (targetProj) {
        S.selectedProjectDrawing = targetProj;
        S.currentlyRenderedProject = "";
        const projInput = document.getElementById("drawing-project-search");
        if (projInput) projInput.value = targetProj;
        BD.mindmap.renderMindmap(targetProj, true);
      }
    } catch (e) {
      console.error("Lỗi tải tệp phân mảnh:", e);
      alert(e.message || e);
      S.isUploading_Drawing = false;
      stateUploading.style.display = "none";
      stateQueue.style.display = "flex";
      renderDrawingQueueUI();
    } finally {
      S.isUploading_Drawing = false;
    }
  }

  BD.upload = {
    validateDrawingFilename,
    initDrawingUploadZone
  };

  window.initDrawingUploadZone = initDrawingUploadZone;
  window.handleQueueItemInput = handleQueueItemInput;
  window.renameFileInDrawingQueue = renameFileInDrawingQueue;
  window.removeFileFromDrawingQueue = removeFileFromDrawingQueue;
  window.clearDrawingUploadQueue = clearDrawingUploadQueue;
  window.startDrawingQueueUpload = startDrawingQueueUpload;
})();