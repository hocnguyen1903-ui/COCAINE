# Project: KEN (Bcons Contract & Drawing Management Web App)

## 1. Kiến trúc & Luồng chạy

- **Frontend:** SPA thuần HTML/CSS/Vanilla JS (`index.html` + `public/`), deploy tĩnh qua GitHub Pages, giao tiếp với Backend qua `fetch()` HTTP POST (`action`, `data`, `token`) tới Google Apps Script Web App (`doPost`).
- **Backend:** Google Apps Script (`backend/`), đồng bộ bằng `clasp` (`node gdp.js` để push & deploy). Dữ liệu lưu trên Google Sheets (`SHEET_ID`) và Google Drive (`MASTER_FOLDER_ID`, `ROOT_FOLDER_ID`, `EXPORT_FOLDER_ID`).
- **Thư viện ngoài (CDN):** PDF.js (`pdf.min.js`), `pdf-lib`, Flatpickr, Bootstrap Icons, Ably Realtime (`ably.min-2.js`).

## 2. Bản đồ thư mục (Đọc thẳng file tương ứng, KHÔNG quét toàn bộ repo)

- `index.html`: Khung layout 5 tab (`tab-about`, `tab-hdtcxd`, `tab-plhd`, `tab-tbkq`, `tab-drawing`), các Modal xác nhận, và khung Dock Preview bên phải (`#pl-dock-preview-panel`).
- `backend/`:
  - `Code.js`: Router `doPost(e)`, xác thực HMAC session (`BCONS2.*`), quản lý user (`User_Registry`), tải dữ liệu tổng `getSystemData()`, Ably realtime.
  - `API_Drawing.js`: Mindmap bản vẽ (`Drawing_Log`), quản lý task (`Task_Log`), upload phân mảnh Drive, OCR Cloud Vision + Gemini trích xuất hạng mục (`extractDataFromImages`).
  - `API_HopDong.js`: Xuất file Google Docs Hợp đồng gốc (`HDTCXD`) & Thông báo kết quả gói thầu (`TBKQTT`).
  - `API_PhuLuc.js`: Xuất Phụ lục (`PLHD`), cập nhật/xóa dòng trên `SO HDTCXD BCONS - NTP`, xuất Excel/Sheet (`exportToNewSpreadsheet_PL`), upload/xóa/ghi đè PDF Scan.
  - `API_Viewer.js`: Cache JSON số hóa trên Drive (`[Số hóa] *.json`), Cloud Vision OCR batch, tìm kiếm & đánh chỉ mục `Index_PL01_<YEAR>.json` nén GZIP.
- `public/js/core/`:
  - `JS_Variables.js`: Biến toàn cục, state hệ thống, URL Web App API.
  - `JS_Utils.js`: Tiện ích định dạng ngày/tiền, toast, tooltip, keyboard navigation.
  - `JS_Core_API.js`: Hàm gọi `fetch` tới `doPost`, quản lý token đăng nhập.
- `public/js/modules/`:
  - `tab_hd/JS_Tab_HD.js`: Logic tab Soạn thảo Hợp đồng (`CONTRACT`).
  - `tab_pl/JS_Tab_PL_Core.js`, `JS_Tab_PL_Actions.js`, `JS_Tab_PL_Files.js`: Bảng điều khiển danh sách HĐ/PL (`EXTENSIONS`), context menu chuột phải, bàn giao hồ sơ, upload/xem file scan.
  - `tab_tb/JS_Tab_TB.js`: Logic tab Thông báo kết quả gói thầu (`NOTICES`).
  - `drawing/JS_Drawing_State.js`, `JS_Drawing_Mindmap.js`, `JS_Drawing_Upload.js`, `JS_Drawing_Tasks.js`: Sơ đồ Cytoscape Mindmap, upload & bóc tách hạng mục bản vẽ (`DRAWING`).
  - `viewer/JS_Viewer_State.js`, `JS_Viewer_Search.js`, `JS_Viewer_Pipeline.js`, `JS_Viewer_UI.js`: Trình đọc PDF native, lớp text tàng hình, tìm kiếm AI & nhảy trang PL01.
