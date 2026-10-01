// src/EstimatePDF.jsx
// 見積書PDF出力コンポーネント（@react-pdf/renderer）

import React from 'react';
import { getApproverStampName } from './utils/estimateApprovalStamp';
import { estimatePdfFileName } from './utils/estimatePdfDelivery';
import { ReformAssociationLogoPDF } from './estimate-editor/ReformAssociationLogoPDF';
import {
  Document, Page, Text, View, StyleSheet, Font, pdf, Image
} from '@react-pdf/renderer';
import { calcTopSheetTotals } from './supabaseEstimates';
import { fmt, fmtDate, calcFontSize, fitSingleLineFontSize, ROWS_PER_PAGE } from './estimate-editor/paperStyles';
import { buildSheetRowsShared } from './estimate-editor/sheetRowLayout';

// ============================================================
// フォント登録
// ============================================================
const fontBase = typeof window !== 'undefined'
  ? `${window.location.origin}/fonts`
  : '/fonts';

Font.register({
  family: 'NotoSansJP',
  fonts: [
    { src: `${fontBase}/NotoSansJP-Regular.ttf`, fontWeight: 'normal' },
    { src: `${fontBase}/NotoSansJP-Bold.ttf`, fontWeight: 'bold' },
  ],
});

// 苗字印章用の明朝体フォント（Webフォント）を登録
Font.register({
  family: 'ShipporiMincho',
  src: 'https://fonts.gstatic.com/s/shipporimincho/v17/VdGGAZweH5EbgHY6YExcZfDoj0BA2w.ttf'
});

// 日本語テキストの折り返し対応（ハイフンなし）
// @react-pdf/rendererはデフォルトでハイフンを付与して折り返すため、
// ハイフネーションを無効化した上で、微小な空白（Hair Space: \u200A）を各文字間に挿入して
// 自然な折り返しを実現する。（\u200Bは内部で単語区切りとして認識されないため不可）
Font.registerHyphenationCallback((word) => [word]);

const wrapText = (text) => {
  if (!text) return '';
  const str = String(text);
  // 短い単語の途中改行を防ぐ
  if (str.length <= 10) return str;
  
  // React-PDFの強制ハイフン付与を回避するため、
  // 単語区切りとして認識される正規のスペース（\u0020）を挿入するが、
  // フォントサイズを極小（0.1）かつ透明にして画面上は見えなくする
  const elements = [];
  const arr = Array.from(str);
  for (let i = 0; i < arr.length; i++) {
    elements.push(<Text key={`char-${i}`}>{arr[i]}</Text>);
    if (i < arr.length - 1) {
      elements.push(
        <Text key={`space-${i}`} style={{ fontSize: 0.1, color: 'transparent' }}> </Text>
      );
    }
  }
  return elements;
};

