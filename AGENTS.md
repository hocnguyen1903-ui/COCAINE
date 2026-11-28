# KEN — Bcons Contract & Drawing Management Web App

## 1. Architecture

- **Frontend:** Vanilla HTML/CSS/JS SPA (`index.html` + `public/`), hosted on GitHub Pages. Calls backend via `fetch()` POST `{action, data, token}` to the Google Apps Script Web App (`doPost`). API URL is in `public/js/core/JS_Variables.js`.
- **Backend:** Google Apps Script (`backend/`), synced with `clasp`. Data in Google Sheets (`SHEET_ID`) and Drive (`MASTER_FOLDER_ID`, `ROOT_FOLDER_ID`, `EXPORT_FOLDER_ID`).
- **CDN libs:** PDF.js, `pdf-lib`, Flatpickr, Bootstrap Icons, Ably Realtime, Cytoscape.

## 2. File Map (read the relevant file directly; do NOT scan the repo)

- `index.html`: 5 tabs (`tab-about`, `tab-hdtcxd`, `tab-plhd`, `tab-tbkq`, `tab-drawing`), modals, right dock preview (`#pl-dock-preview-panel`).
- `Dictionary.json`: PL01 `#` search config (`scoring_config`, `manual_synonyms`, `stop_words`, `auto_extracted`).
- `backend/`
  - `Code.js`: `doPost(e)` router, HMAC session auth (`BCONS2.*`), users (`User_Registry`), `getSystemData()`, Ably.
  - `API_Drawing.js`: mindmap (`Drawing_Log`), tasks (`Task_Log`), chunked Drive upload, OCR + Gemini extraction (`extractDataFromImages`).
  - `API_HopDong.js`: export contract (`HDTCXD`) and bid result notice (`TBKQTT`) as Google Docs.
  - `API_PhuLuc.js`: export appendix (`PLHD`), edit/delete rows in `SO HDTCXD BCONS - NTP`, `exportToNewSpreadsheet_PL`, scan PDF upload/delete/overwrite.
  - `API_Viewer.js`: digitized JSON cache (`[Số hóa] *.json`), Vision OCR batch, GZIP search index `Index_PL01_<YEAR>.json`.
- `public/js/core/`: `JS_Variables.js` (globals, state, API URL), `JS_Utils.js` (format, toast, tooltip, keyboard nav), `JS_Core_API.js` (fetch wrapper, token).
- `public/js/modules/`
  - `tab_hd/JS_Tab_HD.js` (`CONTRACT`)
  - `tab_pl/JS_Tab_PL_{Core,Actions,Files}.js` (`EXTENSIONS`: list, context menu, handover, scan files)
  - `tab_tb/JS_Tab_TB.js` (`NOTICES`)
  - `drawing/JS_Drawing_{State,Mindmap,Upload,Tasks}.js` (`DRAWING`)
  - `viewer/JS_Viewer_{State,Search,Pipeline,UI}.js`: PDF reader, invisible text layer, AI search, PL01 page jump.
- `public/css/`: `core/` (`CSS_Base`, `CSS_Forms`, `CSS_Components`), `modules/` (`CSS_Tab_PL`, `CSS_Viewer`, `CSS_Drawing`).
- `gdp.js`, `watch-gas.js`: clasp push/deploy scripts.
- `.agents/`: Antigravity lifecycle hooks (`hooks.json`, `format-hook.js`, `post-edit-hook.js`, `backup-hook.js`, `safety-hook.js`, `session-start-hook.js`, `stop-verify-hook.js`, `hook-utils.js`).
- `.githooks/`: Git hooks (`pre-commit`, `pre-commit.js`) + `.prettierrc.json`, `.prettierignore`.

## 3. Token-Saving Rules (MANDATORY)

1. Never read dump/backup files (e.g. `dump_du_lieu.txt`) or `node_modules/`.
2. For a feature/bugfix, read only that module's files + its matching `backend/API_*.js`.
3. For long files, use targeted `grep` or line ranges instead of reading the whole file.
4. If something is not in the File Map, use targeted `grep` by function/action name, then update Section 2.
5. When adding/renaming/deleting files, update Section 2.
6. Do not rename a `doPost` action without updating both `backend/Code.js` and `public/js/`.

## 4. Response Style (MANDATORY)

