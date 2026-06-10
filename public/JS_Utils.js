
// ==========================================================================
// NHÓM UTILITIES: ĐỊNH DẠNG & CÔNG CỤ HỖ TRỢ
// ==========================================================================

/**
 * 1. Hàm đổ dữ liệu chi nhánh (Location)
 */
window.setupLocation = function(selectId, onchangeFunc) {
    const loc = document.getElementById(selectId);
    if (loc) {
        loc.innerHTML = LIST_LOCATIONS.map(o => `<option value="${o}">${o}</option>`).join("");
        if (typeof onchangeFunc === 'function') loc.onchange = onchangeFunc;
        console.log("✅ Location Ready: " + selectId);
    }
};

/**
 * 2. Hàm Debounce: Trì hoãn thực thi để tối ưu hiệu năng (Search)
 */
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * 3. Chuyển đổi Date Object sang chuỗi ngày tháng Tiếng Việt
 */
function formatDateToVietnamese(date) {
    return `ngày ${String(date.getDate()).padStart(2, '0')} tháng ${String(date.getMonth() + 1).padStart(2, '0')} năm ${date.getFullYear()}`;
}

/**
 * 4. Xử lý chuỗi an toàn để chèn vào HTML Attribute
 */
function escapeStr(str) { 
    return (str || "").toString().replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;"); 
}

/**
 * 5. Định dạng nhập liệu tiền tệ & giới hạn cho Tab HD
 */
function formatInput_HD(input) {
    let value = input.value.replace(/\D/g, "");
    if (input.name === "field4-hd") {
        input.value = value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        if (value && parseInt(value) > 0) {
            ["radio-payment-container-hd", "cont-field6-hd", "cont-field7-hd"].forEach(showFieldSmoothly);
        }
    } else if (input.name === "field5-hd") {
        input.value = value.slice(0, 2); 
    } else if (input.name === "field7-hd") {
        input.value = value.slice(0, 3);
    }
}

/**
 * 6. Định dạng nhập liệu tiền tệ cho Tab PL
 */
function formatInput_PL(input) {
    let value = input.value.replace(/\D/g, "");
    if (input.id === "field2-pl" || input.id === "ep-input-val") {
        input.value = value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    } 
}

/**
 * 7. Điều hướng bàn phím Vạn năng (Mũi tên & Enter) cho Dropdown
 */
function masterKeyboardNav(e, dropId, itemSelector, nextInputId, selectCallback) {
    const drop = document.getElementById(dropId);
    
    // 🚀 SỬA LỖI: Nhận diện hiển thị dựa vào class hoạt động hoặc thuộc tính visibility thực tế của trình duyệt
    const isVisible = drop && (
        drop.classList.contains("show") || 
        drop.classList.contains("open-smooth") || 
        window.getComputedStyle(drop).visibility === "visible"
    );

    if (!isVisible) {
        if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById(nextInputId)?.focus();
        }
        return;
    }

    const items = drop.querySelectorAll(itemSelector);
    if (items.length === 0) {
        if (e.key === "Enter") {
            e.preventDefault();
            if (drop.classList.contains("show")) drop.classList.remove("show");
            if (drop.classList.contains("open-smooth")) drop.classList.remove("open-smooth");
            document.getElementById(nextInputId)?.focus();
        }
        return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
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
    } 
    else if (e.key === "Enter") {
        e.preventDefault();
        
        // Ngoại lệ cho dropdown bảo lãnh/tạm ứng nếu chưa chọn mục nào
        if (dropId === 'drop-field5-hd' && currentFocusIndex === -1) {
            drop.classList.remove("show");
            setTimeout(() => { document.getElementById(nextInputId)?.focus(); }, 100);
            return;
        }
        
        const targetItem = (currentFocusIndex >= 0) ? items[currentFocusIndex] : items[0];
        if (targetItem) {
            setTimeout(() => {
                selectCallback(targetItem); 
                currentFocusIndex = -1; 
                const nextField = document.getElementById(nextInputId);
                if (nextField) {
                    nextField.focus();
                    if (nextField.tagName === "INPUT") nextField.select();
                }
            }, 50);
        }
    }
}

/**
 * 8. Render danh sách Dropdown (Giới hạn 50 dòng chống Lag)
 */
function renderDropdownList(inputId, dropId, data, mapFunc) {
    const input = document.getElementById(inputId);
    const drop = document.getElementById(dropId);
    if (!input || !drop) return;
    const query = input.value.toLowerCase().trim();
    const filtered = data.filter(i => {
        const str = typeof i === 'object' ? (i.searchString || i.display || "") : i;
        return str.toString().toLowerCase().includes(query);
    }).slice(0, 50);
    if (filtered.length > 0) {
        drop.innerHTML = filtered.map(mapFunc).join("");
        drop.classList.add("show");
    }
}

/**
 * 9. ENGINE NÉN PDF TẠI TRÌNH DUYỆT (HACK BYPASS & PROGRESS)
 */
