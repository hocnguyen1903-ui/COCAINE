// ==========================================================================
// NHÓM UTILITIES: ĐỊNH DẠNG & CÔNG CỤ HỖ TRỢ
// ==========================================================================

/**
 * 1. Hàm đổ dữ liệu chi nhánh (Location)
 */
window.setupLocation = function (selectId, onchangeFunc) {
    const loc = document.getElementById(selectId);
    if (loc) {
        loc.innerHTML = LIST_LOCATIONS.map((o) => `<option value="${o}">${o}</option>`).join("");
        if (typeof onchangeFunc === "function") loc.onchange = onchangeFunc;
        console.log("✅ Location Ready: " + selectId);
    }
};

/**
 * 2. Hàm Debounce: Trì hoãn thực thi để tối ưu hiệu năng (Search)
 */
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * 3. Chuyển đổi Date Object sang chuỗi ngày tháng Tiếng Việt
 */
function formatDateToVietnamese(date) {
    return `ngày ${String(date.getDate()).padStart(2, "0")} tháng ${String(date.getMonth() + 1).padStart(2, "0")} năm ${date.getFullYear()}`;
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
 * 6. Định dạng nhập liệu tiền tệ cho Tab PL (Đã hỗ trợ nhập dấu trừ âm (-) cho giá trị giảm)
 */
function formatInput_PL(input) {
    const val = input.value;
    // Kiểm tra nhận diện dấu trừ (-) nằm ở vị trí đầu tiên của ô nhập liệu
    const isNegative = val.startsWith("-");

    // Loại bỏ sạch các ký tự không phải số (\D)
    let cleanVal = val.replace(/\D/g, "");

    // Định dạng phân tách dấu chấm hàng nghìn
    if (cleanVal !== "") {
        cleanVal = cleanVal.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }

    // Ghép dấu trừ âm quay lại đầu chuỗi nếu có
    input.value = isNegative ? "-" + cleanVal : cleanVal;
}

/**
 * 7. Điều hướng bàn phím Vạn năng (Mũi tên, Enter & Tab) cho Dropdown
 */
function masterKeyboardNav(e, dropId, itemSelector, nextInputId, selectCallback) {
    if (dropId === "dropdown-field0-pl") {
        return;
    }

    const isCommitKey = e.key === "Enter" || e.key === "Tab";

    const drop = document.getElementById(dropId);

    const isVisible =
        drop &&
        (drop.classList.contains("show") ||
            drop.classList.contains("open-smooth") ||
            window.getComputedStyle(drop).visibility === "visible");

    if (!isVisible) {
        if (isCommitKey && nextInputId) {
            e.preventDefault();
            const nextField = document.getElementById(nextInputId);
            if (nextField) {
                nextField.focus();
                if (nextField.tagName === "INPUT") nextField.select();
            }
        }
        return;
    }

    const items = drop.querySelectorAll(itemSelector);
    if (items.length === 0) {
        if (isCommitKey) {
            e.preventDefault();
            if (drop.classList.contains("show")) drop.classList.remove("show");
            if (drop.classList.contains("open-smooth")) drop.classList.remove("open-smooth");
            if (nextInputId) {
                const nextField = document.getElementById(nextInputId);
                if (nextField) {
                    nextField.focus();
                    if (nextField.tagName === "INPUT") nextField.select();
                }
            }
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
    } else if (isCommitKey) {
        e.preventDefault();

        if (dropId === "drop-field5-hd" && currentFocusIndex === -1) {
            drop.classList.remove("show");
            setTimeout(() => {
                const nextField = document.getElementById(nextInputId);
                if (nextField) {
                    nextField.focus();
                    if (nextField.tagName === "INPUT") nextField.select();
                }
            }, 100);
            return;
        }

        const targetItem = currentFocusIndex >= 0 ? items[currentFocusIndex] : items[0];
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
    const filtered = data
        .filter((i) => {
            const str = typeof i === "object" ? i.searchString || i.display || "" : i;
            return str.toString().toLowerCase().includes(query);
        })
        .slice(0, 50);
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
    window.requestAnimationFrame = function (callback) {
        return window.setTimeout(callback, 16);
    };
    window.cancelAnimationFrame = function (id) {
        window.clearTimeout(id);
    };

    try {
        const fileArrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(fileArrayBuffer).promise;
        const { jsPDF } = window.jspdf;
        const newPdfDoc = new jsPDF("p", "mm", "a4");
        const a4Width = newPdfDoc.internal.pageSize.getWidth();
        const totalPages = pdf.numPages;

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2 });
            let imgData;
            if (typeof OffscreenCanvas !== "undefined") {
                const canvas = new OffscreenCanvas(viewport.width, viewport.height);
                const ctx = canvas.getContext("2d", { alpha: false });
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.5 });
                imgData = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            } else {
                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext("2d", { alpha: false });
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                imgData = canvas.toDataURL("image/jpeg", 0.5);
            }
            if (i > 1) newPdfDoc.addPage();
            const imgProps = newPdfDoc.getImageProperties(imgData);
            const pdfHeight = (imgProps.height * a4Width) / imgProps.width;
            newPdfDoc.addImage(imgData, "JPEG", 0, 0, a4Width, pdfHeight);
            progressCallback(Math.round((i / totalPages) * 80));
        }
        return newPdfDoc.output("datauristring").split(",")[1];
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

    const activeLocale =
        typeof flatpickr !== "undefined" && flatpickr.l10ns && flatpickr.l10ns.vi ? flatpickr.l10ns.vi : "vi";

    function getNormalizedRect(el) {
        const r = el.getBoundingClientRect();
        const tab = el.closest(".tab-content");
        const z = tab ? parseFloat(window.getComputedStyle(tab).zoom) || 1 : 1;
        if (z !== 1 && el.offsetWidth > 0) {
            const ratio = r.width / el.offsetWidth;
            if (Math.abs(ratio - 1) < Math.abs(ratio - z)) {
                return {
                    top: r.top * z,
                    left: r.left * z,
                    bottom: r.bottom * z,
                    right: r.right * z,
                    width: r.width * z,
                    height: r.height * z
                };
            }
        }
        return r;
    }

    function positionCalendarCleanly(instance) {
        const cal = instance.calendarContainer;
        if (!cal) return;
        const scrollX = window.scrollX || window.pageXOffset;
        const scrollY = window.scrollY || window.pageYOffset;

        if (container && !isInput) {
            const cRect = getNormalizedRect(container);
            const dRect = getNormalizedRect(displayEl);
            const targetW = Math.round(cRect.width) || 252;
            const targetLeft = Math.max(
                scrollX + 8,
                Math.min(cRect.left + scrollX, scrollX + window.innerWidth - targetW - 8)
            );
            const targetTop = cRect.bottom + 8 + scrollY;
            const arrowX = Math.max(
                16,
                Math.min(targetW - 24, dRect.left + dRect.width / 2 - (targetLeft - scrollX) - 5)
            );

            cal.style.setProperty("width", targetW + "px", "important");
            cal.classList.remove("arrowBottom");
            cal.classList.add("arrowTop");
            cal.style.right = "auto";
            cal.style.left = targetLeft + "px";
            cal.style.top = targetTop + "px";
            cal.style.setProperty("--fp-arrow-left", Math.round(arrowX) + "px");
        } else {
            const calW = cal.offsetWidth || 252;
            const calH = cal.offsetHeight || 275;
            const iRect = getNormalizedRect(displayEl);
            const rawLeft = iRect.left + scrollX;
            const targetLeft = Math.max(scrollX + 8, Math.min(rawLeft, scrollX + window.innerWidth - calW - 8));
            const openBelow = iRect.bottom + 8 + calH <= window.innerHeight || iRect.top - calH - 8 < 0;
            const targetTop = openBelow ? iRect.bottom + 8 + scrollY : iRect.top - calH - 8 + scrollY;

            cal.classList.toggle("arrowTop", openBelow);
            cal.classList.toggle("arrowBottom", !openBelow);
            cal.style.right = "auto";
            cal.style.left = targetLeft + "px";
            cal.style.top = targetTop + "px";
            cal.style.setProperty("--fp-arrow-left", "22px");
        }
    }

    return flatpickr(inputSelector, {
        defaultDate: today,
        dateFormat: "d/m/Y",
        locale: activeLocale,
        positionElement: container && !isInput ? container : undefined,

        parseDate: (datestr, format) => {
            if (!datestr) return today;
            if (datestr instanceof Date) return datestr;
            if (typeof datestr === "number") return new Date(datestr);

            if (typeof datestr === "string") {
                const cleanStr = datestr.trim();
                const vnMatch = cleanStr.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/i);
                if (vnMatch) {
                    return new Date(parseInt(vnMatch[3], 10), parseInt(vnMatch[2], 10) - 1, parseInt(vnMatch[1], 10));
                }
                const slashMatch = cleanStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (slashMatch) {
                    return new Date(
                        parseInt(slashMatch[3], 10),
                        parseInt(slashMatch[2], 10) - 1,
                        parseInt(slashMatch[1], 10)
                    );
                }
                const nativeParsed = new Date(cleanStr);
                if (!isNaN(nativeParsed.getTime())) return nativeParsed;
            }
            return today;
        },

        onReady: function (selectedDates, dateStr, instance) {
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
        onOpen: (selectedDates, dateStr, instance) => {
            if (container) container.classList.add("calendar-open");
            displayEl.classList.add("text-open");
            positionCalendarCleanly(instance);
            requestAnimationFrame(() => positionCalendarCleanly(instance));
        },
        onMonthChange: (selectedDates, dateStr, instance) => {
            requestAnimationFrame(() => positionCalendarCleanly(instance));
        },
        onYearChange: (selectedDates, dateStr, instance) => {
            requestAnimationFrame(() => positionCalendarCleanly(instance));
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
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.style.display = "none";
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
            preventDefault: () => {},
            stopPropagation: () => {},
            clientX: touch.clientX,
            clientY: touch.clientY
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
    if (timesince < 300 && timesince > 0) {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(40);
        // Nhấp đúp vào file scan trong bảng quản lý file: Mở trực tiếp trên Google Drive
        window.open(`https://drive.google.com/file/d/${id}/view`, "_blank");
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

async function lazyLoadDrawingLibs() {
    if (isDrawingLibsLoaded) return Promise.resolve();
    if (isDrawingLibsLoading)
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (isDrawingLibsLoaded) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });

    isDrawingLibsLoading = true;

    // Hàm nạp Script dưới dạng Promise
    const loadScript = (src) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    try {
        // ✅ BỎ nạp lại pdf.js 2.16.105 (vì index.html đã nạp bản 3.11.174)
        // Đảm bảo workerSrc vẫn giữ bản 3.11.174 nếu cần:
        if (window.pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }

        const libsToLoad = [
            loadScript("https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.26.0/cytoscape.min.js").then(() => {
                return loadScript("https://unpkg.com/dagre@0.8.5/dist/dagre.min.js").then(() => {
                    return loadScript("https://cytoscape.org/cytoscape.js-dagre/cytoscape-dagre.js");
                });
            })
        ];

        // Chỉ nạp pdf-lib nếu chưa có sẵn từ index.html
        if (!window.PDFLib) {
            libsToLoad.push(loadScript("https://unpkg.com/pdf-lib/dist/pdf-lib.min.js"));
        }

        await Promise.all(libsToLoad);

        isDrawingLibsLoaded = true;
        isDrawingLibsLoading = false;
    } catch (e) {
        console.error("Lỗi nạp thư viện Drawing:", e);
        isDrawingLibsLoading = false;
        throw e;
    }
}

/**
 * Bộ điều phối Keep-Alive tập trung (Audio + Web Worker rAF 16ms vượt trần throttle 1000ms khi ẩn tab)
 */
const ACTIVE_KEEP_ALIVE_KEYS = new Set();
const ORIG_RAF = window.requestAnimationFrame.bind(window);
const ORIG_CANCEL_RAF = window.cancelAnimationFrame.bind(window);
const BG_RAF_CALLBACKS = new Map();
const BG_RAF_FALLBACK_TIMERS = new Map();
const PENDING_NATIVE_RAFS = new Map();
let bgRafSeq = 0;
let isBgRafPatched = false;
let bgRafWorker = null;

function ensureBgRafWorker() {
    if (bgRafWorker) return bgRafWorker;
    try {
        const workerSrc = `
            const timers = new Map();
            self.onmessage = function(e) {
                const d = e.data;
                if (d.cancel) {
                    const t = timers.get(d.id);
                    if (t !== undefined) { clearTimeout(t); timers.delete(d.id); }
                    return;
                }
                const t = setTimeout(function() {
                    timers.delete(d.id);
                    self.postMessage(d.id);
                }, 16);
                timers.set(d.id, t);
            };
        `;
        const blob = new Blob([workerSrc], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        bgRafWorker = new Worker(url);
        URL.revokeObjectURL(url);
        bgRafWorker.onmessage = function (e) {
            const id = e.data;
            const cb = BG_RAF_CALLBACKS.get(id);
            if (!cb) return;
            BG_RAF_CALLBACKS.delete(id);
            cb(performance.now());
        };
    } catch (e) {
        bgRafWorker = null;
    }
    return bgRafWorker;
}

function scheduleBgRaf(cb) {
    const fakeId = --bgRafSeq;
    const worker = ensureBgRafWorker();
    if (worker) {
        BG_RAF_CALLBACKS.set(fakeId, cb);
        worker.postMessage({ id: fakeId });
        return fakeId;
    }
    const tId = window.setTimeout(() => {
        BG_RAF_FALLBACK_TIMERS.delete(fakeId);
        cb(performance.now());
    }, 16);
    BG_RAF_FALLBACK_TIMERS.set(fakeId, tId);
    return fakeId;
}

function cancelBgRaf(id) {
    if (BG_RAF_CALLBACKS.has(id)) {
        BG_RAF_CALLBACKS.delete(id);
        if (bgRafWorker) bgRafWorker.postMessage({ id: id, cancel: true });
        return true;
    }
    if (BG_RAF_FALLBACK_TIMERS.has(id)) {
        window.clearTimeout(BG_RAF_FALLBACK_TIMERS.get(id));
        BG_RAF_FALLBACK_TIMERS.delete(id);
        return true;
    }
    return false;
}

function flushNativeRafsToBackground() {
    if (!document.hidden || !isBgRafPatched || PENDING_NATIVE_RAFS.size === 0) return;
    const entries = Array.from(PENDING_NATIVE_RAFS.entries());
    PENDING_NATIVE_RAFS.clear();
    entries.forEach(([nativeId, cb]) => {
        ORIG_CANCEL_RAF(nativeId);
        scheduleBgRaf(cb);
    });
}

document.addEventListener("visibilitychange", flushNativeRafsToBackground);

function enableBackgroundRafBypass() {
    if (isBgRafPatched) return;
    isBgRafPatched = true;
    ensureBgRafWorker();

    window.requestAnimationFrame = function (cb) {
        if (document.hidden) return scheduleBgRaf(cb);
        const nativeId = ORIG_RAF((ts) => {
            PENDING_NATIVE_RAFS.delete(nativeId);
            cb(ts);
        });
        PENDING_NATIVE_RAFS.set(nativeId, cb);
        return nativeId;
    };

    window.cancelAnimationFrame = function (id) {
        if (cancelBgRaf(id)) return;
        PENDING_NATIVE_RAFS.delete(id);
        ORIG_CANCEL_RAF(id);
    };
}

function disableBackgroundRafBypass() {
    if (!isBgRafPatched) return;
    isBgRafPatched = false;
    window.requestAnimationFrame = ORIG_RAF;
    window.cancelAnimationFrame = ORIG_CANCEL_RAF;
}

function acquireKeepAlive(key = "default") {
    ACTIVE_KEEP_ALIVE_KEYS.add(String(key));
    enableBackgroundRafBypass();
    if (typeof keepAliveAudio !== "undefined" && keepAliveAudio.paused) {
        keepAliveAudio.play().catch(() => {});
    }
}

function releaseKeepAlive(key = "default") {
    ACTIVE_KEEP_ALIVE_KEYS.delete(String(key));
    if (ACTIVE_KEEP_ALIVE_KEYS.size === 0) {
        disableBackgroundRafBypass();
        if (typeof keepAliveAudio !== "undefined") {
            try {
                keepAliveAudio.pause();
                keepAliveAudio.currentTime = 0;
            } catch (e) {}
        }
    }
}