// ============================================================
// スタイル定義
// ============================================================
const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    paddingTop: 30,
    paddingBottom: 30,
    paddingHorizontal: 40,
    color: '#1a1a1a',
  },

  // ---- 表紙 (CoverPage) のスタイル ----
  outerBorder: { // 全体を囲む外枠
    border: '1pt solid #333',
    padding: 16,
    flex: 1,
    overflow: 'hidden',
  },
  title: { // 「御見積書」のタイトル
    fontSize: 34,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 8,
    borderBottom: '1.5pt solid #1a1a1a',
    paddingBottom: 6,
    marginTop: 8,
    marginBottom: 30,
    width: 320,           // ラインの長さを 320pt に固定
    alignSelf: 'center',  // 要素自体を中央に配置
  },
  coverHeaderRow: { // 見積Noと見積日の行
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  coverTwoCol: { // 顧客情報(左)と自社情報(右)を並べるためのコンテナ
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  coverLeft: { width: 460 }, // 顧客情報側の幅（テキスト折り返しのため固定）
  coverRight: { // 自社情報側の幅調整
    width: 200,
    alignItems: 'flex-start',
    paddingTop: 20,
    marginRight: 24,   // 左に2文字分寄せる
  },
  customerName: { // 顧客名（〇〇御中）
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 6,
    borderBottom: '0.5pt solid #555',
    paddingBottom: 3,
  },
  subText: { fontSize: 12, marginBottom: 4, color: '#333' }, // 「下記の通り...」などの小テキスト
  totalBox: { // 合計金額を囲む四角いボックス全体
    flexDirection: 'row',
    border: '1.5pt solid #1a1a1a',
    marginTop: 16,
    marginBottom: 4,
    width: 380,
  },
  totalBoxLabel: { // 「合計（税込）」のラベル部分
    backgroundColor: '#dae8f5',
    padding: '5 8',
    fontSize: 24,
    fontWeight: 'bold',
    borderRight: '1pt solid #1a1a1a',
    width: 190,
    flexShrink: 0,
    justifyContent: 'center',
  },
  totalBoxAmount: { // 金額表示部分
    padding: '5 10',
    fontSize: 24,
    fontWeight: 'bold',
    flex: 1,
    justifyContent: 'center',
  },
  companyBlock: { // 自社情報全体のテキスト
    fontSize: 12,
    lineHeight: 1.6,
  },
  companyName: { // 自社名（太字部分）
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  stampRow: { // 印鑑枠を並べる行
    flexDirection: 'row',
    gap: 4,
    marginTop: 8,
  },
  stampBox: { // 印鑑の四角枠
    width: 44,
    height: 44,
    border: '0.5pt solid #888',
    justifyContent: 'center',
    alignItems: 'center',
  },
  personalStamp: { // 担当者の丸印
    width: 32,
    height: 32,
    borderRadius: 16,
    border: '1pt solid #E53935', // 赤色
    justifyContent: 'center',
    alignItems: 'center',
  },
  personalStampText: {
    color: '#E53935',
    fontSize: 12,
    fontFamily: 'ShipporiMincho',
  },
  projectInfoSection: { // 工事情報セクション（全体のコンテナを横並びに）
    marginTop: 4,
    paddingTop: 8,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  projectInfoLeft: { // 左側：詳細情報のブロック
    flex: 1,
    paddingRight: 15,
    marginTop: 20, // 顧客名2行化で縦スペースが減ったため圧縮
    overflow: 'hidden',
  },
  projectInfoRight: { // 右側：備考情報のブロック
    width: 320, // 3文字分（約40pt）拡張
    paddingLeft: 15,
    marginTop: 4, // 縦スペース圧縮
    overflow: 'hidden',
  },
  projectInfoRow: { // 工事情報1件分の行
    flexDirection: 'row',
    marginBottom: 4,
    borderBottom: '0.5pt dashed #ccc',
    paddingBottom: 3,
  },
  projectInfoTwoCol: { // 工事情報を横に2本並べる場合の行
    flexDirection: 'row',
    marginBottom: 4,
    borderBottom: '0.5pt dashed #ccc',
    paddingBottom: 3,
  },
  projectLabel: { // 左側の各項目名（工事名など）
    width: 65, // 52から13pt（1文字分）拡張
    fontWeight: 'bold',
    fontSize: 13,
    color: '#444',
  },
  projectValue: { // 右側の内容
    width: 280, // projectInfoLeft(flex:1 ≈ 345pt) - projectLabel(65pt) = 280pt
    fontSize: 13,
  },
  notesLabel: { // 備考ラベル特有の幅調整など
    width: 24,
    fontWeight: 'bold',
    fontSize: 13,
    color: '#444',
    marginLeft: 12,
  },
  notesValue: { // 備考内容
    width: 290, // projectInfoRight(320pt) - paddingLeft(15pt) - margin
    fontSize: 13,
  },

  // ---- 内訳明細書 ----
  sheetTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  sheetNo: {
    fontSize: 9,
    color: '#555',
    position: 'absolute',
    top: 5,
    left: 0,
  },

  // テーブル
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#dae8f5', // 薄い水色
    borderTop: '1pt solid #1a1a1a',
    borderBottom: '1pt solid #1a1a1a',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    height: 22,
    minHeight: 22,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt dashed #888',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    height: 23,
    maxHeight: 23,
    overflow: 'hidden',
  },
  categoryRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottom: '0.5pt dashed #888',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    height: 23,
    maxHeight: 23,
    overflow: 'hidden',
  },
  subtotalRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #1a1a1a',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    height: 23,
    maxHeight: 23,
    overflow: 'hidden',
  },
  netRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #1a1a1a',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    height: 23,
    maxHeight: 23,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  netText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  taxSubtotalSection: {
    marginTop: 4,
    borderTop: '0.5pt solid #888',
    alignItems: 'flex-end',
  },
  taxSubtotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 2,
    paddingRight: 4,
    width: '100%',
  },
  taxSubtotalLabel: {
    width: 80,
    textAlign: 'right',
    paddingRight: 8,
    fontSize: 10,
  },
  taxSubtotalAmount: {
    width: 70,
    textAlign: 'right',
    fontWeight: 'bold',
    fontSize: 10,
  },

  // セル (A4横用に幅とパディングを調整、縦の点線を追加、テキスト切り詰め)
  cellNo: { width: 30, paddingHorizontal: 4, paddingVertical: 4, fontSize: 9, textAlign: 'center', borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 1 },
  cellName: { flex: 2, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 2 },
  cellSpec: { flex: 3, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, color: '#333', borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 2 },
  cellQty: { width: 50, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'right', borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 1 },
  cellUnit: { width: 25, paddingHorizontal: 4, paddingVertical: 4, fontSize: 9, textAlign: 'center', borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 1 },
  cellPrice: { width: 60, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'right', borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 1 },
  cellAmount: { width: 60, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'right', borderRight: '0.5pt dashed #888', overflow: 'hidden', maxLines: 1 },
  cellNote: { flex: 0.8, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, color: '#555', overflow: 'hidden', maxLines: 2 },

  // ヘッダー用セル（テキスト非表示問題を避けるため専用スタイルを用意）
  hCellNo: { width: 30, paddingHorizontal: 4, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellName: { flex: 2, paddingHorizontal: 6, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellSpec: { flex: 3, paddingHorizontal: 6, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellQty: { width: 50, paddingHorizontal: 6, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellUnit: { width: 25, paddingHorizontal: 4, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellPrice: { width: 60, paddingHorizontal: 6, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellAmount: { width: 60, paddingHorizontal: 6, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold', borderRight: '0.5pt dashed #888' },
  hCellNote: { flex: 0.8, paddingHorizontal: 6, paddingTop: 5, fontSize: 9, textAlign: 'center', fontWeight: 'bold' },

  // ページ番号
  pageNumber: {
    position: 'absolute',
    bottom: 15,
    right: 40,
    fontSize: 9,
    color: '#666',
  },
  // フッター会社名
  footerCompany: {
    position: 'absolute',
    bottom: 15,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 9,
    color: '#666',
  },
});

// ============================================================
// ユーティリティ
// ============================================================
// fmt/fmtDate/calcFontSize は estimate-editor/paperStyles.js に一本化済み（§9.22）

// 数量は常に小数点以下1桁で表示（例: 5 → "5.0"）
const fmtQty = (val) => {
  if (val === null || val === undefined || val === '') return '';
  return Number(val).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

// ============================================================
// 表紙コンポーネント
// ============================================================
const CoverPage = ({ estimate, settings, totals }) => {
  const { net, subtotal, tax, total } = totals;

  // 顧客名の動的フォントサイズ計算（2行表示を前提に40文字基準）
  const customerFullName = `${estimate.customer?.name || ''}　${estimate.customer_honorific === 'なし' ? '' : (estimate.customer_honorific || '御中')}`;
  const customerFontSize = calcFontSize(customerFullName, 24, 40);

  // 工事名の動的フォントサイズ計算（2行表示を前提に40文字基準）
  const titleFontSize = calcFontSize(estimate.title, 13, 40);

  // 備考の動的フォントサイズ計算
  const notesFontSize = calcFontSize(estimate.notes, 13, 100);
  return (
    <Page size="A4" orientation="landscape" style={S.page}>
      <View style={S.outerBorder}>

        {/* 1. タイトル部分 (御見積書) */}
        <Text style={S.title}>御　見　積　書</Text>

        {/* 2. ヘッダー行 (見積No / 見積日) */}
        <View style={S.coverHeaderRow}>
          <Text style={{ fontSize: 12 }}>見積 No.{estimate.estimate_number}</Text>
          <Text style={{ fontSize: 12 }}>見積日 {fmtDate(estimate.issue_date)}</Text>
        </View>

        {/* 3. 顧客・合計金額(左) と 自社情報(右) の2カラム配置 */}
        <View style={S.coverTwoCol}>

          {/* 左カラム: 宛名と合計金額ボックス */}
          <View style={S.coverLeft}>
            <Text style={[S.customerName, { fontSize: customerFontSize }]}>
              {wrapText(customerFullName)}
            </Text>
            <Text style={S.subText}>下記の通りお見積り申し上げます。</Text>

            {/* 合計金額ボックス (税込表示) */}
            <View style={S.totalBox}>
              <View style={S.totalBoxLabel}>
                <Text>合計（税込）</Text>
              </View>
              <View style={S.totalBoxAmount}>
                <Text>¥{fmt(total)}-</Text>
              </View>
            </View>

            {/* 税抜金額と消費税の小テキスト */}
            <Text style={S.subText}>
              工事金額：¥{fmt(subtotal)}-　　消費税相当額：¥{fmt(tax)}-
            </Text>
          </View>

          {/* 右カラム: 自社住所・連絡先 と 印鑑枠 */}
          <View style={S.coverRight}>
            <View style={[S.companyBlock, { position: 'relative' }]}>
              {/* 印鑑画像を先に描画し、テキストの背面に配置する */}
              {estimate.stamp_header !== 'none' && settings?.stamp_company_url && (
                <Image src={settings.stamp_company_url} style={{ position: 'absolute', top: -5, right: 80, width: 60, height: 60, objectFit: 'contain' }} />
              )}
              {estimate.stamp_header !== 'none' && settings?.stamp_representative_url && (
                <Image src={settings.stamp_representative_url} style={{ position: 'absolute', top: 15, right: 5, width: 50, height: 50, objectFit: 'contain' }} />
              )}

              <Text style={S.companyName}>
                {settings?.company_name || ''}
              </Text>
              {settings?.company_address && (
                <Text style={{ fontSize: fitSingleLineFontSize(settings.company_address, 12, 198) }}>{settings.company_address}</Text>
              )}
              {settings?.company_tel && (
                <Text>TEL：{settings.company_tel}</Text>
              )}
              {settings?.company_fax && (
                <Text>FAX：{settings.company_fax}</Text>
              )}
              {estimate.staff?.name && (
                <Text>担当：{estimate.staff.name}</Text>
              )}
            </View>

            {/* 上長印欄と担当者印欄 */}
            <View style={S.stampRow}>
              <View style={S.stampBox}>
                {getApproverStampName(estimate) && (
                  <View style={S.personalStamp}>
                    <Text style={S.personalStampText}>{getApproverStampName(estimate)}</Text>
                  </View>
                )}
              </View>
              <View style={S.stampBox}>
                {estimate.staff?.name && (
                  <View style={S.personalStamp}>
                    <Text style={S.personalStampText}>
                      {estimate.staff.name.split(/[\s　]+/)[0]}
                    </Text>
                  </View>
                )}
              </View>
              {estimate.show_reform_logo && <ReformAssociationLogoPDF />}
            </View>
          </View>

        </View>

        {/* 4. 工事内容詳細セクション (左右分割レイアウト) */}
        <View style={S.projectInfoSection}>

          {/* 左ブロック: 工事詳細情報 */}
          <View style={S.projectInfoLeft}>
            {/* 工事名 */}
            <View style={S.projectInfoRow}>
              <Text style={S.projectLabel}>工  事  名</Text>
              <Text style={[S.projectValue, { fontWeight: 'bold', fontSize: titleFontSize }]}>{wrapText(estimate.title || '')}</Text>
            </View>

            {/* 工事場所 */}
            <View style={S.projectInfoRow}>
              <Text style={S.projectLabel}>工事場所 </Text>
              <Text style={S.projectValue}>{estimate.site_location || ''}</Text>
            </View>

            {/* 工期 */}
            <View style={S.projectInfoRow}>
              <Text style={S.projectLabel}>工　　期 </Text>
              <Text style={S.projectValue}>{estimate.work_period || ''}</Text>
            </View>

            {/* 有効期限 */}
            <View style={S.projectInfoRow}>
              <Text style={S.projectLabel}>有効期限 </Text>
              <Text style={S.projectValue}>{fmtDate(estimate.valid_until)}</Text>
            </View>

            {/* 支払条件 */}
            <View style={S.projectInfoRow}>
              <Text style={S.projectLabel}>支払条件</Text>
              <Text style={S.projectValue}>{estimate.payment_terms || ''}</Text>
            </View>
          </View>

          {/* 右ブロック: 備考 */}
          <View style={S.projectInfoRight}>
            <View style={{ flexDirection: 'row', marginBottom: 4 }}>
              <Text style={S.projectLabel}>備　考</Text>
            </View>
            <View>
              <Text style={[S.notesValue, { fontSize: notesFontSize }]}>{wrapText(estimate.notes || '')}</Text>
            </View>
          </View>

        </View>

      </View>

      <Text style={S.footerCompany} fixed>{settings?.company_name || ''}</Text>
      <Text style={S.pageNumber}>No.1</Text>
    </Page>
  );
};

// ============================================================
// 明細シートの行モデル構築（SheetPaper.jsx の buildSheetRows と同一アルゴリズム）
// ============================================================
// 1シート分の items を「データ行＋ダミー行＋フッター行」の行記述子配列へ変換する。
// 返り値の長さは必ず ROWS_PER_PAGE の倍数になり、19行ごとにページへ切り分ければ
// フッター行（税抜合計 / 合計 / NET）が常に最終ページ末尾へ収まる。
//   - トップシート: 税抜合計＋NET行(show_net時)。
//     消費税・税込合計は鑑(CoverPage)側にのみ表示する。
//   - サブシート : 「合　計」1行のみ（リンク解決済みのシート合計 sheetTotal）。
// 空行（No.を振らない）判定は SheetPaper.jsx と異なりセンチネル不要・空文字も空扱いにする。
const isBlankRowPDF = (item) =>
  !item.name && !item.spec &&
  (item.quantity == null || item.quantity === '') &&
  (item.unit_price == null || item.unit_price === '');

const buildSheetRowsPDF = (items, header, isTopSheet, totals, sheetTotal, showTotalRow = true) =>
  buildSheetRowsShared(items, header, isTopSheet, totals, sheetTotal, showTotalRow, isBlankRowPDF, ROWS_PER_PAGE);

// ============================================================
// 明細行1件の描画（行記述子 → @react-pdf View）
// ============================================================
const renderPdfRow = (row, idx, pageBottomBorderStyle, shouldBreak) => {
  switch (row.kind) {
    case 'category': {
      const { item, catTotal } = row;
      return (
        <View key={idx} style={[S.categoryRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellName, { fontWeight: 'bold', flex: 7, borderRight: 'none' }]}>
            {item.category_symbol ? `${item.category_symbol}　` : ''}{wrapText(item.name)}
          </Text>
          <Text style={[S.cellAmount, { fontWeight: 'bold', borderRight: 'none' }]}>
            {catTotal > 0 ? fmt(catTotal) : ''}
          </Text>
          <Text style={S.cellNote}></Text>
        </View>
      );
    }
    case 'comment': {
      const { item } = row;
      return (
        <View key={idx} style={[S.tableRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={S.cellNo}></Text>
          <Text style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 4, fontSize: fitSingleLineFontSize(item.name, 9, 718) }}>{wrapText(item.name)}</Text>
        </View>
      );
    }
    case 'item': {
      const { item, itemNo } = row;
      return (
        <View key={idx} style={[S.tableRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={S.cellNo}>{itemNo ?? ''}</Text>
          <Text style={S.cellName}>{wrapText(item.name)}</Text>
          <Text style={S.cellSpec}>{wrapText(item.spec || '')}</Text>
          <Text style={S.cellQty}>
            {item.quantity != null && item.quantity !== '' ? fmtQty(item.quantity) : ''}
          </Text>
          <Text style={S.cellUnit}>{item.unit || ''}</Text>
          <Text style={S.cellPrice}>
            {item.unit_price != null && item.unit_price !== '' ? fmt(item.unit_price) : ''}
          </Text>
          <Text style={S.cellAmount}>
            {item.amount != null && item.amount !== '' ? fmt(item.amount) : ''}
          </Text>
          <Text style={S.cellNote}>{wrapText(item.note || '')}</Text>
        </View>
      );
    }
    case 'subtotal': {
      return (
        <View key={idx} style={[S.subtotalRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={S.cellNo}></Text>
          <Text style={[S.cellName, { flex: 5, textAlign: 'right', fontWeight: 'bold', paddingRight: 8 }]}>
            合　計
          </Text>
          <Text style={[S.cellAmount, { fontWeight: 'bold' }]}>
            {fmt(row.item.amount)}
          </Text>
          <Text style={S.cellNote}></Text>
        </View>
      );
    }
    // トップシート末尾の「税抜合計」／サブシート末尾の「合　計」
    case 'total-ex-tax':
    case 'sheet-total': {
      const label = row.kind === 'total-ex-tax' ? '税抜合計' : '合　計';
      return (
        <View key={idx} style={[S.subtotalRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellName, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellQty, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellUnit, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellPrice, { textAlign: 'right', fontWeight: 'bold' }]}>{label}</Text>
          <Text style={[S.cellAmount, { fontWeight: 'bold' }]}>{fmt(row.amount)}</Text>
          <Text style={S.cellNote}></Text>
        </View>
      );
    }
    case 'net': {
      return (
        <View key={idx} style={[S.netRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellName, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellQty, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellUnit, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellPrice, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellAmount, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellNote, { borderRight: 'none' }]}></Text>
          <View style={{ position: 'absolute', width: '100%', alignItems: 'center' }}>
            <Text style={S.netText}>【　NET金額　¥{fmt(row.amount)}-　】</Text>
          </View>
        </View>
      );
    }
    case 'dummy':
    default: {
      return (
        <View key={idx} style={[S.tableRow, pageBottomBorderStyle]} wrap={false} break={shouldBreak}>
          <Text style={S.cellNo}></Text>
          <Text style={S.cellName}></Text>
          <Text style={S.cellSpec}></Text>
          <Text style={S.cellQty}></Text>
          <Text style={S.cellUnit}></Text>
          <Text style={S.cellPrice}></Text>
          <Text style={S.cellAmount}></Text>
          <Text style={S.cellNote}></Text>
        </View>
      );
    }
  }
};

// ============================================================
// 内訳明細書コンポーネント（1シート = 1 <Page> グループ）
// ============================================================
// シートモデル（design.md §4）: 各明細シートが自前の末尾合計で閉じる。
//   - トップシート: 末尾＝税抜合計（＋NET）。消費税・税込合計は鑑側。
//   - サブシート : 末尾＝合　計（リンク解決済みシート合計 sheetTotal）。
// ページ番号は鑑を No.1 とする通し番号（レンダラーが返すドキュメント全体の番号）。
const DetailPage = ({ sheet, items, isTopSheet, totals, sheetTotal, showTotalRow, settings }) => {
  const rows = buildSheetRowsPDF(items, sheet.header, isTopSheet, totals, sheetTotal, showTotalRow);
  const sheetTitle = sheet.title || '見積内訳明細書';
  const estimateNumber = sheet.header.estimate_number;

  return (
    <Page size="A4" orientation="landscape" style={S.page} wrap>

      {/* ページヘッダー */}
      <View fixed style={{ position: 'relative', marginBottom: 10 }}>
        <Text style={S.sheetNo}>（{estimateNumber}）</Text>
        <Text style={S.sheetTitle}>{sheetTitle}</Text>
      </View>

      {/* 列ヘッダー（固定・各ページ繰り返し） */}
      <View style={S.tableHeader} fixed>
        <Text style={S.hCellNo}>No.</Text>
        <Text style={S.hCellName}>名　　　　　　称</Text>
        <Text style={S.hCellSpec}>仕　　　　　　様</Text>
        <Text style={S.hCellQty}>数　量</Text>
        <Text style={S.hCellUnit}>単位</Text>
        <Text style={S.hCellPrice}>単　価</Text>
        <Text style={S.hCellAmount}>金　額</Text>
        <Text style={S.hCellNote}>摘　要</Text>
      </View>

      {/* 明細行（19行ごとに強制改ページ） */}
      {rows.map((row, idx) => {
        const shouldBreak = idx > 0 && idx % ROWS_PER_PAGE === 0;
        const isLastRowOfPage = (idx + 1) % ROWS_PER_PAGE === 0;
        const pageBottomBorderStyle = isLastRowOfPage ? { borderBottom: '1pt solid #1a1a1a' } : {};
        return renderPdfRow(row, idx, pageBottomBorderStyle, shouldBreak);
      })}

      <Text style={S.footerCompany} fixed>{settings?.company_name || ''}</Text>

      {/* 通しページ番号（pageNumber は表紙を含むドキュメント全体の番号） */}
      <Text
        style={S.pageNumber}
        render={({ pageNumber }) => `No.${pageNumber}`}
        fixed
      />
    </Page>
  );
};

// ============================================================
// ドキュメントルート
// ============================================================
// estimate.sheets: [{ id, title, items }] のシート配列（Phase 6）。
// 後方互換: sheets 未指定なら従来のフラット items を単一トップシートとして扱う。
const EstimateDocument = ({ estimate, settings }) => {
  const header = {
    estimate_number: estimate.estimate_number,
    show_net: estimate.show_net,
  };

  // シート配列を正規化。旧形式（フラット items）も1シートへ畳み込む。
  const sheets = Array.isArray(estimate.sheets) && estimate.sheets.length > 0
    ? estimate.sheets
    : [{ id: '__single__', title: '見積内訳明細書', items: estimate.items || [] }];

  // 鑑の合計はトップシートの明細から算出（リンク解決済みの値が渡る想定）。
  const topItems = sheets[0]?.items || [];
  const totals = calcTopSheetTotals(topItems, estimate);

  // 他シートの合計を参照している sheet_id 一覧（①別シート合計リンクの参照先）
  const linkedSheetIds = new Set();
  sheets.forEach(sheet => {
    (sheet.items || []).forEach(it => {
      if (it.linked_sheet_id) linkedSheetIds.add(it.linked_sheet_id);
    });
  });
  // サブシートの「合計」行を表示するか：他シートから参照されているか、末尾シートなら表示
  const shouldShowTotalRow = (sheet, idx) =>
    idx === 0 || linkedSheetIds.has(sheet.id) || idx === sheets.length - 1;

  return (
    <Document>
      <CoverPage estimate={estimate} settings={settings} totals={totals} />
      {sheets.map((sheet, idx) => (
        <DetailPage
          key={sheet.id ?? idx}
          sheet={{ ...sheet, header }}
          items={sheet.items || []}
          isTopSheet={idx === 0}
          totals={totals}
          sheetTotal={sheet.sheetTotal}
          showTotalRow={shouldShowTotalRow(sheet, idx)}
          settings={settings}
        />
      ))}
    </Document>
  );
};

// ============================================================
// PDFプレビュー・ダウンロード関数（外部から呼び出す）
// ============================================================
export const downloadEstimatePDF = async (estimate, settings) => {
  const fileName = estimatePdfFileName(estimate);
  const blob = await pdf(<EstimateDocument estimate={estimate} settings={settings} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Allow the browser to start reading the download before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
};

export default EstimateDocument;
