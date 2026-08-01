// src/estimate-editor/paperStyles.js
// WYSIWYGエディタの紙面スタイル定数。
//
// 移植元: src/EstimatePDF.jsx の StyleSheet S（@react-pdf/renderer、pt単位）。
// 画面上の紙面をPDFと同じ寸法比で再現するため、pt値を px に換算して使う。
// ここの値を変えるときは EstimatePDF.jsx 側との見た目の一致を必ず確認すること。

// pt → px 換算（CSS: 1pt = 96/72 px）
export const pt = (v) => (v * 96) / 72;

// A4横: 842×595pt ≈ 1123×794px
export const PAPER_WIDTH = Math.round(pt(842));
export const PAPER_HEIGHT = Math.round(pt(595));

// 1ページのデータ行数（列ヘッダー行含めず）— EstimatePDF.jsx DetailPage と同値
export const ROWS_PER_PAGE = 19;

// ============================================================
// 色
// ============================================================
export const COLORS = {
  ink: '#1a1a1a',          // 基本文字色・実線罫線
  headerBg: '#dae8f5',     // 列ヘッダー・合計ラベルの薄い水色
  categoryBg: '#f8fafc',   // 工種見出し行の背景
  dashed: '#888',          // 破線罫線
  subInk: '#333',          // 仕様セル等のやや薄い文字
  noteInk: '#555',         // 摘要セルの文字
  labelInk: '#444',        // 鑑の項目ラベル
  muted: '#666',           // フッター・ページ番号
  stampRed: '#E53935',     // 担当者丸印の赤
  linkBg: '#eef6ff',       // リンク行（他シート合計/カテゴリ小計参照）の背景
  cycleBg: '#fdecec',      // 循環参照で無効化されたリンク行の背景
};

// ============================================================
// ページ共通（S.page）
// ============================================================
export const page = {
  paddingTop: pt(30),
  paddingBottom: pt(30),
  paddingX: pt(40),
  fontSize: pt(9),
};

// ============================================================
// 表紙（鑑）— S の Cover 系スタイル
// ============================================================
export const cover = {
  outerBorderPadding: pt(16),          // outerBorder.padding
  titleFontSize: pt(34),               // 「御見積書」
  titleLetterSpacing: pt(8),
  titleWidth: pt(320),                 // 下線の長さ
  titlePaddingBottom: pt(6),
  titleMarginBottom: pt(10),
  headerFontSize: pt(12),              // 見積No・見積日の行
  headerRowMarginBottom: pt(8),
  leftWidth: pt(460),                  // 顧客情報側（coverLeft）
  rightWidth: pt(200),                 // 自社情報側（coverRight）
  rightPaddingTop: pt(12),
  rightMarginRight: pt(24),
  customerFontSize: pt(24),            // 顧客名（calcFontSizeの基準値）
  customerMaxChars: 40,
  subTextFontSize: pt(12),             // 「下記の通り...」等
  totalBoxWidth: pt(380),              // 合計金額ボックス
  totalBoxLabelWidth: pt(150),
  totalBoxFontSize: pt(24),
  companyFontSize: pt(12),             // 自社情報テキスト
  companyNameFontSize: pt(14),
  companyLineHeight: 1.6,
  stampBoxSize: pt(44),                // 印鑑の四角枠
  personalStampSize: pt(32),           // 担当者の丸印
  personalStampFontSize: pt(12),
  companyStampSize: pt(60),            // 社判（absolute: top -5 / right 80）
  companyStampTop: pt(-5),
  companyStampRight: pt(80),
  representativeStampSize: pt(50),     // 代表印（absolute: top 15 / right 5）
  representativeStampTop: pt(15),
  representativeStampRight: pt(5),
  projectLabelWidth: pt(65),           // 工事名などの項目ラベル
  projectFontSize: pt(13),
  projectValueWidth: pt(280),
  projectInfoLeftMarginTop: pt(20),
  projectInfoRightWidth: pt(320),      // 備考ブロック
  projectInfoRightPaddingLeft: pt(15),
  notesLabelWidth: pt(24),
  notesLabelMarginLeft: pt(12),
  notesValueWidth: pt(290),
  notesMaxChars: 100,
  titleValueMaxChars: 40,              // 工事名（fontSize 13 基準）
};

// ============================================================
// 明細テーブル — S のテーブル系スタイル
// ============================================================
export const table = {
  sheetTitleFontSize: pt(16),          // 「見積内訳明細書」
  sheetNoFontSize: pt(9),              // 左上の（見積番号）
  headerHeight: pt(22),                // 列ヘッダー行
  rowHeight: pt(23),                   // データ行
  cellFontSize: pt(9),
  cellPaddingY: pt(4),
  cellPaddingX: pt(6),
  cellPaddingXNarrow: pt(4),           // No・単位セル
  colNoWidth: pt(30),
  colQtyWidth: pt(50),
  colUnitWidth: pt(25),
  colPriceWidth: pt(60),
  colAmountWidth: pt(60),
  nameFlex: 2,
  specFlex: 3,
  noteFlex: 0.8,
  footerFontSize: pt(9),               // ページ下部の会社名・ページ番号
};

// ============================================================
// ユーティリティ（EstimatePDF.jsx より移植）
// ============================================================

// 金額等のカンマ区切り表示
export const fmt = (val) => {
  if (val === null || val === undefined || val === '') return '';
  return Number(val).toLocaleString('ja-JP');
};

// 日付の和暦風表示（Y年M月D日）
export const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

// テキスト長に応じたフォントサイズ自動縮小（下限は baseSize の 50%）
export const calcFontSize = (text, baseSize, maxChars) => {
  if (!text) return baseSize;
  const len = text.length;
  if (len <= maxChars) return baseSize;
  const ratio = maxChars / len;
  return Math.max(baseSize * 0.5, baseSize * ratio);
};
