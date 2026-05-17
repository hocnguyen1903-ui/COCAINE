<script>
// ==========================================================================
// MODULE: TAB THÔNG BÁO KẾT QUẢ (TBKQ)
// ==========================================================================

/**
 * Khởi tạo Tab TBKQ: Setup Location và Lịch
 */
function initTabTB() {
    setupLuxuryCalendar("#dateDisplay-tb", "dateDisplay-tb", null);
    setupLocation("locationDropdown-tb", null);
}

/**
 * Reset Form Thông báo kết quả
 */
function clearForm_TB() {
    document.getElementById("dataForm-tb").reset();
    
    document.querySelectorAll('#tab-tbkq .smooth-dropdown').forEach(d => {
        d.classList.remove('show');
        d.innerHTML = "";
    });
    
    const fieldsToHide = [
        "cont-pkg-name-tb",
        "cont-field1-tb", "cont-field2-tb", "cont-field3-tb", 
        "cont-field4-tb", "cont-field5-tb"
    ];
    fieldsToHide.forEach(id => closeSmoothly(id));

    // Reset Lịch về hôm nay
    const displayEl = document.getElementById("dateDisplay-tb");
    if (displayEl) {
        const fp = displayEl._flatpickr;
        const today = new Date();
        if (fp) fp.setDate(today, true);
        displayEl.textContent = formatDateToVietnamese(today);
        displayEl.classList.remove("different-date");
    }
    
    if (typeof updateContractNo_TB === "function") updateContractNo_TB();
}

/**
 * Ghi chú: Hàm updateContractNo_TB và submitData_TB 
 * đã được định nghĩa trong file JS_Core_API.html 
 * để xử lý giao tiếp với Server.
 */
</script>