async function compressPDFEngine(file, progressCallback) {
    const originalRAF = window.requestAnimationFrame;
    const originalCancelRAF = window.cancelAnimationFrame;
    window.requestAnimationFrame = function(callback) { return window.setTimeout(callback, 16); };
    window.cancelAnimationFrame = function(id) { window.clearTimeout(id); };

    try {
        const fileArrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(fileArrayBuffer).promise;
        const { jsPDF } = window.jspdf;
        const newPdfDoc = new jsPDF('p', 'mm', 'a4');
        const a4Width = newPdfDoc.internal.pageSize.getWidth();
        const totalPages = pdf.numPages;

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2 });
            let imgData;
            if (typeof OffscreenCanvas !== 'undefined') {
                const canvas = new OffscreenCanvas(viewport.width, viewport.height);
                const ctx = canvas.getContext('2d', { alpha: false });
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.5 });
                imgData = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } else {
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width; canvas.height = viewport.height;
                const ctx = canvas.getContext('2d', { alpha: false });
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                imgData = canvas.toDataURL('image/jpeg', 0.5);
            }
            if (i > 1) newPdfDoc.addPage();
            const imgProps = newPdfDoc.getImageProperties(imgData);
            const pdfHeight = (imgProps.height * a4Width) / imgProps.width;
            newPdfDoc.addImage(imgData, 'JPEG', 0, 0, a4Width, pdfHeight);
            progressCallback(Math.round((i / totalPages) * 80));
        }
        return newPdfDoc.output('datauristring').split(',')[1];
    } finally {
        window.requestAnimationFrame = originalRAF;
        window.cancelAnimationFrame = originalCancelRAF;
    }
}

/**
 * 10. Hàm khởi tạo Flatpickr Luxury (Fix lỗi hiển thị đầu & Nút Reset)
 */
function setupLuxuryCalendar(inputSelector, displayId, onChangeExtra) {
    const displayEl = document.getElementById(displayId);
    if (!displayEl) return;
    const isInput = displayEl.tagName === "INPUT";
    const container = displayEl.closest(".location-date-container");
    const today = new Date();

    if (!isInput) displayEl.textContent = formatDateToVietnamese(today);
    else displayEl.value = "";

    return flatpickr(inputSelector, {
        defaultDate: today,
        dateFormat: "d/m/Y",
        locale: "vi",
        onReady: function(selectedDates, dateStr, instance) {
            const clearBtn = document.createElement("div");
            clearBtn.className = "flatpickr-clear-btn";
            clearBtn.textContent = "RESET TO TODAY";
            clearBtn.onclick = () => {
                const now = new Date();
                instance.setDate(now, true);
                if (isInput) displayEl.value = instance.formatDate(now, "d/m/Y");
                else displayEl.textContent = formatDateToVietnamese(now);
                displayEl.classList.remove("different-date");
                if (onChangeExtra) onChangeExtra(now);
                instance.close();
            };
            instance.calendarContainer.appendChild(clearBtn);
        },
        onOpen: () => { 
            if (container) container.classList.add("calendar-open"); 
            displayEl.classList.add("text-open"); 
        },
        onClose: () => { 
            if (container) container.classList.remove("calendar-open"); 
            displayEl.classList.remove("text-open"); 
        },
        onChange: (dates, dateStr, instance) => {
            const selDate = dates[0];
            const isToday = selDate.toDateString() === today.toDateString();
            if (isInput) displayEl.value = dateStr;
            else displayEl.textContent = formatDateToVietnamese(selDate);
            if (!isToday) displayEl.classList.add("different-date");
            else displayEl.classList.remove("different-date");
            if (onChangeExtra) onChangeExtra(selDate);
        }
    });
}

/**
 * 11. Các hàm hỗ trợ Highlight (Bàn phím)
 */
function moveHighlight(dropId) {
    const drop = document.getElementById(dropId);
    if (!drop) return;
    const items = drop.querySelectorAll("div:not(.disable-hover)");
    items.forEach((item, index) => {
        if (index === currentFocusIndex) {
            item.classList.add("active");
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
            item.classList.remove("active");
        }
    });
}

function moveHighlight_PL() {
    const drop = document.getElementById("dropdown-field0-pl");
    if (!drop) return;
    const items = drop.querySelectorAll(".hoc-tooltip");
    items.forEach((item, index) => {
        if (index === currentFocusIndex) {
            item.classList.add("active");
            item.scrollIntoView({ block: "nearest", behavior: "smooth" });
        } else {
            item.classList.remove("active");
        }
    });
}

/**
 * 12. Xử lý tải File trực tiếp từ Drive
 */
function downloadScanFile_PL(id, event) {
    if (event) event.stopPropagation();
    if (!id || id === "undefined") {
        showToast_PL("⚠️ Lỗi: Không thể tải file!", "error");
        return;
    }
    const downloadUrl = "https://drive.google.com/uc?export=download&id=" + id;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast_PL("⬇️ Đang tải file...", "success");
}

/**
 * 13. Mobile Interactions (Touch & Tap)
 */
function handleTouchStart_Mobile(e, element, maHD, isTransferred) {
    mobileTouchTimer = setTimeout(() => {
        const touch = e.touches[0];
        const mockEvent = {
            preventDefault: () => {}, stopPropagation: () => {},
            clientX: touch.clientX, clientY: touch.clientY
        };
        if (navigator.vibrate) navigator.vibrate(40);
        showContextMenu_PL(mockEvent, element, maHD, isTransferred);
    }, 600); 
}

function handleTouchEnd_Mobile() {
    if (mobileTouchTimer) clearTimeout(mobileTouchTimer);
}

function handleDoubleTap_Scan(e, id, fileName) {
    const now = new Date().getTime();
    const timesince = now - lastTap_Scan;
    if ((timesince < 300) && (timesince > 0)) {
        e.preventDefault(); 
        if (navigator.vibrate) navigator.vibrate(40);
        viewScanFile_PL(id, fileName);
        lastTap_Scan = 0;
    } else {
        lastTap_Scan = now;
    }
}

/**
 * 14. Phím tắt Enter/Tab nhảy ô cho PL
 */
function handleKeyDown_PL(e, nextInputId) {
    if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const next = document.getElementById(nextInputId);
        if (next) next.focus();
    }
}