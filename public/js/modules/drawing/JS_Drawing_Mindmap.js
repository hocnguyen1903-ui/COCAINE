// =========================================================================
// MODULE: DRAWING 2/4 - CYTOSCAPE MINDMAP, LAYOUT, LIMITER, PIN & FLASH
// =========================================================================

(() => {
  const BD = window.__BconsDrawing;
  const S = BD.state;
  const C = BD.const;

  function flashNode_Drawing(node) {
    if (node.scratch("flashInterval")) {
      clearInterval(node.scratch("flashInterval"));
      node.removeStyle("border-color border-width");
    }

    let count = 0;
    const flashColor = "#00fbff";
    const flashWidth = "4px";

    const intervalId = setInterval(() => {
      if (count % 2 === 0) {
        node.style({ "border-color": flashColor, "border-width": flashWidth });
      } else {
        node.removeStyle("border-color border-width");
      }
      count++;

      if (count >= 10) {
        clearInterval(intervalId);
        node.removeStyle("border-color border-width");
        node.removeScratch("flashInterval");
      }
    }, 500);

    node.scratch("flashInterval", intervalId);
  }

  function enforceBidirectionalLayout() {
    const cy = S.cyInstance;
    if (!cy) return;

    const rootNode = cy.getElementById("root");
    if (rootNode.length === 0) return;
    const rootPos = rootNode.position();
    const Y_root = rootPos.y;

    const branchProposal = cy.getElementById("branch_proposal");
    const branchGoc = cy.getElementById("branch_goc");
    const branchUpdate = cy.getElementById("branch_update");

    // 1. Cụm bên trái: Lật trục X và sắp xếp ngày nội bộ
    const leftBranchIds = ["branch_proposal", "branch_goc"];
    leftBranchIds.forEach(branchId => {
      const branch = cy.getElementById(branchId);
      if (branch.length === 0) return;

      const leftElements = branch.union(branch.successors());
      leftElements.forEach(el => {
        if (el.isNode()) {
          const currentX = el.position("x");
          if (currentX > rootPos.x) {
            const diffX = currentX - rootPos.x;
            el.position("x", rootPos.x - diffX);
          }
        }
      });

      const dateNodes = branch.outgoers("node").filter(n => n.data("isDate"));
      if (dateNodes.length > 1) {
        const sortedDateNodes = dateNodes.toArray().sort((a, b) => {
          return (b.data("sortValue") || 0) - (a.data("sortValue") || 0);
        });

        const allElements = dateNodes.union(dateNodes.successors());
        let currentY = allElements.boundingBox().y1;

        sortedDateNodes.forEach(dateNode => {
          const cluster = dateNode.union(dateNode.successors());
          const clusterBB = cluster.boundingBox();
          const diffY = currentY - clusterBB.y1;

          cluster.forEach(el => {
            if (el.isNode()) el.position("y", el.position("y") + diffY);
          });
          currentY += clusterBB.h + 20;
        });
      }
    });

    // 2. Cân đối cánh trái: Root nằm chính giữa Đề xuất và TKTC
    if (branchProposal.length > 0 && branchGoc.length > 0) {
      const propDates = branchProposal.outgoers("node").filter(n => n.data("isDate"));
      const propCluster = propDates.length > 0 ? propDates.union(propDates.successors()) : branchProposal;
      const propBB = propCluster.boundingBox();

      const gocDates = branchGoc.outgoers("node").filter(n => n.data("isDate"));
      const gocCluster = gocDates.length > 0 ? gocDates.union(gocDates.successors()) : branchGoc;
      const gocBB = gocCluster.boundingBox();

      const minCenterDist = Math.max(120, propBB.h / 2 + gocBB.h / 2 + 40);
      const halfDist = minCenterDist / 2;

      const targetPropY = Y_root - halfDist;
      branchProposal.position("y", targetPropY);
      if (propDates.length > 0) {
        const diffY = targetPropY - (propBB.y1 + propBB.h / 2);
        propCluster.forEach(el => { if (el.isNode()) el.position("y", el.position("y") + diffY); });
      }

      const targetGocY = Y_root + halfDist;
      branchGoc.position("y", targetGocY);
      if (gocDates.length > 0) {
        const diffY = targetGocY - (gocBB.y1 + gocBB.h / 2);
        gocCluster.forEach(el => { if (el.isNode()) el.position("y", el.position("y") + diffY); });
      }
    } else if (branchProposal.length > 0) {
      branchProposal.position("y", Y_root);
      const propDates = branchProposal.outgoers("node").filter(n => n.data("isDate"));
      if (propDates.length > 0) {
        const propCluster = propDates.union(propDates.successors());
        const diffY = Y_root - (propCluster.boundingBox().y1 + propCluster.boundingBox().h / 2);
        propCluster.forEach(el => { if (el.isNode()) el.position("y", el.position("y") + diffY); });
      }
    } else if (branchGoc.length > 0) {
      branchGoc.position("y", Y_root);
      const gocDates = branchGoc.outgoers("node").filter(n => n.data("isDate"));
      if (gocDates.length > 0) {
        const gocCluster = gocDates.union(gocDates.successors());
        const diffY = Y_root - (gocCluster.boundingBox().y1 + gocCluster.boundingBox().h / 2);
        gocCluster.forEach(el => { if (el.isNode()) el.position("y", el.position("y") + diffY); });
      }
    }

    // 3. Cụm bên phải (Bản vẽ cập nhật)
    if (branchUpdate.length > 0) {
      branchUpdate.position("y", Y_root);

      const dateNodes = branchUpdate.outgoers("node").filter(n => n.data("isDate"));
      if (dateNodes.length > 0) {
        if (dateNodes.length > 1) {
          const sortedDateNodes = dateNodes.toArray().sort((a, b) => {
            return (b.data("sortValue") || 0) - (a.data("sortValue") || 0);
          });

          const allElements = dateNodes.union(dateNodes.successors());
          let currentY = allElements.boundingBox().y1;

          sortedDateNodes.forEach(dateNode => {
            const cluster = dateNode.union(dateNode.successors());
            const clusterBB = cluster.boundingBox();
            const diffY = currentY - clusterBB.y1;

            cluster.forEach(el => {
              if (el.isNode()) el.position("y", el.position("y") + diffY);
            });
            currentY += clusterBB.h + 20;
          });
        }

        const allRightElements = dateNodes.union(dateNodes.successors());
        const rightBB = allRightElements.boundingBox();
        const rightCenterY = rightBB.y1 + rightBB.h / 2;
        const diffCenterY = Y_root - rightCenterY;

        allRightElements.forEach(el => {
          el.position("y", el.position("y") + diffCenterY);
        });
      }
    }
  }

  function renderMindmap(projectCode, forceRefresh = false) {
    const localLoader = document.getElementById("drawing-local-loader");
    const cyArea = document.getElementById("cy");
    const projKey = (projectCode || "").toUpperCase().trim();

    if (!forceRefresh && S.projectFullDataCache_Drawing[projKey]) {
      const cachedData = S.projectFullDataCache_Drawing[projKey];
      S.currentlyRenderedProject = projectCode;
      S.drawingTaskCache = {};

      cachedData.files.forEach(f => { S.drawingTaskCache[f.fileId] = []; });
      cachedData.tasks.forEach(task => {
        if (S.drawingTaskCache[task.fileId] !== undefined) {
          S.drawingTaskCache[task.fileId].push(task);
        }
      });

      S.projectFilesCache_Drawing[projKey] = cachedData.files;
      drawCytoscapeGraph(projectCode, cachedData.files, cyArea, localLoader);
      return;
    }

    if (localLoader) localLoader.style.display = "flex";
    cyArea.style.opacity = "0";

    callBackend("getProjectDrawingFullData", projectCode).then(fullData => {
      if (!fullData || !fullData.files) {
        throw new Error("Không nhận được dữ liệu cấu trúc bản vẽ từ máy chủ!");
      }

      S.projectFullDataCache_Drawing[projKey] = fullData;
      S.currentlyRenderedProject = projectCode;
      S.projectFilesCache_Drawing[projKey] = fullData.files;

      S.drawingTaskCache = {};
      fullData.files.forEach(f => { S.drawingTaskCache[f.fileId] = []; });
      fullData.tasks.forEach(task => {
        if (S.drawingTaskCache[task.fileId] !== undefined) {
          S.drawingTaskCache[task.fileId].push(task);
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

  function drawCytoscapeGraph(projectCode, filesList, cyArea, localLoader) {
    if (S.cyInstance) { S.cyInstance.destroy(); S.cyInstance = null; }
    cyArea.innerHTML = "";

    setTimeout(() => {
      const cy = (S.cyInstance = cytoscape({
        container: cyArea,
        elements: buildCytoscapeElements({ projectCode: projectCode, files: filesList }),
        pixelRatio: 2,
        autoungrabify: true,
        userPanningEnabled: true,
        userZoomingEnabled: true,
        style: [
          {
            selector: "node",
            style: {
              "background-color": "#021a31",
              "label": "data(label)",
              "color": "#fff",
              "font-family": "Poppins, sans-serif",
              "font-size": 18,
              "font-weight": "bold",
              "text-valign": "center",
              "text-halign": "center",
              "width": 220,
              "height": 68,
              "shape": "round-rectangle",
              "border-width": 1.5,
              "border-color": "#FFBA08",
              "text-wrap": "wrap",
              "text-max-width": 180,
              "line-height": 1.4,
              "overlay-opacity": 0
            }
          },
          {
            selector: 'node[id="root"]',
            style: {
              "font-size": 24,
              "font-weight": "800",
              "color": "#FFBA08",
              "background-color": "#021a31",
              "background-opacity": 0.95,
              "width": 125,
              "height": 110,
              "shape": "hexagon",
              "border-style": "double",
              "border-width": 4,
              "border-color": "#FFBA08",
              "text-valign": "center",
              "text-halign": "center"
            }
          },
          {
            selector: "node[?isDept]",
            style: {
              "width": 60,
              "height": 40,
              "font-size": 18,
              "background-color": "#021a31",
              "border-color": "data(color)",
              "border-width": 1.5,
              "color": "data(color)",
              "font-weight": "bold"
            }
          },
          {
            selector: "node[?fileId]",
            style: {
              "background-color": "#293e5b",
              "border-width": 1.5,
              "border-color": "data(color)",
              "font-size": 18,
              "font-weight": "normal",
              "text-wrap": "wrap",
              "text-max-width": 200,
              "width": 240,
              "height": 100,
              "text-valign": "center",
              "line-height": 1.4,
              "color": (el) => el.data("color").toUpperCase() === "#FFBA08" ? "#FFFFFF" : el.data("color"),
              "bounds-expansion": 28,
              "background-image": C.PIN_DIM_SVG,
              "background-clip": "none",
              "background-fit": "none",
              "background-width": "34px",
              "background-height": "34px",
              "background-position-x": "50%",
              "background-position-y": "-17px",
              "background-image-containment": "over"
            }
          },
          {
            selector: "node[?isPinned]",
            style: {
              "border-width": 1.5,
              "border-color": "#2ECC71",
              "border-style": "solid",
              "background-image": C.PIN_ACTIVE_SVG
            }
          },
          {
            selector: "node[?isExpandBtn][!isDate]",
            style: {
              "width": 240,
              "height": 36,
              "shape": "round-rectangle",
              "background-color": "#FFBA08",
              "background-opacity": 0.2,
              "border-width": 1.5,
              "border-style": "dashed",
              "border-color": "#FFBA08",
              "color": "#FFBA08",
              "font-size": 14.5,
              "font-weight": "600",
              "text-valign": "center",
              "text-halign": "center",
              "overlay-opacity": 0
            }
          },
          {
            selector: "node[?isDate]",
            style: {
              "width": 125,
              "height": 44,
              "background-opacity": 0,
              "border-color": "#FFBA08",
              "border-width": 1.5,
              "font-size": 18,
              "font-weight": "bold",
              "color": "#FFBA08",
              "shape": "round-rectangle",
              "text-valign": "center",
              "text-halign": "center"
            }
          },
          {
            selector: "edge",
            style: {
              "width": 1.5,
              "line-color": "data(color)",
              "curve-style": "taxi",
              "taxi-direction": "horizontal",
              "target-arrow-shape": "data(arrowShape)",
              "target-arrow-color": "data(color)",
              "line-opacity": 0.8
            }
          },
          {
            selector: "node:selected",
            style: {
              "background-color": "#FFBA08",
              "background-opacity": 0.2,
              "border-width": (el) => el.style("border-width")
            }
          }
        ]
      }));

      // 1. Thu gọn nhánh TKTC mặc định
      const branchGoc = cy.getElementById("branch_goc");
      if (branchGoc.length > 0 && branchGoc.successors().length > 0) {
        branchGoc.data("collapsed", true);
        branchGoc.data("originalLabel", branchGoc.data("label"));
        branchGoc.data("label", branchGoc.data("originalLabel") + " [ + ]");
        branchGoc.scratch("hiddenElements", branchGoc.successors());
        cy.remove(branchGoc.successors());
      }

      // 2. Giới hạn tối đa 6 file mới nhất cho nhánh Cập nhật & Đề xuất
      setupBranchLimiter_Drawing(cy, "branch_update");
      setupBranchLimiter_Drawing(cy, "branch_proposal");

      cy.resize();

      const dagreSortFunc = (a, b) => {
        const getPri = (n) => {
          if (n.id() === "root") return 1;
          if (["branch_goc", "branch_update", "branch_proposal"].includes(n.id())) return 2;
          if (n.data("isDate")) return 3;
          if (n.id().includes("_Thân") || n.id().includes("_Hầm")) return 4;
          if (n.data("isDept")) return 5;
          if (n.data("isExpandBtn")) return 7;
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
      };

      cy.layout({
        name: "dagre",
        rankDir: "LR",
        nodeSep: 45,
        rankSep: 80,
        animate: false,
        fit: true,
        padding: 20,
        sort: dagreSortFunc,
        stop: () => {
          enforceBidirectionalLayout();
          if (localLoader) localLoader.style.display = "none";
          cyArea.style.opacity = "1";
          cy.resize();
          cy.fit(null, 20);
        }
      }).run();

      // Mở rộng / thu gọn nhánh TKTC
      cy.on("tap", "node#branch_goc", function(evt) {
        const node = evt.target;
        const isCollapsed = node.data("collapsed");

        cy.nodes().forEach(n => n.scratch("startPos", { ...n.position() }));
        const startZoom = cy.zoom();
        const startPan = { ...cy.pan() };

        if (isCollapsed) {
          const hiddenElements = node.scratch("hiddenElements");
          if (hiddenElements) {
            cy.add(hiddenElements);
            const parentPos = node.position();
            hiddenElements.forEach(el => {
              if (el.isNode()) {
                el.position({ x: parentPos.x, y: parentPos.y });
                el.scratch("startPos", { x: parentPos.x, y: parentPos.y });
              }
            });
          }
          node.data("collapsed", false);
          node.data("label", node.data("originalLabel") + " [ - ]");
        } else {
          if (node.successors().length === 0) return;
          node.data("collapsed", true);
          node.data("label", node.data("originalLabel") + " [ + ]");
          node.scratch("hiddenElements", node.successors());
          cy.remove(node.successors());
          window.closeFileDetail();
        }

        cy.layout({
          name: "dagre",
          rankDir: "LR",
          nodeSep: 45,
          rankSep: 80,
          animate: false,
          fit: false,
          padding: 20,
          sort: dagreSortFunc,
          stop: () => {
            enforceBidirectionalLayout();
            animateGraphTransition_Drawing(startZoom, startPan);
          }
        }).run();
      });

      // Mở rộng / thu gọn bản vẽ cũ
      cy.on("tap", "node[?isExpandBtn]", function(evt) {
        const targetNode = evt.target;
        const branchId = targetNode.data("branchId");
        const btn = cy.getElementById("btn_expand_" + branchId);
        const dateBtn = cy.getElementById("date_expand_" + branchId);
        const isExpanded = btn.data("expanded");
        const hiddenElements = btn.scratch("hiddenElements");
        if (!hiddenElements) return;

        cy.nodes().forEach(n => n.scratch("startPos", { ...n.position() }));
        const startZoom = cy.zoom();
        const startPan = { ...cy.pan() };

        if (!isExpanded) {
          cy.add(hiddenElements);
          btn.data("expanded", true);
          btn.data("label", "Thu gọn bản vẽ cũ");
          if (dateBtn.length > 0) dateBtn.data("label", "-");
        } else {
          btn.data("expanded", false);
          btn.data("label", `Xem thêm ${btn.data("hiddenCount")} bản vẽ cũ...`);
          if (dateBtn.length > 0) dateBtn.data("label", "+");
          cy.remove(hiddenElements);
          window.closeFileDetail();
        }

        cy.layout({
          name: "dagre",
          rankDir: "LR",
          nodeSep: 45,
          rankSep: 80,
          animate: false,
          fit: false,
          padding: 20,
          sort: dagreSortFunc,
          stop: () => {
            enforceBidirectionalLayout();
            animateGraphTransition_Drawing(startZoom, startPan);
          }
        }).run();
      });

      // Click chọn Node & Ghim
      cy.on("tap", "node", (evt) => {
        const node = evt.target;
        if (node.data("isExpandBtn")) return;
        const fileId = node.data("fileId");
        if (!fileId) return;

        const nodePos = node.position();
        const topPinY = nodePos.y - (node.height() / 2);
        const pinX = nodePos.x;
        const clickDist = Math.hypot(evt.position.x - pinX, evt.position.y - topPinY);

        if (clickDist <= 22) {
          togglePinNode_Drawing(fileId);
        }

        cy.$(":selected").unselect();
        node.select();
        window.updatePanelContent(node.data());
      });

      cy.on("dbltap", "node", (evt) => {
        if (evt.target.data("fileId") && evt.target.data("url") !== "#") {
          window.open(evt.target.data("url"), "_blank");
        }
      });
      cy.on("mouseover", "node[?fileId]", () => document.getElementById("cy").style.cursor = "pointer");
      cy.on("mouseout", "node[?fileId]", () => document.getElementById("cy").style.cursor = "default");
      cy.on("mouseover", "node[?isExpandBtn]", () => document.getElementById("cy").style.cursor = "pointer");
      cy.on("mouseout", "node[?isExpandBtn]", () => document.getElementById("cy").style.cursor = "default");
      cy.on("mouseover", "node#branch_goc", () => document.getElementById("cy").style.cursor = "pointer");
      cy.on("mouseout", "node#branch_goc", () => document.getElementById("cy").style.cursor = "default");
    }, 100);
  }

  function setupBranchLimiter_Drawing(cy, branchId) {
    const branch = cy.getElementById(branchId);
    if (branch.length === 0) return;

    const fileNodes = branch.successors("node[?fileId]").toArray().sort((a, b) => {
      return (b.data("sortValue") || 0) - (a.data("sortValue") || 0);
    });

    if (fileNodes.length <= 6) return;

    const hiddenFiles = fileNodes.slice(6);
    const hiddenFileIds = new Set(hiddenFiles.map(f => f.id()));

    const dateNodes = branch.outgoers("node").filter(n => n.data("isDate"));
    const hiddenDateNodes = [];
    dateNodes.forEach(dNode => {
      const childFiles = dNode.outgoers("node[?fileId]").toArray();
      if (childFiles.length > 0 && childFiles.every(f => hiddenFileIds.has(f.id()))) {
        hiddenDateNodes.push(dNode);
      }
    });

    let elementsToHide = cy.collection();
    hiddenFiles.forEach(f => {
      elementsToHide = elementsToHide.union(f).union(f.connectedEdges());
    });
    hiddenDateNodes.forEach(d => {
      elementsToHide = elementsToHide.union(d).union(d.connectedEdges());
    });

    const hiddenCount = hiddenFiles.length;
    const dateBtnId = "date_expand_" + branchId;
    const btnId = "btn_expand_" + branchId;

    cy.add([
      {
        group: "nodes",
        selectable: false,
        data: {
          id: dateBtnId,
          label: "+",
          isDate: true,
          isExpandBtn: true,
          branchId: branchId,
          expanded: false,
          hiddenCount: hiddenCount,
          sortValue: -999999
        }
      },
      {
        group: "nodes",
        selectable: false,
        data: {
          id: btnId,
          label: `Xem thêm ${hiddenCount} bản vẽ cũ...`,
          isExpandBtn: true,
          branchId: branchId,
          expanded: false,
          hiddenCount: hiddenCount,
          sortValue: -999999
        }
      },
      {
        group: "edges",
        data: {
          id: "edge_main_" + btnId,
          source: branchId,
          target: dateBtnId,
          color: "#FFBA08",
          arrowShape: "none"
        }
      },
      {
        group: "edges",
        data: {
          id: "edge_file_" + btnId,
          source: dateBtnId,
          target: btnId,
          color: "#FFBA08",
          arrowShape: "triangle"
        }
      }
    ]);

    const btnNode = cy.getElementById(btnId);
    const dateBtnNode = cy.getElementById(dateBtnId);
    btnNode.scratch("hiddenElements", elementsToHide);
    dateBtnNode.scratch("hiddenElements", elementsToHide);

    cy.remove(elementsToHide);
  }

  function animateGraphTransition_Drawing(startZoom, startPan) {
    const cy = S.cyInstance;
    if (!cy) return;

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

  function buildCytoscapeElements(data) {
    let elements = [], addedNodes = new Set();
    const GOLD = "#FFBA08", DEPT_COLORS = { STR: "#BCC6CC", ARC: "#50C878", MEP: "#CD7F32", "KHÁC": GOLD };

    function addNode(id, label, parentId, nodeColor, fileId = null, url = null, isDept = false, isDate = false, type = null, fullName = null, sortValue = 0, isPinned = false) {
      if (!addedNodes.has(id)) {
        elements.push({
          data: { id, label, color: nodeColor, fileId, url, isDept, isDate, type, fullName, sortValue, isPinned },
          selectable: !!fileId
        });
        addedNodes.add(id);
        if (parentId) {
          elements.push({
            data: {
              source: parentId,
              target: id,
              color: fileId ? nodeColor : GOLD,
              arrowShape: fileId ? "triangle" : "none"
            },
            selectable: false
          });
        }
      }
    }

    addNode("root", data.projectCode.toUpperCase(), null, GOLD, null, null, false, false, null, null, 0);
    addNode("branch_goc", "BẢN VẼ TKTC", "root", GOLD, null, null, false, false, null, null, 0);
    addNode("branch_update", "BẢN VẼ CẬP NHẬT", "root", GOLD, null, null, false, false, null, null, 0);
    addNode("branch_proposal", "PHIẾU ĐỀ XUẤT", "root", GOLD, null, null, false, false, null, null, 0);

    if (data.files) {
      const TYPE_PRIORITY = { PROPOSAL: 1, UPDATE: 2, ORIGINAL: 3 };

      data.files.sort((a, b) => {
        const pA = TYPE_PRIORITY[a.type] || 4;
        const pB = TYPE_PRIORITY[b.type] || 4;
        if (pA !== pB) return pA - pB;

        const svA = a.sortValue || 0;
        const svB = b.sortValue || 0;
        if (svA !== svB) return svB - svA;

        return a.fileName.localeCompare(b.fileName, "vi", { numeric: true, sensitivity: "base" });
      });

      const seenFiles = new Set();

      data.files.forEach(f => {
        let namePart = f.fileName.replace(/\.(pdf|xlsx|xls)$/i, "");
        const projectCode = (data.projectCode || "").toString();

        const patterns = [
          new RegExp(projectCode, "gi"),
          /PĐX/gi, /BVTKTC/gi, /TKBVTC/gi, /STR/gi, /ARC/gi, /MEP/gi, /\d{6}/g
        ];

        patterns.forEach(p => { namePart = namePart.replace(p, ""); });

        let cleanName = namePart.replace(/_+/g, "_").replace(/\s+/g, " ").replace(/^[_ \s]+|[_ \s]+$/g, "");
        const smartName = cleanName ? cleanName : f.fileName.replace(/\.(pdf|xlsx|xls)$/i, "");
        const isPinned = S.pinnedDrawingNodes.has(f.fileId);

        const dateId = f.sortValue || "nodate";
        const deptKey = f.dept.toUpperCase();
        const deptColor = DEPT_COLORS[deptKey] || DEPT_COLORS["KHÁC"];
        const formattedDateLabel = (f.dateLabel || "--/--/----").replace(/\//g, "-");

        if (f.type === "ORIGINAL") {
          const dNode = "date_goc_" + dateId;
          addNode(dNode, formattedDateLabel, "branch_goc", GOLD, null, null, false, true, null, null, f.sortValue);

          if (f.branch === "Chung") {
            const sNodeThan = dNode + "_Thân", deptIdThan = sNodeThan + "_" + f.dept;
            const sNodeHam = dNode + "_Hầm", deptIdHam = sNodeHam + "_" + f.dept;

            const dupKey = f.fileName.toUpperCase() + "_" + deptIdThan;
            if (seenFiles.has(dupKey)) return;
            seenFiles.add(dupKey);

            addNode(sNodeThan, "THÂN", dNode, GOLD, null, null, false, false, null, null, f.sortValue);
            addNode(deptIdThan, f.dept.toUpperCase(), sNodeThan, deptColor, null, null, true, false, null, null, f.sortValue);

            addNode(sNodeHam, "HẦM", dNode, GOLD, null, null, false, false, null, null, f.sortValue);
            addNode(deptIdHam, f.dept.toUpperCase(), sNodeHam, deptColor, null, null, true, false, null, null, f.sortValue);

            addNode(f.fileId, smartName, null, deptColor, f.fileId, f.url, false, false, f.type, f.fileName, f.sortValue, isPinned);

            elements.push({ data: { source: deptIdThan, target: f.fileId, color: deptColor, arrowShape: "triangle" }, selectable: false });
            elements.push({ data: { source: deptIdHam, target: f.fileId, color: deptColor, arrowShape: "triangle" }, selectable: false });
          } else {
            const sNode = dNode + "_" + f.branch, deptId = sNode + "_" + f.dept;

            const dupKey = f.fileName.toUpperCase() + "_" + deptId;
            if (seenFiles.has(dupKey)) return;
            seenFiles.add(dupKey);

            addNode(sNode, f.branch.toUpperCase(), dNode, GOLD, null, null, false, false, null, null, f.sortValue);
            addNode(deptId, f.dept.toUpperCase(), sNode, deptColor, null, null, true, false, null, null, f.sortValue);

            addNode(f.fileId, smartName, deptId, deptColor, f.fileId, f.url, false, false, f.type, f.fileName, f.sortValue, isPinned);
          }
        } else {
          const bParent = f.type === "UPDATE" ? "branch_update" : "branch_proposal";
          const dNode = "date_alt_" + bParent + "_" + dateId;

          const dupKey = f.fileName.toUpperCase() + "_" + dNode;
          if (seenFiles.has(dupKey)) return;
          seenFiles.add(dupKey);

          addNode(dNode, formattedDateLabel, bParent, GOLD, null, null, false, true, null, null, f.sortValue);
          addNode(f.fileId, smartName, dNode, deptColor, f.fileId, f.url, false, false, f.type, f.fileName, f.sortValue, isPinned);
        }
      });
    }
    return elements;
  }

  function removeEmptyParents_Drawing(node) {
    const cy = S.cyInstance;
    if (!cy || !node) return;

    const parentEdges = node.incomers("edge");
    const parents = parentEdges.sources();

    cy.remove(node);

    parents.forEach(parent => {
      const parentId = parent.id();
      const isPermanentRoot = ["root", "branch_goc", "branch_update", "branch_proposal"].includes(parentId);

      if (!isPermanentRoot) {
        const outgoingEdges = parent.outgoers("edge");
        if (outgoingEdges.length === 0) {
          removeEmptyParents_Drawing(parent);
        }
      }
    });
  }

  function togglePinNode_Drawing(fileId) {
    if (!fileId) return;
    const isPinned = S.pinnedDrawingNodes.has(fileId);

    if (isPinned) {
      S.pinnedDrawingNodes.delete(fileId);
    } else {
      S.pinnedDrawingNodes.add(fileId);
    }

    localStorage.setItem("bcons_pinned_drawing_nodes", JSON.stringify(Array.from(S.pinnedDrawingNodes)));

    if (S.cyInstance) {
      const node = S.cyInstance.getElementById(fileId);
      if (node && node.length > 0) {
        node.data("isPinned", !isPinned);
      }
    }

    showToast_PL(!isPinned ? "📌 Đã ghim bản vẽ!" : "Đã bỏ ghim bản vẽ", "success");
  }

  BD.mindmap = {
    flashNode_Drawing,
    enforceBidirectionalLayout,
    renderMindmap,
    removeEmptyParents_Drawing,
    togglePinNode_Drawing
  };

  window.renderMindmap = renderMindmap;
  window.togglePinNode_Drawing = togglePinNode_Drawing;
})();