- `public/css/`:
  - `core/`: `CSS_Base.css`, `CSS_Forms.css`, `CSS_Components.css`.
  - `modules/`: `CSS_Tab_PL.css`, `CSS_Viewer.css`, `CSS_Drawing.css`.
- `gdp.js` & `watch-gas.js`: Script CLI đẩy code lên GAS qua `clasp`.

## 3. Quy tắc tiết kiệm Token & Context (BẮT BUỘC)

1. **KHÔNG BAO GIỜ** đọc các file dump/backup (`*.txt`), `node_modules/`, hoặc liệt kê toàn bộ cây thư mục khi đã biết tên tab/module.
2. Khi sửa lỗi hoặc thêm tính năng cho một phân hệ, chỉ mở đúng các file JS/CSS của phân hệ đó + file `backend/API_*.js` tương ứng.
3. Không sửa đổi tên `action` trong `doPost` nếu không cập nhật đồng thời ở cả `backend/Code.js` và `public/js/`.
4. Không tự ý tạo thêm file test tạm (`test_*.js`) trong thư mục dự án trừ khi được yêu cầu.

## 4. Lệnh thường dùng

- **Chạy frontend:** Mở trực tiếp `index.html` bằng Live Server (VS Code) hoặc deploy tĩnh qua GitHub Pages (giao tiếp trực tiếp với GAS Web App URL cấu hình trong `public/js/core/JS_Variables.js`).
- **Deploy backend:** Chạy `node gdp.js` (tự động chạy `npx clasp push`; nếu có thay đổi code thì cập nhật bản deploy cố định trên Google Apps Script, nếu không đổi thì tự động bỏ qua).
- **Theo dõi tự động (nếu dùng):** `node watch-gas.js` để tự động push khi lưu file trong `backend/`.
- **Kiểm thử:** Không có test tự động; verify thủ công trực tiếp trên tab liên quan sau khi reload.

## 5. Quy ước & An toàn

- **Ngôn ngữ code:** Comment, thông báo lỗi và text UI bằng tiếng Việt; tên biến, hàm và action API bằng tiếng Anh `camelCase` (backend thường thêm hậu tố `_Backend`, `_HD`, `_PL`, `_TB`, `_Viewer` để tránh trùng tên toàn cục trong GAS).
- **Bảo mật & Bí mật:** API key (`GEMINI_API_KEY`, `VISION_API_KEY`, `SA_CLIENT_EMAIL`, `SA_PRIVATE_KEY`, `SERVER_HMAC_SECRET`) lưu ở Script Properties, **KHÔNG** hardcode hay log ra console.
- **An toàn dữ liệu:** Không chạy thao tác xóa/ghi đè hàng loạt lên Sheets (`SO HDTCXD BCONS - NTP`, `Drawing_Log`, `Task_Log`) hoặc Drive khi chưa xác nhận; mọi hàm ghi backend đều phải bọc `LockService.getScriptLock()`.
- **Tìm kiếm có mục tiêu:** Nếu không tìm thấy hàm/file trong mục 2, chỉ dùng `grep` có mục tiêu theo tên hàm/action; sau đó cập nhật lại mục 2.
- **Thứ tự load script trong `index.html` (BẮT BUỘC giữ đúng thứ tự khi thêm/sửa file):**
  1. Thư viện ngoài (CDN): `flatpickr` -> `pdf.min.js` -> `pdf-lib.min.js` -> `ably.min-2.js`
  2. Core JS: `JS_Variables.js` (phải nạp đầu tiên) -> `JS_Utils.js` -> `JS_Core_API.js`
  3. Modules JS: `tab_hd/` -> `tab_pl/` (`Core` -> `Actions` -> `Files`) -> `tab_tb/` -> `drawing/` (`State` -> `Mindmap` -> `Upload` -> `Tasks`) -> `viewer/` (`State` -> `Search` -> `Pipeline` -> `UI`)[cite: 4]