- Ultra-concise, focus directly on the issue/result. Keep normal replies to 1–4 short lines; no preamble, no recap, no closing fluff.
- Never list detailed CSS properties, pixel values, line-by-line code details, or function internals unless the user explicitly asks. After an edit, state only the outcome (1 short line) + file link(s).
- Reply to the user in Vietnamese; keep code identifiers in English.
- When offering multiple options, list the **recommended option first** and mark it "(Recommended)". Keep each option to one line plus a short trade-off.
- Ask a question only when blocked; otherwise state the assumption and proceed.

## 5. Commands

- **Frontend:** open `index.html` with VS Code Live Server (or GitHub Pages).
- **Deploy backend:** `node gdp.js` (runs `npx clasp push`; updates the fixed deployment only if code changed).
- **Auto-push on save:** `node watch-gas.js`.
- **Format code:** `npm run format` / `npm run format:check` (cần `npm install` để cài Prettier; tự chạy qua `PostToolUse` và Git `pre-commit`).
- **Tests:** none; verify manually in the relevant tab after reload.

## 6. Conventions & Safety

- **Language:** comments, error messages, UI text in Vietnamese; identifiers and API actions in English `camelCase`. Backend functions use suffixes (`_Backend`, `_HD`, `_PL`, `_TB`, `_Viewer`) to avoid GAS global name collisions.
- **Secrets:** `GEMINI_API_KEY`, `VISION_API_KEY`, `SA_CLIENT_EMAIL`, `SA_PRIVATE_KEY`, `SERVER_HMAC_SECRET` live in Script Properties. Never hardcode or log them.
- **Data safety:** no bulk delete/overwrite on Sheets (`SO HDTCXD BCONS - NTP`, `Drawing_Log`, `Task_Log`) or Drive without confirmation. **New** backend write functions must use `LockService.getScriptLock()`.
- **Script load order in `index.html` (keep when editing):**
  1. CDN: `flatpickr` → `pdf.min.js` → `pdf-lib.min.js` → `ably.min-2.js`
  2. Core: `JS_Variables.js` (first) → `JS_Utils.js` → `JS_Core_API.js`
  3. Modules: `tab_hd` → `tab_pl` (Core → Actions → Files) → `tab_tb` → `drawing` (State → Mindmap → Upload → Tasks) → `viewer` (State → Search → Pipeline → UI)

## 7. Current Work / Handoff (update before switching machines)

- **Recent changes:**
  - Renamed batch upload title to `DROP & AUTO-SORT` (`JS_Tab_PL_Files.js`), renamed `tab-plhd` heading to `QUẢN LÝ HỢP ĐỒNG & PHỤ LỤC` (`index.html`), and aligned `#scan-queue-badge` (`STATUS`) height/size with `.scan-status-pill` (`CSS_Components.css`).
  - Removed global `0.8` UI zoom across CSS/JS to run at native `1:1`, refactored Show Preview zoom (`--prv-zoom`, max `1.8`, `index.html`), fixed preview zoom positioning/panning/scroll-state (`JS_Tab_PL_Files.js`, `JS_Tab_PL_Actions.js`, `JS_Viewer_UI.js`, `JS_Utils.js`, `JS_Core_API.js`), and rescaled `.global-tooltip-bcons` (`1.25×`, `0.5px` border/divider, `6px` arrow, `+20%` divider spacing, `CSS_Components.css`).
  - Standardized `box-shadow` across the project to `0 5px 12px rgba(..., 0.8)` (`0 3px 8px rgba(..., 0.8)` for buttons/small icons) and added light dashboard blur `#dropdown-field0-pl.list-dashboard-locked` (`CSS_Tab_PL.css`).
  - Fixed `'NAM` staff search token prefix matching (`JS_Tab_PL_Core.js`), added double-click copy on contract ID (`Copied ID: ...`) and amounts (`Copied: ...`) (`JS_Tab_PL_Core.js`), and added Ably broadcasts for `UPLOAD_FILE` / `DELETE_FILE` (`JS_Tab_PL_Files.js`, `JS_Core_API.js`).
  - Optimized tab/modal animations (removed `backdrop-filter` animation & `transition: all` on delete modals) and fixed split-preview close cleanup (`tab-anim-done`, `JS_Tab_PL_Files.js`, `CSS_Base.css`). Also tightened `AGENTS.md` Section 4 response brevity.
- **In progress:** Pending manual browser/Show Preview check and git commit/push for uncommitted local changes.
- **Known issues:** none
