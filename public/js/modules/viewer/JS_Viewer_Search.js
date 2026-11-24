// =========================================================================
// BCONS DOCUMENT VIEWER - MODULE 2/4: SEARCH ENGINE & HIGHLIGHTING
// =========================================================================

(() => {
  const BV = window.__BconsViewer;
  const S = BV.state;
  const U = BV.utils;

  function isSingleTechnicalCode(query) {
    const trimmed = query.trim();
    if (/\s+/.test(trimmed)) return false;
    const q = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const hasLetter = /[A-Z]/.test(q);
    const hasDigit = /[0-9]/.test(q);
    return (hasLetter && hasDigit) || (/^[A-Z]{2,5}$/.test(q) && trimmed === trimmed.toUpperCase());
  }

  function cleanCodeToken(str) {
    if (!str) return "";
    return str.toLowerCase()
              .replace(/\?/g, "7")
              .replace(/0/g, "o")
              .replace(/1/g, "l")
              .replace(/i/g, "l")
              .replace(/5/g, "s")
              .replace(/8/g, "b")
              .replace(/[^a-z0-9]/g, "");
  }

  function cleanNaturalToken(str) {
    if (!str) return "";
    return str
      .normalize("NFC")
      .replace(/[\u201C\u201D\u2018\u2019"']/g, "")
      .replace(/²/g, "2")
      .replace(/³/g, "3")
      .replace(/[àáạảãâầấậẩẫăằắặẳẵÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, "a")
      .replace(/[èéẹẻẽêềếệểễÈÉẸẺẼÊỀẾỆỂỄ]/g, "e")
      .replace(/[ìíịỉĩÌÍỊỈĨ]/g, "i")
      .replace(/[òóọỏõôồốộổỗơờớợởỡÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, "o")
      .replace(/[ùúụủũưừứựửữÙÚỤỦŨƯỪỨỰỬỮ]/g, "u")
      .replace(/[ỳýỵỷỹỲÝỴỶỸ]/g, "y")
      .replace(/[đĐ]/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/(\d)[.,](?=\d)/g, "$1\uE001")
      .replace(/[^a-z0-9\uE001]/g, "")
      .replace(/\uE001/g, ".");
  }

  function cleanSentenceNatural(str) {
    if (!str) return "";
    return str
      .replace(/[àáạảãâầấậẩẫăằắặẳẵÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, "a")
      .replace(/[èéẹẻẽêềếệểễÈÉẸẺẼÊỀẾỆỂỄ]/g, "e")
      .replace(/[ìíịỉĩÌÍỊỈĨ]/g, "i")
      .replace(/[òóọỏõôồốộổỗơờớợởỡÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, "o")
      .replace(/[ùúụủũưừứựửữÙÚỤỦŨƯỪỨỰỬỮ]/g, "u")
      .replace(/[ỳýỵỷỹỲÝỴỶỸ]/g, "y")
      .replace(/[đĐ]/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/(\d)[.,](?=\d)/g, "$1\uE001")
      .replace(/[^a-z0-9\s\uE001]/g, " ")
      .replace(/\uE001/g, ".")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isEditDistanceOne(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;

    if (Math.min(la, lb) === 1) {
      return la !== lb && Math.max(la, lb) === 2 && (a.includes(b) || b.includes(a));
    }

    let i = 0, j = 0, diffs = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) {
        i++; j++;
      } else {
        diffs++;
        if (diffs > 1) return false;
        if (la > lb) i++;
        else if (lb > la) j++;
        else { i++; j++; }
      }
    }
    if (i < la || j < lb) diffs++;
    return diffs <= 1;
  }

  function isSoftOcrTokenMatch(strToken, queryToken) {
    if (!strToken || !queryToken) return false;
    if (strToken === queryToken) return true;
    if (strToken.includes(".") !== queryToken.includes(".")) return false;

    // Bắt buộc chữ cái đầu tiên khớp chính xác
    if (strToken[0] !== queryToken[0]) return false;

    // Không chạy mờ với từ quá ngắn (< 4 ký tự)
    if (strToken.length < 4 || queryToken.length < 4) return false;

    const digitsA = strToken.replace(/[^0-9]/g, "");
    const digitsB = queryToken.replace(/[^0-9]/g, "");
    if (digitsA !== digitsB) return false;

    return isEditDistanceOne(strToken, queryToken);
  }

  async function executeSearch(options = {}) {
    const rawQuery = document.getElementById("ai-search-input").value;
    if (!rawQuery || !rawQuery.trim() || !S.currentFileId || !S.currentManifest) return;

    const preferPl01 = Boolean(options && options.preferPl01);
    const silentNotFound = Boolean(options && options.silentNotFound);

    S.lastSearchedQuery = rawQuery.trim();
    clearSearchState();

    const qTokens = rawQuery
      .replace(/(\d)[.,](?=\d)/g, "$1\uE001")
      .replace(/[\(\)\[\]\{\}\-\|\/\\,;:\.\?\!\<\>+=_]/g, " ")
      .replace(/\uE001/g, ".")
      .split(/\s+/)
      .map(cleanNaturalToken)
      .filter(Boolean);
    const numTokens = qTokens.length;
    if (numTokens === 0) return;

    const isCodeMode = isSingleTechnicalCode(rawQuery);
    const matches = [];

    function isOverlapping(m1, m2) {
      if (m1.page !== m2.page) return false;
      const b1 = m1.boxes ? m1.boxes[0] : m1;
      const b2 = m2.boxes ? m2.boxes[0] : m2;
      const yDiff = Math.abs(b1.y - b2.y);
      const maxHeight = Math.max(b1.h, b2.h);
      if (yDiff > maxHeight * 0.7) return false;

      const xOverlap = Math.min(b1.x + b1.w, b2.x + b2.w) - Math.max(b1.x, b2.x);
      const minWidth = Math.min(b1.w, b2.w);
      return xOverlap > (minWidth * 0.35);
    }

    function addMatch(newMatch) {
      newMatch.isCode = isCodeMode;
      for (let i = 0; i < matches.length; i++) {
        if (isOverlapping(matches[i], newMatch)) return;
      }
      matches.push(newMatch);
    }

    function isStrictTokenMatch(strToken, queryToken) {
      return strToken === queryToken;
    }
    function isPrefixTokenMatch(strToken, queryToken) {
      if (isStrictTokenMatch(strToken, queryToken)) return true;
      return strToken.startsWith(queryToken);
    }
    function isFuzzyTokenMatch(strToken, queryToken) {
      if (strToken === queryToken) return true;
      if (strToken.includes(".") !== queryToken.includes(".")) return false;
      const qLen = queryToken.length;
      const sLen = strToken.length;
      if (qLen >= 2 && /[0-9]/.test(queryToken) && /[0-9]/.test(strToken)) {
        if (qLen - sLen === 1 && (queryToken.endsWith(strToken) || queryToken.startsWith(strToken))) return true;
      }
      if (qLen >= 4 && sLen === qLen - 1 && queryToken.startsWith(strToken)) return true;
      return false;
    }
    function isFuzzyPrefixMatch(strToken, queryToken) {
      if (isFuzzyTokenMatch(strToken, queryToken)) return true;
      return strToken.startsWith(queryToken);
    }

    const totalPages = S.currentManifest.numPages || S.currentManifest.pages.length;
    const fallbackAppendixStart = Math.max(1, totalPages - 6);
    const appendixStart = S.currentManifest.appendixStartPage || fallbackAppendixStart;

    // Kiểm tra ranh giới cột bảng (chặn nối từ xuyên vách ngăn cột)
    function isCrossColumnBoundary(items, leftIt, rightIt, isAppendix) {
      const leftEnd = leftIt[1] + leftIt[3];
      const rightStart = rightIt[1];
      const gap = rightStart - leftEnd;
      const avgH = Math.max(6, (leftIt[4] + rightIt[4]) / 2);

      const hardMaxGap = isAppendix ? Math.max(18, avgH * 1.9) : 65;
      if (gap > hardMaxGap) return true;

      if (gap <= Math.max(3.5, avgH * 0.42)) return false;

      const midX = (leftEnd + rightStart) / 2;
      const yCenter = (leftIt[2] + rightIt[2]) / 2;

      let crossingWords = 0;
      let alignedRightColCount = 0;
      const distinctY = new Set();

      for (let idx = 0; idx < items.length; idx++) {
        const t = items[idx];
        if (!t[0] || !t[0].trim()) continue;

        const yDiff = Math.abs(t[2] - yCenter);
        if (yDiff > 5 && yDiff <= 120) {
          distinctY.add(Math.round(t[2] / 6));
          if (t[1] < midX - 1.5 && (t[1] + t[3]) > midX + 1.5) crossingWords++;
          if (Math.abs(t[1] - rightStart) <= 3.5) alignedRightColCount++;
        }
      }

      if (!isAppendix) {
        return (distinctY.size >= 2 && crossingWords === 0 && alignedRightColCount >= 2);
      }

      if (distinctY.size >= 2) {
        if (crossingWords === 0 && (alignedRightColCount >= 1 || gap > avgH * 0.85)) return true;
        if (crossingWords <= 1 && alignedRightColCount >= 2 && gap > avgH * 0.65) return true;
      }

      if (gap > Math.max(12, avgH * 1.25)) return true;

      return false;
    }

    S.currentManifest.pages.forEach(function(p) {
      if (!p.textItems || p.textItems.length === 0) return;

      const isAppendixPage = (p.pageNum >= appendixStart) || (p.textItems.length > 250);
      const matchedIndicesInA = new Set();

      if (numTokens === 1) {
        const targetWord = qTokens[0];
        p.textItems.forEach(function(it) {
          if (!it[0]) return;
          const pure = cleanNaturalToken(it[0]);
          if (!pure) return;
          const solidPure = pure.replace(/\s+/g, "");

          const isMatched = isAppendixPage
            ? isPrefixTokenMatch(solidPure, targetWord)
            : isFuzzyPrefixMatch(solidPure, targetWord);

          if (isMatched) {
            let widthRatio = 1;
            if (!isAppendixPage || !/[0-9]/.test(solidPure)) {
              widthRatio = targetWord.length / Math.max(1, solidPure.length);
            }
            const b = { x: it[1], y: it[2], w: Math.max(10, widthRatio * it[3]), h: it[4] };
            addMatch({
              page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
              x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
            });
          } else if (solidPure.length > targetWord.length) {
            let startIdx = 0;
            while ((startIdx = solidPure.indexOf(targetWord, startIdx)) !== -1) {
              const isNumeric = /[0-9]/.test(solidPure);
              const prevSolidChar = startIdx > 0 ? solidPure[startIdx - 1] : "";
              const beforeChar = startIdx > 0 ? it[0][startIdx - 1] : " ";
              const isStartOfWord = !(/[a-zA-Z]/.test(beforeChar));

              if ((isStartOfWord || isNumeric) && prevSolidChar !== ".") {
                const startRatio = startIdx / Math.max(1, solidPure.length);
                let widthRatio = targetWord.length / Math.max(1, solidPure.length);
                if (isAppendixPage && isNumeric && startIdx + targetWord.length === solidPure.length) {
                  widthRatio = 1 - startRatio;
                }
                const b = {
                  x: it[1] + (startRatio * it[3]),
                  y: it[2],
                  w: Math.max(14, widthRatio * it[3]),
                  h: it[4]
                };
                addMatch({
                  page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
                  x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
                });
              }
              startIdx += targetWord.length;
            }
          }
        });
      } else {
        const cleanQuery = cleanSentenceNatural(rawQuery);

        p.textItems.forEach(function(it, idx) {
          if (!it[0]) return;
          const itClean = cleanSentenceNatural(it[0]);
          let startPos = 0;
          while ((startPos = itClean.indexOf(cleanQuery, startPos)) !== -1) {
            const beforeChar = startPos > 0 ? itClean[startPos - 1] : " ";
            if (beforeChar === " ") {
              const startRatio = startPos / Math.max(1, itClean.length);
              const widthRatio = cleanQuery.length / Math.max(1, itClean.length);
              const b = { x: it[1] + (startRatio * it[3]), y: it[2], w: Math.max(20, widthRatio * it[3]), h: it[4] };
              addMatch({
                page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
                x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
              });
              matchedIndicesInA.add(idx);
            }
            startPos += cleanQuery.length;
          }
        });

        for (let i = 0; i < p.textItems.length; i++) {
          if (matchedIndicesInA.has(i)) continue;

          const firstIt = p.textItems[i];
          if (!firstIt[0]) continue;
          const firstClean = cleanNaturalToken(firstIt[0]).replace(/\s+/g, "");
          if (!firstClean) continue;

          let isFirstMatch = false;
          let firstIsFuzzy = false;
          let firstStartRatio = 0;

          if (isAppendixPage) {
            if (isStrictTokenMatch(firstClean, qTokens[0])) {
              isFirstMatch = true;
            } else if (firstClean.endsWith(qTokens[0]) && /[0-9]/.test(firstClean)) {
              isFirstMatch = true;
              firstStartRatio = firstClean.indexOf(qTokens[0]) / firstClean.length;
            }
          } else {
            if (isFuzzyTokenMatch(firstClean, qTokens[0])) {
              isFirstMatch = true;
            } else if (isSoftOcrTokenMatch(firstClean, qTokens[0])) {
              isFirstMatch = true;
              firstIsFuzzy = true;
            }
          }

          if (!isFirstMatch) continue;

          let matchedList = [{ it: firstIt, clean: firstClean, sR: firstStartRatio, isWrap: false }];
          let currentItemIdx = i;
          let sequenceValid = true;
          let lineBreakCount = 0;
          let fuzzyUsed = firstIsFuzzy ? 1 : 0;
          let strictCount = firstIsFuzzy ? 0 : 1;
          let maxStrictLen = firstIsFuzzy ? 0 : firstClean.length;
          const maxFuzzy = 1;

          for (let k = 1; k < numTokens; k++) {
            let foundNext = false;
            const isLastSearchToken = (k === numTokens - 1);
            const prevItem = matchedList[matchedList.length - 1].it;

            // 1. Quét tìm trên cùng một dòng ngang (Cập nhật mốc tọa độ qua dấu câu, khóa chặt ranh giới cột)
            let tempIdx = currentItemIdx;
            let lastSameLineIt = prevItem;
            const maxStep = 5;

            while (++tempIdx < p.textItems.length && tempIdx <= currentItemIdx + maxStep) {
              const it = p.textItems[tempIdx];
              const rawTrim = (it[0] || "").trim();
              const clean = cleanNaturalToken(it[0]).replace(/\s+/g, "");
              if (!clean) {
                if (!rawTrim) continue;
                if (rawTrim === "|") break;
                const pYDiff = Math.abs(it[2] - lastSameLineIt[2]);
                const pGap = it[1] - (lastSameLineIt[1] + lastSameLineIt[3]);
                const pAvgH = Math.max(6, (lastSameLineIt[4] + it[4]) / 2);
                const maxPunctGap = isAppendixPage ? Math.max(4.5, pAvgH * 0.6) : 12;
                if (pGap >= -5 && pGap <= maxPunctGap && pYDiff <= 6 && !isCrossColumnBoundary(p.textItems, lastSameLineIt, it, isAppendixPage)) {
                  lastSameLineIt = it;
                  continue;
                }
                break;
              }

              let isStrictOrPrefix = false;
              if (isAppendixPage) {
                isStrictOrPrefix = isLastSearchToken ? isPrefixTokenMatch(clean, qTokens[k]) : isStrictTokenMatch(clean, qTokens[k]);
              } else {
                isStrictOrPrefix = isLastSearchToken ? isFuzzyPrefixMatch(clean, qTokens[k]) : isFuzzyTokenMatch(clean, qTokens[k]);
              }

              const isSoft = !isAppendixPage && !isStrictOrPrefix && (fuzzyUsed < maxFuzzy) && isSoftOcrTokenMatch(clean, qTokens[k]);

              if (isStrictOrPrefix || isSoft) {
                const yDiff = Math.abs(it[2] - lastSameLineIt[2]);
                const gap = it[1] - (lastSameLineIt[1] + lastSameLineIt[3]);
                const avgH = Math.max(6, (lastSameLineIt[4] + it[4]) / 2);
                const bridgedViaPunct = (lastSameLineIt !== prevItem);
                const maxWordGap = (isAppendixPage && bridgedViaPunct) ? Math.max(5.5, avgH * 0.75) : Infinity;

                if (gap >= -5 && gap <= maxWordGap && yDiff <= 6 && !isCrossColumnBoundary(p.textItems, lastSameLineIt, it, isAppendixPage)) {
                  foundNext = true;
                  currentItemIdx = tempIdx;
                  matchedList.push({ it: it, clean: clean, sR: 0, isWrap: false });
                  if (!isSoft) {
                    strictCount++;
                    if (clean.length > maxStrictLen) maxStrictLen = clean.length;
                  } else {
                    fuzzyUsed++;
                  }
                  break;
                } else {
                  break;
                }
              } else {
                break;
              }
            }

            // 2. Ngoại lệ xuống dòng (chặn vách ngăn cột & chống nhảy cóc dòng, hỗ trợ khi OCR đảo thứ tự block)
            if (!foundNext && lineBreakCount < 2 && isAppendixPage) {
              const maxOffset = 120;
              const candidateIndices = [];
              for (let off = 1; off <= maxOffset; off++) {
                if (currentItemIdx + off < p.textItems.length) candidateIndices.push(currentItemIdx + off);
              }
              for (let off = 1; off <= maxOffset; off++) {
                if (currentItemIdx - off >= 0) candidateIndices.push(currentItemIdx - off);
              }

              for (let cIdx = 0; cIdx < candidateIndices.length; cIdx++) {
                tempIdx = candidateIndices[cIdx];
                const it = p.textItems[tempIdx];
                const clean = cleanNaturalToken(it[0]).replace(/\s+/g, "");
                if (!clean) continue;

                const isStrictOrPrefix = isLastSearchToken ? isPrefixTokenMatch(clean, qTokens[k]) : isStrictTokenMatch(clean, qTokens[k]);
                const isSoft = !isAppendixPage && !isStrictOrPrefix && (fuzzyUsed < maxFuzzy) && isSoftOcrTokenMatch(clean, qTokens[k]);

                if (isStrictOrPrefix || isSoft) {
                  const yDrop = prevItem[2] - it[2];
                  const isWrapLeft = it[1] < (prevItem[1] + prevItem[3] - 10);

                  const scanMin = Math.max(0, Math.min(currentItemIdx, tempIdx) - 35);
                  const scanMax = Math.min(p.textItems.length - 1, Math.max(currentItemIdx, tempIdx) + 35);

                  let isLastWordOfLine1 = true;
                  for (let m = scanMin; m <= scanMax; m++) {
                    if (m === currentItemIdx) continue;
                    const midIt = p.textItems[m];
                    const midClean = cleanNaturalToken(midIt[0]);
                    if (!midClean) continue;

                    const gapRight = midIt[1] - (prevItem[1] + prevItem[3]);
                    if (Math.abs(midIt[2] - prevItem[2]) <= 4 && gapRight >= -3 && gapRight <= 8.5 && !isCrossColumnBoundary(p.textItems, prevItem, midIt, isAppendixPage)) {
                      isLastWordOfLine1 = false;
                      break;
                    }
                  }

                  let isFirstWordOfLine2 = true;
                  for (let prevIdx = scanMax; prevIdx >= scanMin; prevIdx--) {
                    if (prevIdx === tempIdx) continue;
                    const pIt = p.textItems[prevIdx];
                    const pClean = cleanNaturalToken(pIt[0]);
                    if (!pClean) continue;

                    const isSttFormat = /^(?:[0-9]{1,4}|[a-z]|[ivx]{1,5})$/i.test(pClean);
                    const isLeftMargin = pIt[1] < (p.width * 0.25);
                    if (isSttFormat && isLeftMargin) continue;

                    const gapLeft = it[1] - (pIt[1] + pIt[3]);
                    if (Math.abs(pIt[2] - it[2]) <= 4 && gapLeft >= -5 && gapLeft <= 15 && !isCrossColumnBoundary(p.textItems, pIt, it, isAppendixPage)) {
                      isFirstWordOfLine2 = false;
                      break;
                    }
                  }

                  const lineH = Math.max(prevItem[4] || 0, it[4] || 0, 8);
                  const maxYDrop = isAppendixPage ? Math.max(22, lineH * 2.4) : 45;

                  if (yDrop >= 3 && yDrop <= maxYDrop && isWrapLeft && isLastWordOfLine1 && isFirstWordOfLine2) {
                    let hasInterveningLine = false;
                    const colLeft = Math.min(it[1], prevItem[1]) - 10;
                    const colRight = Math.max(it[1] + it[3], prevItem[1] + prevItem[3]) + 10;
                    for (let interIdx = scanMin; interIdx <= scanMax; interIdx++) {
                      const interIt = p.textItems[interIdx];
                      if (!interIt[0] || !interIt[0].trim()) continue;
                      const interLeft = interIt[1];
                      const interRight = interIt[1] + interIt[3];
                      if (interRight < colLeft || interLeft > colRight) continue;
                      if (interIt[2] < prevItem[2] - 5 && interIt[2] > it[2] + 5) {
                        hasInterveningLine = true;
                        break;
                      }
                    }

                    if (!hasInterveningLine) {
                      foundNext = true;
                      lineBreakCount++;
                      currentItemIdx = tempIdx;
                      matchedList.push({ it: it, clean: clean, sR: 0, isWrap: true });
                      if (!isSoft) {
                        strictCount++;
                        if (clean.length > maxStrictLen) maxStrictLen = clean.length;
                      } else {
                        fuzzyUsed++;
                      }
                      break;
                    }
                  }
                }
              }
            }

            if (!foundNext) {
              sequenceValid = false;
              break;
            }
          }

          const isPairSafe = (numTokens > 2) || (fuzzyUsed === 0) || (maxStrictLen >= 2);

          if (sequenceValid && matchedList.length === numTokens && strictCount >= 1 && fuzzyUsed <= maxFuzzy && isPairSafe) {
            const lines = [];
            let currentLine = [];
            matchedList.forEach(item => {
              if (item.isWrap && currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = [];
              }
              currentLine.push(item);
            });
            if (currentLine.length > 0) lines.push(currentLine);

            const boxes = lines.map((lineTokens, lIdx) => {
              const isLastLine = (lIdx === lines.length - 1);
              const startItem = lineTokens[0];
              const endItem = lineTokens[lineTokens.length - 1];

              const exactX = startItem.it[1] + (startItem.sR * startItem.it[3]);
              let exactEndX = endItem.it[1] + endItem.it[3];

              if (isLastLine) {
                const lastTargetToken = qTokens[numTokens - 1];
                let endRatio = Math.min(1, lastTargetToken.length / Math.max(1, endItem.clean.length));
                if (isAppendixPage && /[0-9]/.test(endItem.clean)) endRatio = 1;
                exactEndX = endItem.it[1] + (endRatio * endItem.it[3]);
              }

              const minY = Math.min(...lineTokens.map(t => t.it[2]));
              const maxH = Math.max(...lineTokens.map(t => t.it[4]));

              return { x: exactX, y: minY, w: Math.max(16, exactEndX - exactX), h: maxH };
            });

            addMatch({
              page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
              x: boxes[0].x, y: boxes[0].y, w: boxes[0].w, h: boxes[0].h, boxes: boxes
            });
          }
        }
      }

      if (isCodeMode) {
        const targetCode = cleanCodeToken(rawQuery);
        for (let i = 0; i < p.textItems.length - 1; i++) {
          const it1 = p.textItems[i];
          const it2 = p.textItems[i + 1];
          const c1 = cleanCodeToken(it1[0]);
          const c2 = cleanCodeToken(it2[0]);

          const gap = it2[1] - (it1[1] + it1[3]);
          const yDiff = Math.abs(it2[2] - it1[2]);

          if (gap >= -3 && gap <= 14 && yDiff <= 5 && (c1 + c2 === targetCode) && !isCrossColumnBoundary(p.textItems, it1, it2, isAppendixPage)) {
            let startX = it1[1];
            if (it1[0].startsWith("(") || it1[0].startsWith("[")) startX += (it1[3] * 0.18);
            let endX = it2[1] + it2[3];
            if (it2[0].endsWith(")") || it2[0].endsWith("]") || it2[0].includes(" ")) {
              endX = it2[1] + (it2[3] * (c2.length / Math.max(c2.length, it2[0].length)));
            }

            const b = { x: startX, y: Math.min(it1[2], it2[2]), w: Math.max(14, endX - startX), h: Math.max(it1[4], it2[4]) };
            addMatch({
              page: p.pageNum, pageWidth: p.width, pageHeight: p.height,
              x: b.x, y: b.y, w: b.w, h: b.h, boxes: [b]
            });
            i++;
          }
        }
      }
    });

    if (matches.length > 0) {
      S.searchResults = matches;
      onSearchReady(preferPl01);
      return matches;
    } else {
      document.getElementById("search-counter").textContent = "0/0";
      if (!silentNotFound) {
        if (typeof showToast_PL === "function") {
          showToast_PL('Không tìm thấy từ khóa: "' + rawQuery + '"', "error");
        } else {
          alert('Không tìm thấy từ khóa: "' + rawQuery + '"');
        }
      }
      return [];
    }
  }

  function handleSearchSubmit(isShift = false) {
    const currentInput = document.getElementById("ai-search-input").value.trim();
    if (currentInput === S.lastSearchedQuery && S.searchResults.length > 0) {
      navigateMatch(isShift ? -1 : 1);
    } else {
      executeSearch();
    }
  }

  function handleSearchKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit(e.shiftKey);
    }
  }

  function onSearchReady(preferPl01 = false) {
    document.getElementById("btn-prev").disabled = false;
    document.getElementById("btn-next").disabled = false;
    redrawAllHighlights();

    let startIdx = 0;
    if (preferPl01 && S.currentManifest && S.currentManifest.appendixStartPage) {
      const apStart = S.currentManifest.appendixStartPage;
      const pl01Idx = S.searchResults.findIndex(m => m.page >= apStart);
      if (pl01Idx !== -1) startIdx = pl01Idx;
    }

    S.currentMatchIndex = startIdx;
    updateNavigationUI();
    jumpToMatch(S.currentMatchIndex);
  }

  function redrawAllHighlights() {
    document.querySelectorAll(".ai-highlight-box").forEach(el => el.remove());

    function docPx(n) {
      return "calc(" + (Math.round(n * 100) / 100) + "px * var(--doc-scale))";
    }

    S.searchResults.forEach((m, idx) => {
      const pageEl = document.getElementById("page-wrapper-" + m.page);
      if (!pageEl) return;

      const rightPad = m.isCode ? 3 : 2;
      const boxes = (m.boxes && m.boxes.length > 0) ? m.boxes : [m];
      const isMultiLine = boxes.length > 1;

      boxes.forEach((box, bIdx) => {
        const highlight = document.createElement("div");
        highlight.id = "highlight-match-" + idx + "-" + bIdx;

        let wrapClass = "";
        if (isMultiLine) {
          if (bIdx === 0) wrapClass = " wrap-start";
          else if (bIdx === boxes.length - 1) wrapClass = " wrap-end";
        }

        highlight.className = "ai-highlight-box match-group-" + idx + wrapClass + (idx === S.currentMatchIndex ? " active-match" : "");
        highlight.style.left = docPx(box.x - 1.5);
        highlight.style.top = docPx((m.pageHeight - box.y - box.h) - 1);
        highlight.style.width = docPx(box.w + 1.5 + rightPad);
        highlight.style.height = docPx(box.h + 2);
        pageEl.appendChild(highlight);
      });
    });
  }

  function jumpToMatch(index) {
    document.querySelectorAll(".ai-highlight-box").forEach(el => el.classList.remove("active-match"));
    const match = S.searchResults[index];
    if (!match) return;

    const pageEl = document.getElementById("page-wrapper-" + match.page);
    if (!pageEl) return;
    document.querySelectorAll(".match-group-" + index).forEach(el => el.classList.add("active-match"));

    BV.ui.buildTextLayerForWrapper(pageEl);
    const targetCanvas = pageEl.querySelector("canvas.page-img");
    const targetPdfPage = parseInt(pageEl.dataset.pdfPage || match.page, 10);
    if (targetCanvas && !U.scalesEqual(targetCanvas.dataset.renderedScale, S.currentScale)) {
      BV.ui.renderPageToCanvas(targetCanvas, targetPdfPage);
    }

    const vp = document.getElementById("viewport-container");
    const mark = document.getElementById("highlight-match-" + index + "-0");
    const markTop = (mark && mark.offsetParent === pageEl) ? mark.offsetTop : 0;
    const markH = (mark && mark.offsetParent === pageEl) ? mark.offsetHeight : 0;
    const dest = pageEl.offsetTop + markTop - (vp.clientHeight - markH) / 2;
    const maxTop = Math.max(0, vp.scrollHeight - vp.clientHeight);
    vp.scrollTo({ top: Math.max(0, Math.min(dest, maxTop)), behavior: "smooth" });
    BV.ui.updatePageIndicatorUI(match.page);
  }

  function navigateMatch(direction) {
    if (S.searchResults.length === 0) return;
    S.currentMatchIndex += direction;
    if (S.currentMatchIndex >= S.searchResults.length) S.currentMatchIndex = 0;
    if (S.currentMatchIndex < 0) S.currentMatchIndex = S.searchResults.length - 1;
    updateNavigationUI();
    jumpToMatch(S.currentMatchIndex);
  }

  function updateNavigationUI() {
    const counter = document.getElementById("search-counter");
    if (counter) counter.textContent = S.searchResults.length > 0 ? `${S.currentMatchIndex + 1}/${S.searchResults.length}` : "0/0";
  }

  function clearSearchState() {
    S.searchResults = [];
    S.currentMatchIndex = -1;
    document.querySelectorAll(".ai-highlight-box").forEach(el => el.remove());
    const btnP = document.getElementById("btn-prev"), btnN = document.getElementById("btn-next");
    if (btnP) btnP.disabled = true;
    if (btnN) btnN.disabled = true;
    const counter = document.getElementById("search-counter");
    if (counter) counter.textContent = "0/0";
  }

  let isSearchShortcutBound = false;
  function setupSearchShortcut() {
    if (isSearchShortcutBound) return;
    isSearchShortcutBound = true;

    window.addEventListener("keydown", function(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        if (!S.currentFileId && !S.currentManifest) return;

        const panel = document.getElementById("pl-dock-preview-panel");
        const vp = document.getElementById("viewport-container");
        const isViewerActive = (panel && panel.offsetParent !== null) || (vp && vp.offsetParent !== null);
        if (!isViewerActive) return;

        const input = document.getElementById("ai-search-input");
        if (!input) return;

        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSearchShortcut);
  } else {
    setupSearchShortcut();
  }

  BV.search = {
    isSingleTechnicalCode,
    cleanCodeToken,
    cleanNaturalToken,
    cleanSentenceNatural,
    isEditDistanceOne,
    isSoftOcrTokenMatch,
    executeSearch,
    handleSearchSubmit,
    handleSearchKey,
    onSearchReady,
    redrawAllHighlights,
    jumpToMatch,
    navigateMatch,
    updateNavigationUI,
    clearSearchState,
    setupSearchShortcut
  };
})();