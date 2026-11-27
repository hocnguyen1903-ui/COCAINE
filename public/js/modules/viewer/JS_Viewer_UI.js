// =========================================================================
// BCONS DOCUMENT VIEWER - MODULE 4/4: CANVAS VIRTUALIZATION, UI & FACADE
// =========================================================================

(() => {
  const BV = window.__BconsViewer;
  const S = BV.state;
  const U = BV.utils;
  const ST = BV.storage;
  const SR = BV.search;
  const googleScriptRun = BV.googleScriptRun;

  // =========================================================================
  // RENDER & VIRTUALIZATION
  // =========================================================================
  function paintBitmapBlob(canvas, blob, targetPdfPage, renderScale) {
    return createImageBitmap(blob).then(function(bmp) {
      if (!canvas.isConnected || S.isZooming) {
        if (bmp.close) bmp.close();
        return;
      }
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.dataset.renderedScale = String(renderScale);
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
    });
  }

  let jumpScrollTimer = null;

  function jumpToPageNumber(pageNum, isSmooth = true, scrollToBottomEdge = false) {
    if (!S.currentManifest || !S.currentManifest.pages.length) return;
    const vp = document.getElementById("viewport-container");
    const total = S.currentManifest.pages.length;
    const targetIndex = Math.max(0, Math.min(total - 1, (parseInt(pageNum, 10) || 1) - 1));
    const targetPageObj = S.currentManifest.pages[targetIndex];
    if (!targetPageObj || !vp) return;

    const el = document.getElementById("page-wrapper-" + targetPageObj.pageNum);
    if (!el) return;

    buildTextLayerForWrapper(el);
    const destCanvas = el.querySelector("canvas.page-img");
    const destPdfPage = parseInt(el.dataset.pdfPage || targetPageObj.pageNum, 10);
    if (destCanvas && !U.scalesEqual(destCanvas.dataset.renderedScale, S.currentScale)) {
      renderPageToCanvas(destCanvas, destPdfPage);
    }

    let destTop = Math.max(0, el.offsetTop);
    if (scrollToBottomEdge && targetIndex === total - 1) {
      destTop = Math.max(destTop, vp.scrollHeight - vp.clientHeight);
    }

    if (isSmooth && Math.abs(vp.scrollTop - destTop) >= 5) {
      S.scrollLock = true;
      let unlocked = false;

      function onArrive() {
        if (unlocked) return;
        unlocked = true;
        vp.removeEventListener("scrollend", onArrive);
        clearTimeout(jumpScrollTimer);
        S.scrollLock = false;
        renderVisiblePagesOnly();
        updateCurrentPageOnScroll();
      }

      vp.addEventListener("scrollend", onArrive);
      clearTimeout(jumpScrollTimer);
      jumpScrollTimer = setTimeout(onArrive, 1200);
    }

    vp.scrollTo({ top: destTop, behavior: isSmooth ? "smooth" : "auto" });
    updatePageIndicatorUI(targetIndex + 1);
  }

  function getAppendixOffsetTop() {
    if (!S.currentManifest || !S.currentManifest.pages.length) return null;
    const total = S.currentManifest.pages.length;
    const appendixPage = S.currentManifest.appendixStartPage || (total + 1);
    if (appendixPage <= 1 || appendixPage > total) return null;

    const targetObj = S.currentManifest.pages[appendixPage - 1];
    const el = targetObj ? document.getElementById("page-wrapper-" + targetObj.pageNum) : null;
    return el ? Math.max(0, el.offsetTop) : null;
  }

  function handleSmartScrollUp() {
    if (!S.currentManifest || !S.currentManifest.pages.length) return;
    const vp = document.getElementById("viewport-container");
    const total = S.currentManifest.pages.length;
    const appendixPage = S.currentManifest.appendixStartPage || (total + 1);
    const appTop = getAppendixOffsetTop();

    if (vp && appTop !== null && vp.scrollTop > appTop + 30) {
      jumpToPageNumber(appendixPage, true);
    } else {
      jumpToPageNumber(1, true);
    }
  }

  function handleSmartScrollDown() {
    if (!S.currentManifest || !S.currentManifest.pages.length) return;
    const vp = document.getElementById("viewport-container");
    const total = S.currentManifest.pages.length;
    const appendixPage = S.currentManifest.appendixStartPage || (total + 1);
    const appTop = getAppendixOffsetTop();

    if (vp && appTop !== null && vp.scrollTop < appTop - 30) {
      jumpToPageNumber(appendixPage, true, false);
    } else {
      jumpToPageNumber(total, true, true);
    }
  }

  function updatePageIndicatorUI(pNum) {
    const input = document.getElementById("jump-page-input");
    if (input && document.activeElement !== input) {
      input.value = pNum;
    }
    const num = parseInt(pNum, 10) || 1;
    const total = S.currentManifest ? S.currentManifest.pages.length : 1;
    const appendixPage = S.currentManifest ? (S.currentManifest.appendixStartPage || (total + 1)) : (total + 1);

    const btnTop = document.getElementById("btn-scroll-top");
    const btnBottom = document.getElementById("btn-scroll-bottom");

    if (btnTop) {
      if (num <= 1) {
        btnTop.classList.add("is-hidden");
      } else {
        btnTop.classList.remove("is-hidden");
        if (appendixPage > 1 && appendixPage <= total && num > appendixPage) {
          btnTop.setAttribute("data-tip", "PL01");
        } else {
          btnTop.setAttribute("data-tip", "Top");
        }
      }
    }

    if (btnBottom) {
      if (num >= total) {
        btnBottom.classList.add("is-hidden");
      } else {
        btnBottom.classList.remove("is-hidden");
        if (appendixPage <= total && num < appendixPage) {
          btnBottom.setAttribute("data-tip", "PL01");
        } else {
          btnBottom.setAttribute("data-tip", "Bottom");
        }
      }
    }
  }

  let isPanBound = false;
  function setupHandToolPanning() {
    const vp = document.getElementById("viewport-container");
    if (!vp || isPanBound) return;
    isPanBound = true;

    let isPanTicking = false;
    let targetScrollLeft = 0;
    let targetScrollTop = 0;

    vp.addEventListener("pointerdown", function(e) {
      if (e.pointerType === "touch") return;
      if (e.button !== 0 || e.target.closest(".search-box-wrap") || e.target.closest(".prv-tools")) return;
      if (e.target.classList.contains("text-overlay-item")) return;

      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();

      S.isDragging = true;
      S.startX = e.clientX;
      S.startY = e.clientY;
      S.scrollLeftStart = vp.scrollLeft;
      S.scrollTopStart = vp.scrollTop;
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("grabbing");
    });

    vp.addEventListener("pointermove", function(e) {
      if (!S.isDragging) return;
      e.preventDefault();

      targetScrollLeft = S.scrollLeftStart - (e.clientX - S.startX);
      targetScrollTop = S.scrollTopStart - (e.clientY - S.startY);

      if (!isPanTicking) {
        isPanTicking = true;
        requestAnimationFrame(function() {
          if (S.isDragging) {
            vp.scrollLeft = targetScrollLeft;
            vp.scrollTop = targetScrollTop;
          }
          isPanTicking = false;
        });
      }
    });

    const stopDrag = function(e) {
      if (!S.isDragging) return;
      S.isDragging = false;
      isPanTicking = false;
      try { vp.releasePointerCapture(e.pointerId); } catch (err) {}
      vp.classList.remove("grabbing");
    };

    vp.addEventListener("pointerup", stopDrag);
    vp.addEventListener("pointercancel", stopDrag);
  }

  function cleanTypographySpacing(str) {
    if (!str) return "";
    return str
      .replace(/\s+([,;.:?!])/g, "$1")
      .replace(/([(\[{“‘])\s+/g, "$1")
      .replace(/\s+([)\]}”’])/g, "$1")
      .replace(/"\s+([^"\n]+?)\s+"/g, '"$1"')
      .replace(/(^|[\s(\[{])"\s+(\S)/g, '$1"$2')
      .replace(/(\S)\s+"(?=[\s)\]},;.:?!]|$)/g, '$1"')
      .replace(/[^\S\r\n]+/g, " ")
      .trim();
  }

  let isCopyBound = false;
  function setupSmartClipboardCopy() {
    if (isCopyBound) return;
    isCopyBound = true;

    document.addEventListener("copy", function(e) {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

      const container = document.getElementById("viewport-container");
      if (!container) return;

      const range = sel.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer) && container !== range.commonAncestorContainer) return;

      const fragment = range.cloneContents();
      const spans = Array.from(fragment.querySelectorAll(".text-overlay-item"));

      if (spans.length > 1) {
        e.preventDefault();

        let resultText = "";
        let prevTop = null;
        let prevText = "";

        spans.forEach((span) => {
          const text = span.textContent.trim();
          if (!text || text === "|") return;

          const currentTop = parseFloat(span.style.top) || 0;

          if (prevTop === null) {
            resultText += text;
          } else {
            const isNewLine = Math.abs(currentTop - prevTop) > 0.8;
            if (isNewLine) {
              resultText += "\n" + text;
            } else {
              const noSpaceBefore = /^[,;.:?!)}\]”’]/.test(text);
              const noSpaceAfterPrev = /[(\[{“‘"]$/.test(prevText);

              if (noSpaceBefore || noSpaceAfterPrev) {
                resultText += text;
              } else {
                resultText += " " + text;
              }
            }
          }
          prevTop = currentTop;
          prevText = text;
        });

        resultText = cleanTypographySpacing(resultText);

        if (e.clipboardData) {
          e.clipboardData.setData("text/plain", resultText);
        }
      }
    });
  }

  let isPinchBound = false;
  function setupTouchPinchZoom() {
    const vp = document.getElementById("viewport-container");
    if (!vp || isPinchBound) return;
    isPinchBound = true;

    let initialDist = 0;
    let initialScale = 1.0;

    vp.addEventListener("touchstart", function(e) {
      if (e.touches.length === 2) {
        initialDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialScale = S.currentScale;
      }
    }, { passive: true });

    vp.addEventListener("touchmove", function(e) {
      if (e.touches.length === 2 && initialDist > 0) {
        e.preventDefault();
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = dist / initialDist;
        const targetScale = Math.min(3.0, Math.max(0.5, initialScale * factor));
        const delta = targetScale - S.currentScale;
        if (Math.abs(delta) >= 0.05) {
          const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          zoomChange(delta, midX, midY);
        }
      }
    }, { passive: false });

    vp.addEventListener("touchend", function(e) {
      if (e.touches.length < 2) initialDist = 0;
    }, { passive: true });
  }

  let isWheelBound = false;
  function setupCtrlWheelZoom() {
    const vp = document.getElementById("viewport-container");
    if (!vp || isWheelBound) return;
    isWheelBound = true;

    vp.addEventListener("wheel", function(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomChange(e.deltaY < 0 ? 0.15 : -0.15, e.clientX, e.clientY);
    }, { passive: false });
  }

  function handlePageJumpKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      jumpToPageNumber(e.target.value);
      e.target.blur();
    }
  }

  let isScrollTicking = false;

  function updateCurrentPageOnScroll() {
    if (isScrollTicking || S.scrollLock || !S.currentManifest || !S.currentManifest.pages.length) return;
    isScrollTicking = true;

    requestAnimationFrame(function() {
      isScrollTicking = false;
      const container = document.getElementById("viewport-container");
      if (!container) return;

      const total = S.currentManifest.pages.length;

      if (container.scrollTop <= 20) {
        updatePageIndicatorUI(1);
        return;
      }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 20) {
        updatePageIndicatorUI(total);
        return;
      }

      const focusLine = container.scrollTop + Math.min(200, container.clientHeight * 0.25);
      const wrappers = container.children;

      for (let i = 0; i < wrappers.length; i++) {
        const el = wrappers[i];
        if (!el.classList.contains("page-wrapper")) continue;

        const top = el.offsetTop;
        const bottom = top + el.clientHeight + 35;
        if (focusLine >= top && focusLine <= bottom) {
          updatePageIndicatorUI(i + 1);
          break;
        }
      }
    });
  }

  function buildTextLayerForWrapper(wrapper) {
    if (!wrapper || !S.currentManifest || !S.currentManifest.pages) return;
    if (wrapper.querySelector(".text-layer")) return;

    const idx = parseInt(wrapper.dataset.idx, 10);
    const p = !isNaN(idx)
      ? S.currentManifest.pages[idx]
      : S.currentManifest.pages.find(item => String(item.pageNum) === String(wrapper.dataset.page));

    if (!p || !p.textItems || p.textItems.length === 0) return;

    const txtLayer = document.createElement("div");
    txtLayer.className = "text-layer";
    let txtHtml = "";
    const items = p.textItems;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const str = Array.isArray(it) ? it[0] : (it.str || "");
      if (!str) continue;

      const x = Array.isArray(it) ? it[1] : it.x;
      const y = Array.isArray(it) ? it[2] : it.y;
      const w = Array.isArray(it) ? it[3] : it.w;
      const h = Array.isArray(it) ? it[4] : it.h;

      const leftPct = (x / p.width) * 100;
      const topPct = ((p.height - y - h) / p.height) * 100;
      const widthPct = (w / p.width) * 100;
      const heightPct = (h / p.height) * 100;
      const fontSize = Math.max(8, Math.round(h * 0.88 * 10) / 10);

      const safeText = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      txtHtml += `<span class="text-overlay-item" style="left:${leftPct}%; top:${topPct}%; width:${widthPct}%; height:${heightPct}%; font-size:calc(${fontSize}px * var(--doc-scale));">${safeText}</span>`;
    }

    txtLayer.innerHTML = txtHtml;
    wrapper.appendChild(txtLayer);
  }

  function removeTextLayerFromWrapper(wrapper) {
    if (!wrapper) return;
    const txtLayer = wrapper.querySelector(".text-layer");
    if (txtLayer) txtLayer.remove();
  }

  function getContainerFitWidth(container) {
    const panelEl = document.getElementById("pl-dock-preview-panel");
    const rawW = (container && container.clientWidth > 100)
      ? container.clientWidth
      : ((panelEl && parseFloat(panelEl.style.width) > 100) ? parseFloat(panelEl.style.width) : 1040);
    return Math.max(300, rawW);
  }

  function createPageWrapperElement(p, idx, fitWidth) {
    const pageWrapper = document.createElement("div");
    pageWrapper.id = "page-wrapper-" + p.pageNum;
    pageWrapper.className = "page-wrapper";
    pageWrapper.dataset.page = p.pageNum;
    pageWrapper.dataset.pdfPage = p.pdfPageNum || p.pageNum;
    pageWrapper.dataset.rotation = p.rotation || 0;
    if (idx !== undefined) pageWrapper.dataset.idx = idx;

    const pageFit = (fitWidth || 940) / Math.max(1, p.width);
    pageWrapper.dataset.baseFit = String(pageFit);
    pageWrapper.style.setProperty("--doc-scale", String(S.currentScale * pageFit));

    pageWrapper.style.width = "calc(" + p.width + "px * var(--doc-scale))";
    pageWrapper.style.height = "calc(" + p.height + "px * var(--doc-scale))";

    const canvas = document.createElement("canvas");
    canvas.className = "page-img";
    canvas.dataset.page = p.pageNum;
    canvas.dataset.pdfPage = p.pdfPageNum || p.pageNum;
    pageWrapper.appendChild(canvas);

    return pageWrapper;
  }

  async function renderSlicedDocument(targetPage = null) {
    if (!S.currentManifest) return;
    const container = document.getElementById("viewport-container");
    if (!container) return;

    if (S.pageObserver) S.pageObserver.disconnect();

    const fitWidth = getContainerFitWidth(container);
    const firstPageW = (S.currentManifest.pages && S.currentManifest.pages[0]) ? S.currentManifest.pages[0].width : 595;
    S.baseFitScale = fitWidth / Math.max(1, firstPageW);

    document.getElementById("zoom-text").textContent = Math.round(S.currentScale * 100) + "%";
    container.style.setProperty("--doc-scale", String(S.currentScale * S.baseFitScale));
    S.cachedRenderScale = S.currentScale;
    ST.rememberLocalFile(S.currentFileId);

    const totalPages = S.currentManifest.pages.length;
    document.getElementById("total-pages-text").textContent = "/ " + totalPages;
    document.getElementById("page-indicator").style.display = totalPages > 0 ? "flex" : "none";

    const fragment = document.createDocumentFragment();
    for (let idx = 0; idx < totalPages; idx++) {
      fragment.appendChild(createPageWrapperElement(S.currentManifest.pages[idx], idx, fitWidth));
    }

    const jumpInp = document.getElementById("jump-page-input");
    const initialPage = targetPage !== null ? targetPage : ((jumpInp ? parseInt(jumpInp.value, 10) : 1) || 1);
    const firstWrapper = fragment.querySelector("#page-wrapper-" + initialPage) || fragment.children[0];

    if (firstWrapper) {
      const firstCanvas = firstWrapper.querySelector("canvas.page-img");
      const firstPdfPage = parseInt(firstWrapper.dataset.pdfPage || firstWrapper.dataset.page, 10);
      const cachedBlob = await ST.getPageBitmap(S.currentFileId, firstPdfPage, S.cachedRenderScale);
      if (cachedBlob && firstCanvas) {
        const bmp = await createImageBitmap(cachedBlob);
        firstCanvas.width = bmp.width;
        firstCanvas.height = bmp.height;
        firstCanvas.dataset.renderedScale = String(S.cachedRenderScale);
        firstCanvas.getContext("2d").drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
      }
      buildTextLayerForWrapper(firstWrapper);
    }

    if (container.replaceChildren) {
      container.replaceChildren(fragment);
    } else {
      container.innerHTML = "";
      container.appendChild(fragment);
    }

    const exactFitW = getContainerFitWidth(container);
    S.baseFitScale = exactFitW / Math.max(1, firstPageW);
    container.style.setProperty("--doc-scale", String(S.currentScale * S.baseFitScale));
    container.querySelectorAll(".page-wrapper").forEach((w, idx) => {
      const pObj = S.currentManifest.pages[idx];
      if (pObj) {
        const pf = exactFitW / Math.max(1, pObj.width);
        w.dataset.baseFit = String(pf);
        w.style.setProperty("--doc-scale", String(S.currentScale * pf));
      }
    });

    if (firstWrapper) {
      const firstCanvas = firstWrapper.querySelector("canvas.page-img");
      const firstPdfPage = parseInt(firstWrapper.dataset.pdfPage || firstWrapper.dataset.page, 10);
      if (firstCanvas && !firstCanvas.dataset.renderedScale) {
        await renderPageToCanvas(firstCanvas, firstPdfPage);
      }
    }

    const nextWrapper = firstWrapper ? firstWrapper.nextElementSibling : null;
    if (nextWrapper && nextWrapper.classList.contains("page-wrapper")) {
      const nextCanvas = nextWrapper.querySelector("canvas.page-img");
      const nextPdfPage = parseInt(nextWrapper.dataset.pdfPage || nextWrapper.dataset.page, 10);
      if (nextCanvas && !nextCanvas.dataset.renderedScale) {
        await renderPageToCanvas(nextCanvas, nextPdfPage);
      }
    }

    U.updateLoaderProgress(100);
    container.style.visibility = "visible";
    U.hideLoading();
    SR.setSearchBoxEnabled(true);
    jumpToPageNumber(initialPage, false);

    const pendingBgPages = [];
    let bgPumpScheduled = false;
    function pumpBgPages() {
      bgPumpScheduled = false;
      if (S.isZooming || S.scrollLock) return;
      const item = pendingBgPages.shift();
      if (!item) return;
      const { wrapper, canvas, targetPdfPage } = item;
      if (wrapper.isConnected) {
        buildTextLayerForWrapper(wrapper);
        if (!U.scalesEqual(canvas.dataset.renderedScale, S.currentScale)) {
          renderPageToCanvas(canvas, targetPdfPage);
        }
      }
      if (pendingBgPages.length > 0) {
        bgPumpScheduled = true;
        requestAnimationFrame(pumpBgPages);
      }
    }

    const wrappers = Array.from(container.querySelectorAll(".page-wrapper"));
    S.pageObserver = new IntersectionObserver((entries) => {
      if (S.isZooming) return;
      entries.forEach(entry => {
        const wrapper = entry.target;
        const canvas = wrapper.querySelector("canvas.page-img");
        if (!canvas) return;
        const targetPdfPage = parseInt(wrapper.dataset.pdfPage || wrapper.dataset.page, 10);

        if (entry.isIntersecting) {
          if (wrapper === firstWrapper || wrapper === nextWrapper || wrapper.dataset.page === "1" || wrapper.dataset.page === "2") {
            buildTextLayerForWrapper(wrapper);
            if (!U.scalesEqual(canvas.dataset.renderedScale, S.currentScale)) {
              renderPageToCanvas(canvas, targetPdfPage);
            }
          } else if (!pendingBgPages.some(p => p.wrapper === wrapper)) {
            pendingBgPages.push({ wrapper, canvas, targetPdfPage });
            if (!bgPumpScheduled) {
              bgPumpScheduled = true;
              requestAnimationFrame(pumpBgPages);
            }
          }
        } else {
          const qIdx = pendingBgPages.findIndex(p => p.wrapper === wrapper);
          if (qIdx !== -1) pendingBgPages.splice(qIdx, 1);
          if (!S.scrollLock && wrapper.dataset.page !== "1") {
            removeTextLayerFromWrapper(wrapper);
            if (canvas.dataset.renderedScale) {
              canvas.width = 1;
              canvas.height = 1;
              delete canvas.dataset.renderedScale;
            }
          }
        }
      });
    }, { root: container, rootMargin: "1600px 0px" });

    wrappers.forEach(el => S.pageObserver.observe(el));
    container.removeEventListener("scroll", updateCurrentPageOnScroll);
    container.addEventListener("scroll", updateCurrentPageOnScroll, { passive: true });
  }

  // =========================================================================
  // ZOOM, SHARPEN & DOWNLOAD / SHARE
  // =========================================================================
  function zoomChange(delta, pointerX, pointerY) {
    if (!S.currentManifest) return;
    const vp = document.getElementById("viewport-container");
    if (!vp) return;

    const vpRect = vp.getBoundingClientRect();
    const panelZoom = parseFloat(window.getComputedStyle(vp.closest("#pl-dock-preview-panel") || vp).zoom) || 1.0;

    const px = (pointerX !== undefined) ? pointerX : (vpRect.left + vpRect.width / 2);
    const py = (pointerY !== undefined) ? pointerY : (vpRect.top + vpRect.height / 2);

    const prevScale = S.currentScale;
    const nextScale = Math.min(2.5, Math.max(0.4, Math.round((prevScale + delta) * 1000) / 1000));
    if (Math.abs(nextScale - prevScale) < 0.001) return;

    const anchor = findZoomAnchor(vp, px, py);

    cancelAllPageRenders();
    S.isZooming = true;
    S.currentScale = nextScale;

    vp.style.setProperty("--doc-scale", String(S.currentScale * S.baseFitScale));
    vp.querySelectorAll(".page-wrapper").forEach(w => {
      const pf = parseFloat(w.dataset.baseFit) || S.baseFitScale;
      w.style.setProperty("--doc-scale", String(S.currentScale * pf));
    });

    const zt = document.getElementById("zoom-text");
    if (zt) zt.textContent = Math.round(S.currentScale * 100) + "%";

    if (anchor && anchor.el) {
      anchor.el.offsetHeight;
      const newRect = anchor.el.getBoundingClientRect();
      const newScreenX = newRect.left + anchor.ratioX * newRect.width;
      const newScreenY = newRect.top + anchor.ratioY * newRect.height;

      vp.scrollLeft += (newScreenX - px) / panelZoom;
      vp.scrollTop += (newScreenY - py) / panelZoom;
    }

    clearTimeout(S.zoomDebounceTimer);
    S.zoomDebounceTimer = setTimeout(function() {
      S.isZooming = false;
      renderVisiblePagesOnly();
    }, 220);
  }

  function cancelAllPageRenders() {
    S.sharpenToken++;
    if (!S.activeRenderTasks) return;
    S.activeRenderTasks.forEach(function(entry) {
      try { if (entry && entry.task) entry.task.cancel(); } catch (e) {}
    });
    S.activeRenderTasks.clear();
  }

  function findZoomAnchor(vp, px, py) {
    const nodes = vp.querySelectorAll(".page-wrapper");
    if (!nodes || nodes.length === 0) return null;
    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      let dx = 0;
      if (px < r.left) dx = r.left - px;
      else if (px > r.right) dx = px - r.right;

      let dy = 0;
      if (py < r.top) dy = r.top - py;
      else if (py > r.bottom) dy = py - r.bottom;

      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { el: nodes[i], rect: r };
        if (dist === 0) break;
      }
    }

    if (!best || !best.el) return null;
    const r = best.rect;
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    return {
      el: best.el,
      ratioX: Math.min(1, Math.max(0, (px - r.left) / w)),
      ratioY: Math.min(1, Math.max(0, (py - r.top) / h))
    };
  }

  function renderVisiblePagesOnly() {
    if (!S.currentManifest || S.isZooming || S.scrollLock) return;
    const vp = document.getElementById("viewport-container");
    if (!vp) return;

    const vpRect = vp.getBoundingClientRect();
    const jobs = [];

    document.querySelectorAll(".page-wrapper").forEach(wrapper => {
      const r = wrapper.getBoundingClientRect();
      const isNearView = (r.bottom >= vpRect.top - 1200 && r.top <= vpRect.bottom + 1200);
      const canvas = wrapper.querySelector("canvas.page-img");
      if (!canvas) return;
      const targetPdfPage = parseInt(wrapper.dataset.pdfPage || wrapper.dataset.page, 10);

      if (isNearView) {
        buildTextLayerForWrapper(wrapper);
        if (!U.scalesEqual(canvas.dataset.renderedScale, S.currentScale)) {
          const mid = (r.top + r.bottom) / 2;
          const viewMid = (vpRect.top + vpRect.bottom) / 2;
          jobs.push({ canvas: canvas, targetPdfPage: targetPdfPage, dist: Math.abs(mid - viewMid) });
        }
      } else if (r.bottom < vpRect.top - 1800 || r.top > vpRect.bottom + 1800) {
        if (wrapper.dataset.page !== "1") {
          removeTextLayerFromWrapper(wrapper);
          if (canvas.dataset.renderedScale) {
            canvas.width = 1;
            canvas.height = 1;
            delete canvas.dataset.renderedScale;
          }
        }
      }
    });

    jobs.sort((a, b) => a.dist - b.dist);
    const myToken = ++S.sharpenToken;
    const scaleAtStart = S.currentScale;

    (async function() {
      for (let i = 0; i < jobs.length; i++) {
        if (myToken !== S.sharpenToken || S.isZooming || !U.scalesEqual(scaleAtStart, S.currentScale)) return;
        let live = jobs[i].canvas;
        if (!live.isConnected) {
          const wrap = document.getElementById("page-wrapper-" + live.dataset.page);
          live = wrap ? wrap.querySelector("canvas.page-img") : null;
        }
        if (!live || U.scalesEqual(live.dataset.renderedScale, S.currentScale)) continue;
        await renderPageToCanvas(live, jobs[i].targetPdfPage, scaleAtStart);
      }
    })();
  }

  function resetZoom() {
    if (!S.currentManifest) return;
    const vp = document.getElementById("viewport-container");
    const rect = vp.getBoundingClientRect();
    zoomChange(1.0 - S.currentScale, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  async function downloadPdfFromJson() {
    if (!S.currentFileId) {
      alert("Vui lòng mở một tài liệu trước khi tải về!");
      return;
    }

    U.showLoading("EXPORTING DOCUMENT", 0);
    try {
      const pdfData = await BV.pipeline.fetchPdfDirectOrFallback(S.currentFileId, (loaded, total) => {
        if (total > 0) U.updateLoaderProgress((loaded / total) * 100);
      });
      U.updateLoaderProgress(100);
      if (!pdfData || pdfData.byteLength === 0) {
        throw new Error("Không thể trích xuất dữ liệu nhị phân của file gốc.");
      }

      const blob = new Blob([pdfData], { type: "application/pdf" });
      const downloadUrl = URL.createObjectURL(blob);

      let downloadName = S.currentFileName || "TaiLieu_Drive.pdf";
      if (!downloadName.toLowerCase().endsWith(".pdf")) {
        downloadName += ".pdf";
      }

      const a = document.createElement("a");
      a.style.display = "none";
      a.href = downloadUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 2000);

      U.hideLoading();
    } catch (err) {
      U.hideLoading();
      console.error("Lỗi xuất file PDF:", err);
      if (S.currentFileId && !S.currentFileId.startsWith("local_")) {
        const slashes = String.fromCharCode(47, 47);
        window.open("https:" + slashes + "drive.google.com/uc?export=download&id=" + S.currentFileId, "_blank");
      } else {
        alert("Không thể tải file PDF: " + (err.message || err));
      }
    }
  }

  function renderPageToCanvas(canvas, targetPdfPage, lockedScale) {
    if (!canvas || S.isZooming) return Promise.resolve();
    const myEpoch = S.currentSessionEpoch;
    const renderScale = (lockedScale == null) ? S.currentScale : lockedScale;

    const prev = S.activeRenderTasks.get(targetPdfPage);
    if (prev) {
      if (U.scalesEqual(prev.scale, renderScale)) return prev.promise;
      try { if (prev.task) prev.task.cancel(); } catch (e) {}
      S.activeRenderTasks.delete(targetPdfPage);
    }

    let resolveJob;
    const promise = new Promise(function(resolve) { resolveJob = resolve; });
    const job = { task: null, scale: renderScale, promise: promise };
    S.activeRenderTasks.set(targetPdfPage, job);

    function finishJob() {
      if (S.activeRenderTasks.get(targetPdfPage) === job) S.activeRenderTasks.delete(targetPdfPage);
      resolveJob();
    }

    function ensurePdf() {
      if (S.currentPdfDoc) return Promise.resolve(S.currentPdfDoc);
      const pending = renderPageToCanvas._pdfPromise;
      if (pending && pending.epoch === S.currentSessionEpoch) return pending;
      const epoch = S.currentSessionEpoch;
      const fileId = S.currentFileId;
      const p = BV.pipeline.fetchPdfDirectOrFallback(fileId).then(function(data) {
        return pdfjsLib.getDocument({ data: data }).promise;
      }).then(function(pdf) {
        if (epoch !== S.currentSessionEpoch) {
          try { pdf.destroy(); } catch (e) {}
          throw new Error("ABORTED");
        }
        S.currentPdfDoc = pdf;
        return pdf;
      }).catch(function(err) {
        if (renderPageToCanvas._pdfPromise === p) renderPageToCanvas._pdfPromise = null;
        throw err;
      });
      p.epoch = epoch;
      renderPageToCanvas._pdfPromise = p;
      return p;
    }

    function drawPdfPage() {
      ensurePdf().then(function(pdf) {
        return pdf.getPage(targetPdfPage);
      }).then(function(page) {
        if (S.activeRenderTasks.get(targetPdfPage) !== job || myEpoch !== S.currentSessionEpoch || S.isZooming || !U.scalesEqual(renderScale, S.currentScale) || !canvas.isConnected) {
          page.cleanup();
          finishJob();
          return;
        }

        const wrapperEl = canvas.closest(".page-wrapper");
        const extraRot = parseInt((wrapperEl ? wrapperEl.dataset.rotation : "0") || "0", 10);
        const effectiveRot = (page.rotate + extraRot) % 360;

        const pageFit = parseFloat(wrapperEl?.dataset.baseFit) || S.baseFitScale || 1.0;
        const panelEl = document.getElementById("pl-dock-preview-panel");
        const panelZoom = parseFloat(window.getComputedStyle(panelEl || canvas).zoom) || 1.0;
        const rawDpr = window.devicePixelRatio || 1;

        const displayScale = renderScale * pageFit * panelZoom;
        const sharpBoost = Math.max(rawDpr * 1.35, 1.85);
        let effectiveScale = displayScale * sharpBoost;

        const vp1 = page.getViewport({ scale: 1.0, rotation: effectiveRot });
        const maxPageDim = Math.max(vp1.width, vp1.height) || 842;
        const MAX_CANVAS_PX = 4800;
        if (maxPageDim * effectiveScale > MAX_CANVAS_PX) {
          effectiveScale = MAX_CANVAS_PX / maxPageDim;
        }

        const viewport = page.getViewport({ scale: effectiveScale, rotation: effectiveRot });
        const newW = Math.max(1, Math.floor(viewport.width));
        const newH = Math.max(1, Math.floor(viewport.height));

        const offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.width = newW;
        offscreenCanvas.height = newH;
        const offCtx = offscreenCanvas.getContext("2d");
        offCtx.fillStyle = "#ffffff";
        offCtx.fillRect(0, 0, newW, newH);

        const renderTask = page.render({
          canvasContext: offCtx,
          viewport: viewport,
          intent: "display"
        });
        job.task = renderTask;

        renderTask.promise.then(function() {
          page.cleanup();
          if (S.activeRenderTasks.get(targetPdfPage) !== job || myEpoch !== S.currentSessionEpoch || S.isZooming || !U.scalesEqual(renderScale, S.currentScale) || !canvas.isConnected) {
            offscreenCanvas.width = 0;
            offscreenCanvas.height = 0;
            finishJob();
            return;
          }

          canvas.width = newW;
          canvas.height = newH;
          canvas.dataset.renderedScale = String(renderScale);
          canvas.getContext("2d").drawImage(offscreenCanvas, 0, 0);

          if (U.scalesEqual(renderScale, S.cachedRenderScale)) {
            const idleSave = window.requestIdleCallback || ((cb) => setTimeout(cb, 80));
            idleSave(() => {
              if (myEpoch === S.currentSessionEpoch && canvas.isConnected && U.scalesEqual(canvas.dataset.renderedScale, renderScale)) {
                ST.savePageBitmap(S.currentFileId, targetPdfPage, renderScale, offscreenCanvas).finally(() => {
                  offscreenCanvas.width = 0;
                  offscreenCanvas.height = 0;
                });
              } else {
                offscreenCanvas.width = 0;
                offscreenCanvas.height = 0;
              }
            });
          } else {
            offscreenCanvas.width = 0;
            offscreenCanvas.height = 0;
          }
          finishJob();
        }).catch(function() {
          try { page.cleanup(); } catch (e) {}
          offscreenCanvas.width = 0;
          offscreenCanvas.height = 0;
          finishJob();
        });
      }).catch(function() {
        finishJob();
      });
    }

    ST.getPageBitmap(S.currentFileId, targetPdfPage, renderScale).then(function(blob) {
      if (blob && canvas.isConnected && !S.isZooming && myEpoch === S.currentSessionEpoch && U.scalesEqual(renderScale, S.currentScale)) {
        paintBitmapBlob(canvas, blob, targetPdfPage, renderScale).then(finishJob).catch(finishJob);
        return;
      }
      drawPdfPage();
    }).catch(function() {
      drawPdfPage();
    });

    return promise;
  }

  function toggleFullScreen() {
    const panel = document.getElementById("pl-dock-preview-panel") || document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (panel.requestFullscreen) {
        panel.requestFullscreen().catch(() => {});
      } else if (panel.webkitRequestFullscreen) {
        panel.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }

  function updateFullscreenIconState() {
    const btn = document.getElementById("btn-fullscreen");
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (btn) {
      const icon = btn.querySelector("i");
      if (icon) icon.className = isFull ? "bi bi-fullscreen-exit" : "bi bi-fullscreen";
      btn.setAttribute("data-tip", isFull ? "Exit full screen (Esc)" : "Full screen");
    }

    const input = document.getElementById("jump-page-input");
    const activePage = parseInt(input ? input.value : "1", 10) || 1;

    setTimeout(() => {
      const tabPL = document.getElementById("tab-plhd");
      const isPreviewOpen = Boolean(tabPL && tabPL.classList.contains("split-preview-active") && S.currentFileId);
      if (!isFull && isPreviewOpen && typeof syncPrvSplitLayout_PL === "function") {
        syncPrvSplitLayout_PL();
      }
      if (window.BconsViewer && isPreviewOpen && typeof window.BconsViewer.refreshFitWidth === "function") {
        window.BconsViewer.refreshFitWidth(activePage);
      }
    }, 120);
  }

  document.addEventListener("fullscreenchange", updateFullscreenIconState);
  document.addEventListener("webkitfullscreenchange", updateFullscreenIconState);

  function copyShareLink() {
    if (!S.currentFileId || S.currentFileId.startsWith("local_")) {
      alert("Vui lòng đợi tài liệu đồng bộ xong lên Google Drive trước khi lấy link!");
      return;
    }

    const slashes = String.fromCharCode(47, 47);
    const driveUrl = "https:" + slashes + "drive.google.com/file/d/" + S.currentFileId + "/preview";
    const shareBtn = document.getElementById("btn-share-link");

    navigator.clipboard.writeText(driveUrl).then(() => {
      if (shareBtn) {
        const oldHtml = shareBtn.innerHTML;
        const oldTip = shareBtn.getAttribute("data-tip");

        shareBtn.innerHTML = '<i class="bi bi-check2" style="font-size: 13px; color: #00e676;"></i>';
        shareBtn.setAttribute("data-tip", "Copied Drive Link!");

        setTimeout(() => {
          shareBtn.innerHTML = oldHtml;
          shareBtn.setAttribute("data-tip", oldTip);
        }, 1500);
      }
    }).catch(() => {
      prompt("Copy link Google Drive:", driveUrl);
    });

    googleScriptRun.makeFilePublicAndGetLink(S.currentFileId);
  }

  // =========================================================================
  // FAVICON SEARCH NOTE (HOVER + CLICK 1 LẦN)
  // =========================================================================
  let isFaviconNoteBound = false;
  let closeFaviconNoteFn = null;

  function setupSearchFaviconNote() {
    if (isFaviconNoteBound) return;
    const panel = document.getElementById("pl-dock-preview-panel");
    const searchWrap = panel ? panel.querySelector(".search-box-wrap") : null;
    const icon = searchWrap ? searchWrap.querySelector(".search-brand-icon") : null;
    if (!panel || !searchWrap || !icon) return;

    isFaviconNoteBound = true;

    let noteEl = panel.querySelector(".search-favicon-note");
    if (!noteEl) {
      noteEl = document.createElement("div");
      noteEl.className = "search-favicon-note";
      noteEl.innerHTML = `
        <div class="sfn-list">
          <div class="sfn-row" style="font-weight: 700; color: #FFFFFF;">Double-click to <span class="sfn-key-gold">Re-digitize Document</span></div>
        </div>
        <div class="sfn-footer">Contract Digitization &amp; AI Search Tool by <b>hocnk</b></div>
      `;
      panel.appendChild(noteEl);
    }

    let isPinned = false;
    let hideTimer = null;

    function syncNotePosition() {
      const panelRect = panel.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      const wrapRect = searchWrap.getBoundingClientRect();
      if (!panelRect.width || !iconRect.width) return;

      const scaleX = panel.clientWidth / Math.max(1, panelRect.width);
      const scaleY = panel.clientHeight / Math.max(1, panelRect.height);

      const iconCenterX = ((iconRect.left + iconRect.width / 2) - panelRect.left) * scaleX;
      const wrapBottomY = (wrapRect.bottom - panelRect.top) * scaleY;
      const noteW = noteEl.offsetWidth || 270;

      const idealLeft = iconCenterX - 24;
      const clampedLeft = Math.max(12, Math.min(idealLeft, panel.clientWidth - noteW - 12));
      const arrowLeft = Math.max(14, Math.min(noteW - 22, iconCenterX - clampedLeft - 4));

      noteEl.style.top = `${Math.round(wrapBottomY + 10)}px`;
      noteEl.style.left = `${Math.round(clampedLeft)}px`;
      noteEl.style.setProperty("--arrow-left", `${Math.round(arrowLeft)}px`);
    }

    function openNote() {
      clearTimeout(hideTimer);
      syncNotePosition();
      noteEl.classList.add("show");
    }

    function closeNote(forceUnpin = false) {
      clearTimeout(hideTimer);
      if (forceUnpin) {
        isPinned = false;
        icon.classList.remove("note-pinned");
      }
      if (!isPinned) {
        noteEl.classList.remove("show");
      }
    }

    closeFaviconNoteFn = () => closeNote(true);

    icon.addEventListener("mouseenter", () => {
      if (!isPinned) openNote();
    });
    icon.addEventListener("mouseleave", () => {
      if (!isPinned) {
        hideTimer = setTimeout(() => closeNote(false), 160);
      }
    });
    noteEl.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    noteEl.addEventListener("mouseleave", () => {
      if (!isPinned) {
        hideTimer = setTimeout(() => closeNote(false), 160);
      }
    });

    icon.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPinned) {
        closeNote(true);
      } else {
        isPinned = true;
        icon.classList.add("note-pinned");
        openNote();
      }
    });

    icon.addEventListener("dblclick", () => closeNote(true));
    noteEl.addEventListener("click", (e) => e.stopPropagation());

    document.addEventListener("click", (e) => {
      if (isPinned && !noteEl.contains(e.target) && e.target !== icon) {
        closeNote(true);
      }
    });

    window.addEventListener("resize", () => {
      if (noteEl.classList.contains("show")) syncNotePosition();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSearchFaviconNote);
  } else {
    setupSearchFaviconNote();
  }

  // =========================================================================
  // ĐĂNG KÝ NỘI BỘ & PUBLIC FACADE CHO TOÀN HỆ THỐNG
  // =========================================================================
  // =========================================================================
  // MỨC 2: DROPDOWN GỢI Ý 2 DÒNG & ĐIỀU HƯỚNG PL01 DƯỚI #ai-search-input
  // =========================================================================
  let isPl01DropdownBound = false;
  let activePl01VariantCards = [];

  function escapePl01Html(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlightPl01ContextHtml(line, matchedWords, rawQuery) {
    const cleanQ = BV.pl01Index ? BV.pl01Index.normalize(rawQuery) : "";
    const qWords = cleanQ ? cleanQ.split(" ").filter(Boolean) : [];
    const targetWords = Array.from(new Set([...(matchedWords || []), ...qWords])).filter(Boolean);
    if (targetWords.length === 0) return escapePl01Html(line);

    const isSingleWord = qWords.length <= 1;
    const parts = String(line || "").split(/((?:[A-Za-zÀ-ỹ0-9]|(?<=\d)[.,](?=\d))+)/);
    return parts.map(part => {
      if (!/[A-Za-zÀ-ỹ0-9]/.test(part)) return escapePl01Html(part);
      const normPart = BV.pl01Index ? BV.pl01Index.normalize(part) : part.toLowerCase();
      const hit = targetWords.some(tw => isSingleWord ? normPart.startsWith(tw) : (normPart === tw));
      return hit
        ? `<mark class="pl01-ctx-hl">${escapePl01Html(part)}</mark>`
        : escapePl01Html(part);
    }).join("");
  }

  function ensurePl01DropdownElement() {
    const panel = document.getElementById("pl-dock-preview-panel");
    if (!panel) return null;

    let dropEl = document.getElementById("pl01-variants-dropdown");
    if (!dropEl) {
      dropEl = document.createElement("div");
      dropEl.id = "pl01-variants-dropdown";
      dropEl.className = "pl01-variants-dropdown";
      dropEl.addEventListener("click", (e) => e.stopPropagation());
      panel.appendChild(dropEl);
    }

    if (!isPl01DropdownBound) {
      isPl01DropdownBound = true;

      document.addEventListener("click", (e) => {
        const drop = document.getElementById("pl01-variants-dropdown");
        const btn = document.getElementById("btn-pl01-variants");
        if (!drop || !drop.classList.contains("show")) return;
        if (!drop.contains(e.target) && (!btn || !btn.contains(e.target))) {
          closePl01VariantsDropdown();
        }
      });

      const vp = document.getElementById("viewport-container");
      if (vp) {
        vp.addEventListener("pointerdown", () => closePl01VariantsDropdown());
      }

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" || e.key === "Esc") {
          const drop = document.getElementById("pl01-variants-dropdown");
          if (drop && drop.classList.contains("show")) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closePl01VariantsDropdown();
          }
        }
      }, true);
      const resyncOpenDropdown = () => {
        const drop = document.getElementById("pl01-variants-dropdown");
        if (drop && drop.classList.contains("show")) {
          syncPl01DropdownPosition(drop);
        }
      };
      window.addEventListener("resize", resyncOpenDropdown);
      document.addEventListener("fullscreenchange", () => setTimeout(resyncOpenDropdown, 140));
      document.addEventListener("webkitfullscreenchange", () => setTimeout(resyncOpenDropdown, 140));
    }

    return dropEl;
  }

  function syncPl01DropdownPosition(dropEl) {
    const panel = document.getElementById("pl-dock-preview-panel");
    const searchWrap = panel ? panel.querySelector(".search-box-wrap") : null;
    if (!panel || !searchWrap || !dropEl) return;

    const panelRect = panel.getBoundingClientRect();
    const wrapRect = searchWrap.getBoundingClientRect();
    if (!panelRect.width || !wrapRect.width) return;

    const scaleX = panel.clientWidth / Math.max(1, panelRect.width);
    const scaleY = panel.clientHeight / Math.max(1, panelRect.height);
    const wrapBottomY = (wrapRect.bottom - panelRect.top) * scaleY;
    const wrapRightX = (wrapRect.right - panelRect.left) * scaleX;
    const wrapW = Math.round(wrapRect.width * scaleX);

    const dropW = Math.max(240, Math.floor(Math.min(wrapW, wrapRightX - 10, panel.clientWidth - 24)));
    const fixedLeft = Math.max(10, Math.round(wrapRightX - dropW));

    dropEl.style.top = `${Math.round(wrapBottomY + 8)}px`;
    dropEl.style.left = `${fixedLeft}px`;
    dropEl.style.width = `${dropW}px`;
  }

  function renderPl01VariantsDropdown(ctx) {
    const dropEl = ensurePl01DropdownElement();
    if (!dropEl) return;

    const baseSections = (ctx && Array.isArray(ctx.sections) && ctx.sections.length > 0)
      ? ctx.sections
      : ((ctx && Array.isArray(ctx.groups) && ctx.groups.length > 0)
          ? [{ query: ctx.rawQuery || "", matched: true, groups: ctx.groups }]
          : []);

    if (baseSections.length === 0) {
      activePl01VariantCards = [];
      dropEl.innerHTML = "";
      return;
    }

    const rawSections = [
      ...baseSections.filter(s => s && s.matched),
      ...baseSections.filter(s => !s || !s.matched)
    ];

    const isMultiSection = rawSections.length > 1;
    const perSectionCap = !isMultiSection ? 8 : (rawSections.length === 2 ? 4 : 3);
    activePl01VariantCards = [];

    const htmlParts = [];
    rawSections.forEach((sec, sIdx) => {
      if (sIdx > 0) {
        htmlParts.push(`<div class="pl01-section-divider"></div>`);
      }

      if (!sec.matched) {
        htmlParts.push(`
          <div class="pl01-section-empty">
            <span class="pl01-sec-tag">#${escapePl01Html(sec.query)}</span>
            <span class="pl01-sec-unmatched">Không khớp</span>
          </div>
        `);
        return;
      }

      const dedupMap = new Map();
      (sec.groups || []).forEach(g => {
        if (!dedupMap.has(g.normKey)) {
          dedupMap.set(g.normKey, g);
        }
      });
      const cards = Array.from(dedupMap.values()).slice(0, perSectionCap);

      if (cards.length === 0) {
        htmlParts.push(`
          <div class="pl01-section-empty">
            <span class="pl01-sec-tag">#${escapePl01Html(sec.query)}</span>
            <span class="pl01-sec-unmatched">Không khớp</span>
          </div>
        `);
        return;
      }

      if (isMultiSection) {
        htmlParts.push(`<div class="pl01-section-label">#${escapePl01Html(sec.query)}</div>`);
      }

      cards.forEach(g => {
        const cardIdx = activePl01VariantCards.length;
        activePl01VariantCards.push({
          ...g,
          sectionIdx: (g.sectionIdx !== undefined) ? g.sectionIdx : sIdx,
          sectionQuery: sec.query
        });

        const tierClass = g.pct === 100 ? "tier-100" : (g.pct === 75 ? "tier-75" : "tier-50");
        const extraHTML = g.extraLocations > 0
          ? `<span class="pl01-extra-loc">(+${g.extraLocations} vị trí khác)</span>`
          : "";
        const ctxHtml = highlightPl01ContextHtml(g.bestContextLine, g.matchedWords, sec.query || ctx.rawQuery);

        htmlParts.push(`
          <div class="pl01-variant-card" onclick="selectPl01VariantCard(${cardIdx})">
            <div class="pl01-card-row1">
              <span class="pl01-tier-badge ${tierClass}">${g.pct}%</span>
              <span class="pl01-key-text">${escapePl01Html(g.keyText)}</span>
              <span class="pl01-meta-text">Tr. ${g.firstPage} (x${g.count})</span>
            </div>
            <div class="pl01-card-row2">${ctxHtml}${extraHTML}</div>
          </div>
        `);
      });
    });

    dropEl.innerHTML = htmlParts.join("");
  }

  function openPl01VariantsDropdown() {
    const dropEl = ensurePl01DropdownElement();
    const btn = document.getElementById("btn-pl01-variants");
    if (!dropEl || activePl01VariantCards.length === 0) return;
    syncPl01DropdownPosition(dropEl);
    dropEl.classList.add("show");
    if (btn) btn.classList.add("open");
  }

  function closePl01VariantsDropdown() {
    const dropEl = document.getElementById("pl01-variants-dropdown");
    const btn = document.getElementById("btn-pl01-variants");
    if (dropEl) dropEl.classList.remove("show");
    if (btn) btn.classList.remove("open");
  }

  function togglePl01VariantsDropdown(e) {
    if (e) e.stopPropagation();
    const dropEl = document.getElementById("pl01-variants-dropdown");
    if (dropEl && dropEl.classList.contains("show")) {
      closePl01VariantsDropdown();
    } else {
      if (S.activePl01Context) renderPl01VariantsDropdown(S.activePl01Context);
      openPl01VariantsDropdown();
    }
  }

  async function selectPl01VariantCard(idx) {
    const card = activePl01VariantCards[idx];
    if (!card) return;
    const inp = document.getElementById("ai-search-input");
    if (inp) inp.value = card.keyText;
    closePl01VariantsDropdown();

    const excludeKeys = [];
    if (S.activePl01Context && Array.isArray(S.activePl01Context.groups)) {
      const cardNormPad = " " + card.normKey + " ";
      S.activePl01Context.groups.forEach(g => {
        if (card.sectionIdx !== undefined && g.sectionIdx !== undefined && g.sectionIdx !== card.sectionIdx) {
          return;
        }
        if (g.pct > card.pct && g.normKey && g.normKey !== card.normKey) {
          const gNormPad = " " + g.normKey + " ";
          if (gNormPad.includes(cardNormPad)) {
            excludeKeys.push(g.keyText);
          }
        }
      });
    }

    await SR.executeSearch({
      preferPl01: true,
      preferPage: card.firstPage,
      excludeKeys: excludeKeys
    });
  }

  function resetPl01VariantsUI() {
    const btn = document.getElementById("btn-pl01-variants");
    if (btn) {
      btn.style.display = "none";
      btn.classList.remove("open");
    }
    activePl01VariantCards = [];
    const dropEl = document.getElementById("pl01-variants-dropdown");
    if (dropEl) {
      dropEl.classList.remove("show");
      dropEl.innerHTML = "";
    }
  }

  async function applyPl01SearchContextIfAny() {
    const ctx = S.pendingPl01Context;
    S.pendingPl01Context = null;
    S.activePl01Context = ctx || null;

    if (!ctx || !ctx.rawQuery) {
      resetPl01VariantsUI();
      return;
    }

    const inp = document.getElementById("ai-search-input");
    if (inp) inp.value = ctx.rawQuery;

    const foundMatches = await SR.executeSearch({ preferPl01: true, silentNotFound: true });
    const hasGroups = Array.isArray(ctx.groups) && ctx.groups.length > 0;
    const isMultiSection = Array.isArray(ctx.sections) && ctx.sections.length > 1;
    const btn = document.getElementById("btn-pl01-variants");

    if (foundMatches && foundMatches.length > 0) {
      closePl01VariantsDropdown();
      const showCaret = Boolean(isMultiSection || ctx.hasLowerTier || ctx.groups.some(g => g.pct < 100));
      if (btn) btn.style.display = (showCaret && hasGroups) ? "inline-flex" : "none";
      if (showCaret && hasGroups) renderPl01VariantsDropdown(ctx);
    } else {
      if (btn) btn.style.display = hasGroups ? "inline-flex" : "none";
      if (hasGroups) {
        renderPl01VariantsDropdown(ctx);
        openPl01VariantsDropdown();
      }
    }
  }

  window.togglePl01VariantsDropdown = togglePl01VariantsDropdown;
  window.selectPl01VariantCard = selectPl01VariantCard;

  // =========================================================================
  // ĐĂNG KÝ NỘI BỘ & PUBLIC FACADE CHO TOÀN HỆ THỐNG
  // =========================================================================
  BV.ui = {
    buildTextLayerForWrapper,
    renderPageToCanvas,
    updatePageIndicatorUI,
    renderSlicedDocument,
    setupSearchFaviconNote,
    setupHandToolPanning,
    setupCtrlWheelZoom,
    setupTouchPinchZoom,
    setupSmartClipboardCopy,
    applyPl01SearchContextIfAny,
    resetPl01VariantsUI
  };

  window.handleSmartScrollUp = handleSmartScrollUp;
  window.handleSmartScrollDown = handleSmartScrollDown;
  window.handleSearchKey = SR.handleSearchKey;
  window.handleSearchInput = SR.handleSearchInput;
  window.handleSearchSubmit = SR.handleSearchSubmit;
  window.navigateMatch = SR.navigateMatch;
  window.zoomChange = zoomChange;
  window.resetZoom = resetZoom;
  window.handlePageJumpKey = handlePageJumpKey;
  window.toggleFullScreen = toggleFullScreen;
  window.downloadPdfFromJson = downloadPdfFromJson;
  window.copyShareLink = copyShareLink;

  window.forceRedigitizeCurrentFile = function() {
    if (!S.currentFileId) return;

    if (BV.pipeline.isPlOrPdgFile(S.currentFileName)) {
      if (typeof showToast_PL === "function") {
        showToast_PL("⚠️ Tài liệu này đang mở ở chế độ Xem trực tiếp, không áp dụng số hóa lại.", "error");
      }
      return;
    }

    S.AUTO_REPAIR_ATTEMPTED.delete(S.currentFileId);
    S.currentSessionEpoch++;
    delete S.SESSION_MANIFEST_CACHE[S.currentFileId];

    SR.setSearchBoxEnabled(false);
    cancelAllPageRenders();
    if (S.pageObserver) {
      S.pageObserver.disconnect();
      S.pageObserver = null;
    }
    SR.clearSearchState();

    const vp = document.getElementById("viewport-container");
    if (vp) {
      vp.style.visibility = "hidden";
      vp.innerHTML = "";
    }
    const pageInd = document.getElementById("page-indicator");
    if (pageInd) pageInd.style.display = "none";

    U.showLoading("DIGITIZING DOCUMENT", 0);
    BV.pipeline.processAndOptimizeFileJIT(S.currentFileId);
  };

  window.BconsViewer = {
    pl01Index: BV.pl01Index,
    shouldDigitizeFile: function(fileName, maHD) {
      if (!fileName || !/\.pdf$/i.test(fileName)) return false;
      if (maHD && /^PL\d+/i.test(String(maHD).trim())) return false;
      return !BV.pipeline.isPlOrPdgFile(fileName);
    },
    prepareDigitizedUploadPdf: function(fileObj, onProgress, preloadedBuffer) {
      return BV.pipeline.prepareDigitizedUploadPdf(fileObj, onProgress, preloadedBuffer);
    },
    commitDigitizedUploadCache: function(fileId, fileName, manifest, pdfBuffer) {
      return BV.pipeline.commitDigitizedUploadCache(fileId, fileName, manifest, pdfBuffer);
    },
    purgeLocalCacheForFile: async function(fileId) {
      if (!fileId) return;
      delete S.SESSION_MANIFEST_CACHE[fileId];
      const lruIdx = S.SESSION_LRU_KEYS.indexOf(fileId);
      if (lruIdx !== -1) S.SESSION_LRU_KEYS.splice(lruIdx, 1);
      S.AUTO_REPAIR_ATTEMPTED.delete(fileId);
      if (BV.pl01Index && BV.pl01Index.state) {
        const rec = BV.pl01Index.state.byFileId.get(fileId);
        if (rec && rec.maHD) BV.pl01Index.state.byMaHD.delete(rec.maHD.toUpperCase());
        BV.pl01Index.state.byFileId.delete(fileId);
      }
      await Promise.all([
        ST.deleteLocalManifest(fileId),
        ST.deleteLocalPdfBinary(fileId),
        ST.clearFilePageBitmaps(fileId)
      ]).catch(() => {});
    },
    redigitizeAll: function(options) {
      return BV.pipeline.redigitizeAllContracts(options);
    },
    stopRedigitizeAll: function() {
      return BV.pipeline.stopRedigitizeAllContracts();
    },
    getActivePl01Context: function() {
      return S.activePl01Context || null;
    },
    applyPl01Context: function(ctx) {
      S.pendingPl01Context = ctx || null;
      return applyPl01SearchContextIfAny();
    },
    setTransitionGate: function(promise) {
      S.isPanelTransitioning = true;
      S.transitionWaitPromise = Promise.resolve(promise).finally(() => {
        S.isPanelTransitioning = false;
      });
    },
    abortActiveTasks: function() {
      S.currentSessionEpoch++;
      S.isPanelTransitioning = false;
      S.transitionWaitPromise = Promise.resolve();
      SR.setSearchBoxEnabled(false);
      if (S.activeFetchAbortController) {
        S.activeFetchAbortController.abort();
        S.activeFetchAbortController = null;
      }
      cancelAllPageRenders();
      U.hideLoading();
    },
    warmToken: function() {
      if (!S.cachedDriveToken || Date.now() >= S.driveTokenExpiresAt) {
        BV.pipeline.getDriveTokenAsync().catch(() => {});
      }
    },
    loadFile: function(fileId, fileName, sizeMB, pl01Context) {
      BV.pipeline.loadFile(fileId, fileName, sizeMB, pl01Context);
    },
    search: function(keyword) {
      const input = document.getElementById("ai-search-input");
      if (input) {
        input.value = keyword;
        SR.executeSearch();
      }
    },
    jumpToPage: function(p) {
      jumpToPageNumber(p, true);
    },
    refreshFitWidth: function(anchorPage) {
      if (!S.currentManifest || !S.currentManifest.pages.length) return;
      const container = document.getElementById("viewport-container");
      if (!container) return;

      const input = document.getElementById("jump-page-input");
      const targetPage = anchorPage || (input ? parseInt(input.value, 10) : 1) || 1;

      const oldFit = S.baseFitScale;
      const exactFitW = getContainerFitWidth(container);
      const firstPageW = S.currentManifest.pages[0].width || 595;
      S.baseFitScale = exactFitW / Math.max(1, firstPageW);
      container.style.setProperty("--doc-scale", String(S.currentScale * S.baseFitScale));
      container.querySelectorAll(".page-wrapper").forEach((w, idx) => {
        const pObj = S.currentManifest.pages[idx];
        if (pObj) {
          const pf = exactFitW / Math.max(1, pObj.width);
          w.dataset.baseFit = String(pf);
          w.style.setProperty("--doc-scale", String(S.currentScale * pf));
        }
      });

      jumpToPageNumber(targetPage, false);

      const panelEl = document.getElementById("pl-dock-preview-panel");
      const curZoom = parseFloat(window.getComputedStyle(panelEl || container).zoom) || 1.0;
      const zoomChanged = (window.BconsViewer._lastZoom !== undefined && window.BconsViewer._lastZoom !== curZoom);
      window.BconsViewer._lastZoom = curZoom;

      if (Math.abs(S.baseFitScale - oldFit) > 0.02 || zoomChanged) {
        cancelAllPageRenders();
        container.querySelectorAll("canvas.page-img").forEach(c => {
          delete c.dataset.renderedScale;
        });
        renderVisiblePagesOnly();
      }
    },
    close: function() {
      if (closeFaviconNoteFn) closeFaviconNoteFn();
      resetPl01VariantsUI();
      S.pendingPl01Context = null;
      S.activePl01Context = null;
      S.currentSessionEpoch++;
      if (S.activeFetchAbortController) {
        S.activeFetchAbortController.abort();
        S.activeFetchAbortController = null;
      }
      U.hideLoading();
      U.setAntiExitGuard(false);
      cancelAllPageRenders();
      if (S.pageObserver) {
        S.pageObserver.disconnect();
        S.pageObserver = null;
      }
      if (S.currentPdfDoc) {
        try { S.currentPdfDoc.destroy(); } catch (e) {}
        S.currentPdfDoc = null;
      }
      S.currentManifest = null;
      S.currentFileId = null;
      const vp = document.getElementById("viewport-container");
      if (vp) {
        vp.innerHTML = "";
        vp.style.visibility = "visible";
      }
      const pageInd = document.getElementById("page-indicator");
      if (pageInd) pageInd.style.display = "none";
      SR.clearSearchState();
      U.stopBackgroundKeepAlive();
    }
  };
})();