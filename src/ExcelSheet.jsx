/**
 * ExcelSheet.jsx
 * Excelレイアウト（就労日報）をReactで再現するコンポーネント
 *
 * 使い方:
 *   import layoutData from './layout_react.json';
 *   import ExcelSheet from './ExcelSheet';
 *   <ExcelSheet data={layoutData} />
 *
 * Props:
 *   data      : layout_react.json の内容
 *   scale     : 表示倍率 (デフォルト 1.0)
 *   printMode : true にすると A4横・余白・印刷倍率を適用したラッパーを追加
 */

import { useMemo } from "react";

function colNumToLetter(n) {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + (n - 1) % 26) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const MM_TO_PX = 3.7795; // 1mm ≈ 3.7795px @96dpi
const A4_W_MM = 297;
const A4_H_MM = 210;

export default function ExcelSheet({ data, scale = 1.0, printMode = false }) {
  const { colWidths, rowHeights, mergedCells, cells, rows, cols, pageSetup } = data;
  const margins = pageSetup?.margins ?? {};

  // 結合セルマップ
  const mergedMap = useMemo(() => {
    const map = {};
    mergedCells.forEach((m) => {
      const maxCol = Math.min(m.maxCol, cols);
      for (let r = m.minRow; r <= m.maxRow; r++) {
        for (let c = m.minCol; c <= maxCol; c++) {
          const key = `${r}-${c}`;
          if (r === m.minRow && c === m.minCol) {
            map[key] = {
              isOrigin: true,
              colSpan: maxCol - m.minCol + 1,
              rowSpan: m.maxRow - m.minRow + 1,
            };
          } else {
            map[key] = { isOrigin: false };
          }
        }
      }
    });
    return map;
  }, [mergedCells, cols]);

  const colLetters = useMemo(() => {
    const arr = [];
    for (let c = 1; c <= cols; c++) arr.push(colNumToLetter(c));
    return arr;
  }, [cols]);

  const getColWidth  = (letter) => Math.round((colWidths[letter]  || 64) * scale);
  const getRowHeight = (rowNum)  => Math.round((rowHeights[rowNum] || 20) * scale);
  const totalWidth   = colLetters.reduce((s, l) => s + getColWidth(l), 0);

  function getCellStyle(cellData, rowNum, rowSpan) {
    if (!cellData) return {};
    const { border, font, bgColor, align } = cellData;
    let h = 0;
    for (let rs = 0; rs < rowSpan; rs++) h += getRowHeight(rowNum + rs);
    return {
      boxSizing:       "border-box",
      overflow:        "hidden",
      padding:         "1px 2px",
      height:          h,
      fontSize:        font?.size ? `${Math.round(font.size * scale)}px` : "11px",
      fontWeight:      font?.bold ? "bold" : "normal",
      color:           font?.color || "#000",
      backgroundColor: bgColor || "transparent",
      textAlign:       align?.h === "center" ? "center" : align?.h === "right" ? "right" : "left",
      verticalAlign:   align?.v === "center" ? "middle" : align?.v === "top" ? "top" : "bottom",
      whiteSpace:      align?.wrap ? "pre-wrap" : "nowrap",
      borderTop:    border?.top    || "none",
      borderBottom: border?.bottom || "none",
      borderLeft:   border?.left   || "none",
      borderRight:  border?.right  || "none",
    };
  }

  const table = (
    <div
      style={{
        overflowX: printMode ? "visible" : "auto",
        overflowY: printMode ? "visible" : "auto",
        fontFamily: "Meiryo, 'MS PGothic', sans-serif",
        lineHeight: 1.2,
      }}
    >
      <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: totalWidth }}>
        <colgroup>
          {colLetters.map((l) => <col key={l} style={{ width: getColWidth(l) }} />)}
        </colgroup>
        <tbody>
          {Array.from({ length: rows }, (_, ri) => {
            const rowNum = ri + 1;
            return (
              <tr key={rowNum} style={{ height: getRowHeight(rowNum) }}>
                {colLetters.map((letter, ci) => {
                  const colNum = ci + 1;
                  const mInfo  = mergedMap[`${rowNum}-${colNum}`];
                  if (mInfo && !mInfo.isOrigin) return null;
                  const colSpan  = mInfo?.colSpan || 1;
                  const rowSpan  = mInfo?.rowSpan || 1;
                  const cellData = cells[`${letter}${rowNum}`];
                  const style    = getCellStyle(cellData, rowNum, rowSpan);
                  const display  = cellData?.value != null ? String(cellData.value) : "";
                  return (
                    <td
                      key={letter}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      style={style}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // 印刷プレビューモード
  if (printMode && pageSetup) {
    const printScale = (pageSetup.scale ?? 100) / 100;
    const paperW = A4_W_MM * MM_TO_PX;
    const paperH = A4_H_MM * MM_TO_PX;
    const mL = (margins.left_mm   || 0) * MM_TO_PX;
    const mR = (margins.right_mm  || 0) * MM_TO_PX;
    const mT = (margins.top_mm    || 0) * MM_TO_PX;
    const mB = (margins.bottom_mm || 0) * MM_TO_PX;

    return (
      <>
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .excel-print-page, .excel-print-page * { visibility: visible; }
            .excel-print-page { position: fixed; top: 0; left: 0; }
            @page {
              size: A4 landscape;
              margin: ${margins.top_mm || 9}mm ${margins.right_mm || 5}mm
                      ${margins.bottom_mm || 5}mm ${margins.left_mm || 7}mm;
            }
          }
        `}</style>
        <div
          className="excel-print-page"
          style={{
            width: paperW, height: paperH,
            paddingTop: mT, paddingBottom: mB, paddingLeft: mL, paddingRight: mR,
            boxSizing: "border-box",
            backgroundColor: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            margin: "0 auto",
            overflow: "hidden",
          }}
        >
          <div style={{ transform: `scale(${printScale})`, transformOrigin: "top left" }}>
            {table}
          </div>
        </div>
      </>
    );
  }

  return table;
}
