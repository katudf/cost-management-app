// src/EstimatePDF.jsx
// 見積書PDF出力コンポーネント（@react-pdf/renderer）

import React from 'react';
import {
  Document, Page, Text, View, StyleSheet, Font, pdf, Image
} from '@react-pdf/renderer';
import { calcTotals } from './supabaseEstimates';

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

// 日本語のハイフネーション処理を無効化（クラッシュ防止）
Font.registerHyphenationCallback(word => [word]);

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
  },
  title: { // 「御見積書」のタイトル
    fontSize: 34,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 8,
    borderBottom: '1.5pt solid #1a1a1a',
    paddingBottom: 6,
    marginBottom: 14,
    width: 320,           // ラインの長さを 320pt に固定
    alignSelf: 'center',  // 要素自体を中央に配置
  },
  coverHeaderRow: { // 見積Noと見積日の行
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  coverTwoCol: { // 顧客情報(左)と自社情報(右)を並べるためのコンテナ
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  coverLeft: { flex: 1 }, // 顧客情報側の幅調整
  coverRight: { // 自社情報側の幅調整
    width: 200,
    alignItems: 'flex-start',
    paddingTop: 12,    // 1行分下げる
    marginRight: 24,   // 左に2文字分寄せる
  },
  customerName: { // 顧客名（〇〇御中）
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 6,
    borderBottom: '0.5pt solid #555',
    paddingBottom: 3,
    width: 320,           // ラインの長さを 320pt に固定
    alignSelf: 'left',  // 要素自体を左に配置
  },
  subText: { fontSize: 12, marginBottom: 4, color: '#333' }, // 「下記の通り...」などの小テキスト
  totalBox: { // 合計金額を囲む四角いボックス全体
    flexDirection: 'row',
    border: '1.5pt solid #1a1a1a',
    marginTop: 8,
    marginBottom: 6,
    width: 380,
  },
  totalBoxLabel: { // 「合計（税込）」のラベル部分
    backgroundColor: '#dae8f5',
    padding: '5 8',
    fontSize: 24,
    fontWeight: 'bold',
    borderRight: '1pt solid #1a1a1a',
    width: 140,
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
    marginTop: 10,
    paddingTop: 8,
    flexDirection: 'row',
  },
  projectInfoLeft: { // 左側：詳細情報のブロック
    flex: 1,
    paddingRight: 15,
    marginTop: 45, // 60から45に縮小（はみ出し防止）
  },
  projectInfoRight: { // 右側：備考情報のブロック
    width: 320, // 3文字分（約40pt）拡張
    paddingLeft: 15,
    marginTop: 10, // 25から10に縮小（はみ出し防止）
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
    flex: 1,
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
    flex: 1,
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
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt dashed #888',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
  },
  categoryRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottom: '0.5pt dashed #888',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
  },
  fixedRow: {
    flexDirection: 'row',
    backgroundColor: '#fffbf0',
    borderBottom: '0.5pt dashed #888',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
  },
  subtotalRow: {
    flexDirection: 'row',
    borderBottom: '1pt solid #1a1a1a',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
  },
  netRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt dashed #888',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
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

  // セル (A4横用に幅とパディングを調整、縦の点線を追加)
  cellNo: { width: 30, paddingHorizontal: 4, paddingVertical: 4, fontSize: 9, textAlign: 'center', borderRight: '0.5pt dashed #888' },
  cellName: { flex: 2, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, borderRight: '0.5pt dashed #888' },
  cellSpec: { flex: 2, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, color: '#333', borderRight: '0.5pt dashed #888' },
  cellQty: { width: 50, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'right', borderRight: '0.5pt dashed #888' },
  cellUnit: { width: 40, paddingHorizontal: 4, paddingVertical: 4, fontSize: 9, textAlign: 'center', borderRight: '0.5pt dashed #888' },
  cellPrice: { width: 70, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'right', borderRight: '0.5pt dashed #888' },
  cellAmount: { width: 80, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'right', borderRight: '0.5pt dashed #888' },
  cellNote: { flex: 1.5, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, color: '#555' },

  // ヘッダー用セル (点線を実線に上書きしないため、ベースは同じだがヘッダー特有のスタイルがあればここへ)

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
const fmt = (val) => {
  if (val === null || val === undefined || val === '') return '';
  return Number(val).toLocaleString('ja-JP');
};

const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
};

// ============================================================
// 表紙コンポーネント
// ============================================================
const CoverPage = ({ estimate, settings, totals }) => {
  const { net, subtotal, tax, total } = totals;

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
            <Text style={S.customerName}>
              {estimate.customer?.name}　{estimate.customer_honorific === 'なし' ? '' : (estimate.customer_honorific || '御中')}
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
              {settings?.stamp_company_url && (
                <Image src={settings.stamp_company_url} style={{ position: 'absolute', top: -5, right: 80, width: 60, height: 60, objectFit: 'contain' }} />
              )}
              {settings?.stamp_representative_url && (
                <Image src={settings.stamp_representative_url} style={{ position: 'absolute', top: 15, right: 5, width: 50, height: 50, objectFit: 'contain' }} />
              )}

              <Text style={S.companyName}>
                {settings?.company_name || ''}
              </Text>
              {settings?.company_address && (
                <Text>{settings.company_address}</Text>
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

            {/* 印鑑枠部分 (有効時のみ表示など) */}
            <View style={S.stampRow}>
              {estimate.show_approver && (
                <View style={S.stampBox} />
              )}
              <View style={S.stampBox}>
                {estimate.staff?.name && (
                  <View style={S.personalStamp}>
                    <Text style={S.personalStampText}>
                      {estimate.staff.name.split(/[\s　]+/)[0]}
                    </Text>
                  </View>
                )}
              </View>
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
              <Text style={[S.projectValue, { fontWeight: 'bold' }]}>{estimate.title}</Text>
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
              <Text style={S.notesValue}>{estimate.notes || ''}</Text>
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
// 内訳明細書コンポーネント
// ============================================================
const DetailPage = ({ estimate, totals, settings }) => {
  const { net, subtotal, tax, total } = totals;
  const items = estimate.items || [];
  const nonFixed = items.filter(i => i.item_type !== 'fixed');
  const fixedItems = items.filter(i => i.item_type === 'fixed');

  // ダミー行の追加（ページ内で行枠を固定するため）
  const ROWS_PER_PAGE = 17; // ★ 追加された合計行を収めるため19から17へ縮小
  const remainder = nonFixed.length % ROWS_PER_PAGE;
  // データが0件の場合はROWS_PER_PAGE行、端数がある場合は埋める
  const paddingCount = nonFixed.length === 0 ? ROWS_PER_PAGE : (remainder === 0 ? 0 : ROWS_PER_PAGE - remainder);
  const dummyRows = Array(paddingCount).fill({
    item_type: 'dummy',
    name: '',
    spec: '',
    quantity: null,
    unit: '',
    unit_price: null,
    amount: null,
    note: ''
  });
  const dummyCount = dummyRows.length;
  const displayItems = [...nonFixed, ...dummyRows];

  // No連番カウンター
  let itemNo = 0;

  // 工種ごとの小計計算
  const categoryTotals = {};
  let currentCatId = null;
  items.forEach(item => {
    if (item.item_type === 'category') {
      currentCatId = item.id || item._tempId;
      categoryTotals[currentCatId] = 0;
    } else if (item.item_type === 'item' && currentCatId) {
      categoryTotals[currentCatId] += Number(item.amount) || 0;
    }
  });

  // 列ヘッダー（固定・各ページ繰り返し）
  const ColHeader = () => (
    <View style={S.tableHeader} fixed>
      <Text style={[S.cellNo, { textAlign: 'center' }]}>No</Text>
      <Text style={[S.cellName, { fontWeight: 'bold', textAlign: 'center' }]}>名　称</Text>
      <Text style={[S.cellSpec, { fontWeight: 'bold', textAlign: 'center' }]}>仕　様</Text>
      <Text style={[S.cellQty, { fontWeight: 'bold', textAlign: 'center' }]}>数量</Text>
      <Text style={[S.cellUnit, { fontWeight: 'bold', textAlign: 'center' }]}>単位</Text>
      <Text style={[S.cellPrice, { fontWeight: 'bold', textAlign: 'center' }]}>単価</Text>
      <Text style={[S.cellAmount, { fontWeight: 'bold', textAlign: 'center' }]}>金　額</Text>
      <Text style={[S.cellNote, { fontWeight: 'bold', textAlign: 'center' }]}>摘　要</Text>
    </View>
  );

  return (
    <Page size="A4" orientation="landscape" style={S.page} wrap>

      {/* ページヘッダー */}
      <View fixed style={{ position: 'relative', marginBottom: 10 }}>
        <Text style={S.sheetNo}>（{estimate.estimate_number}）</Text>
        <Text style={S.sheetTitle}>見積内訳明細書</Text>
      </View>

      <ColHeader />

      {/* 明細行 */}
      {displayItems.map((item, idx) => {
        if (item.item_type === 'category') {
          const catId = item.id || item._tempId;
          const catTotal = categoryTotals[catId] || 0;

          return (
            <React.Fragment key={idx}>
              {/* 工種見出し行 */}
              <View style={S.categoryRow} wrap={false}>
                <Text style={S.cellNo}></Text>
                <Text style={[S.cellName, { fontWeight: 'bold', flex: 7 }]}>
                  {item.category_symbol ? `${item.category_symbol}　` : ''}{item.name}
                </Text>
                <Text style={S.cellNote}></Text>
              </View>
            </React.Fragment>
          );
        }

        if (item.item_type === 'item') {
          itemNo++;
          return (
            <View key={idx} style={S.tableRow} wrap={false}>
              <Text style={S.cellNo}>{itemNo}</Text>
              <Text style={S.cellName}>{item.name}</Text>
              <Text style={S.cellSpec}>{item.spec || ''}</Text>
              <Text style={S.cellQty}>
                {item.quantity != null ? Number(item.quantity).toLocaleString('ja-JP') : ''}
              </Text>
              <Text style={S.cellUnit}>{item.unit || ''}</Text>
              <Text style={S.cellPrice}>
                {item.unit_price != null ? fmt(item.unit_price) : ''}
              </Text>
              <Text style={S.cellAmount}>
                {item.amount != null ? fmt(item.amount) : ''}
              </Text>
              <Text style={S.cellNote}>{item.note || ''}</Text>
            </View>
          );
        }

        // subtotal行（show_subtotals=true 時）
        if (item.item_type === 'subtotal') {
          return (
            <View key={idx} style={S.subtotalRow} wrap={false}>
              <Text style={S.cellNo}></Text>
              <Text style={[S.cellName, { flex: 5, textAlign: 'right', fontWeight: 'bold', paddingRight: 8 }]}>
                合　計
              </Text>
              <Text style={[S.cellAmount, { fontWeight: 'bold' }]}>
                {fmt(item.amount)}
              </Text>
              <Text style={S.cellNote}></Text>
            </View>
          );
        }

        // ダミー行（固定枠用）
        if (item.item_type === 'dummy') {
          return (
            <View key={`dummy_${idx}`} style={S.tableRow} wrap={false}>
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

        return null;
      })}

      {/* show_subtotals が ON の場合、最後の工種にも合計行を出す処理は
          EstimateForm保存時に subtotal行をitemsに含める実装で対応 */}

      {/* 固定費行（法定福利費・安全費） */}
      {estimate.show_fixed_fees && fixedItems.map((item, idx) => (
        <View key={`fixed_${idx}`} style={S.fixedRow} wrap={false}>
          <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellName, { borderRight: 'none' }]}>{item.name}</Text>
          <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
          <Text style={S.cellQty}>1.0</Text>
          <Text style={S.cellUnit}>式</Text>
          <Text style={S.cellPrice}></Text>
          <Text style={S.cellAmount}>{fmt(item.amount)}</Text>
          <Text style={S.cellNote}></Text>
        </View>
      ))}

      {/* 工事費（税抜合計） */}
      <View style={S.subtotalRow} wrap={false}>
        <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellName, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellQty, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellUnit, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellPrice, { textAlign: 'right', fontWeight: 'bold' }]}>工　事　費</Text>
        <Text style={[S.cellAmount, { fontWeight: 'bold' }]}>{fmt(subtotal)}</Text>
        <Text style={S.cellNote}></Text>
      </View>

      {/* 消費税 */}
      <View style={S.subtotalRow} wrap={false}>
        <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellName, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellQty, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellUnit, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellPrice, { textAlign: 'right' }]}>消　費　税</Text>
        <Text style={[S.cellAmount]}>{fmt(tax)}</Text>
        <Text style={S.cellNote}></Text>
      </View>

      {/* 税込合計 */}
      <View style={S.subtotalRow} wrap={false}>
        <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellName, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellQty, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellUnit, { borderRight: 'none' }]}></Text>
        <Text style={[S.cellPrice, { textAlign: 'right', fontWeight: 'bold' }]}>税込合計</Text>
        <Text style={[S.cellAmount, { fontWeight: 'bold' }]}>{fmt(total)}</Text>
        <Text style={S.cellNote}></Text>
      </View>

      {/* NET表示（税込合計の下に配置） */}
      {estimate.show_net && (
        <View style={S.netRow} wrap={false}>
          <Text style={[S.cellNo, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellName, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellSpec, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellQty, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellUnit, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellPrice, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellAmount, { borderRight: 'none' }]}></Text>
          <Text style={[S.cellNote, { borderRight: 'none' }]}></Text>
          <View style={{ position: 'absolute', width: '100%', alignItems: 'center' }}>
            <Text style={S.netText}>【　NET金額　¥{fmt(net)}-　】</Text>
          </View>
        </View>
      )}

      <Text style={S.footerCompany} fixed>{settings?.company_name || ''}</Text>

      {/* ページ番号 */}
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
const EstimateDocument = ({ estimate, settings }) => {
  const items = estimate.items || [];
  const visibleItems = items.filter(i =>
    i.item_type === 'item' ||
    (i.item_type === 'fixed' && estimate.show_fixed_fees)
  );
  const totals = calcTotals(visibleItems, Number(estimate.tax_rate || 0.1), {
    type: estimate.net_calc_type,
    perc: estimate.net_perc,
    manualAmount: estimate.net_amount
  });

  return (
    <Document>
      <CoverPage estimate={estimate} settings={settings} totals={totals} />
      <DetailPage estimate={estimate} totals={totals} settings={settings} />
    </Document>
  );
};

// ============================================================
// PDFプレビュー・ダウンロード関数（外部から呼び出す）
// ============================================================
export const downloadEstimatePDF = async (estimate, settings) => {
  console.log('[PDF] downloadEstimatePDF 開始 (新規タブプレビュー方式)');

  // 1. 直ちに新しいタブを開く（ユーザー操作に直結させ、生成完了を待たずに確保）
  const previewWindow = window.open('', '_blank');

  if (previewWindow) {
    previewWindow.document.write(`
      <html>
        <head>
          <title>見積書生成中...</title>
          <style>
            body { 
              display: flex; 
              justify-content: center; 
              align-items: center; 
              height: 100vh; 
              margin: 0; 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
              background-color: #f8fafc;
              color: #64748b;
            }
            .loader-container { text-align: center; }
            .loader {
              border: 3px solid #e2e8f0;
              border-top: 3px solid #3b82f6;
              border-radius: 50%;
              width: 30px;
              height: 30px;
              animation: spin 1s linear infinite;
              margin: 0 auto 15px;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="loader-container">
            <div class="loader"></div>
            <p>PDFを生成しています。少々お待ちください...</p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const generateBlob = () => {
      return new Promise(async (resolve, reject) => {
        // タイムアウトを少し伸ばす（複雑な見積もり用）
        const timeoutMs = 45000;
        const timer = setTimeout(() => {
          reject(new Error('PDF生成がタイムアウトしました。'));
        }, timeoutMs);

        try {
          const doc = <EstimateDocument estimate={estimate} settings={settings} />;
          const instance = pdf(doc);
          const blob = await instance.toBlob();
          clearTimeout(timer);
          resolve(blob);
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    };

    const blob = await generateBlob();
    const url = URL.createObjectURL(blob);

    if (previewWindow && !previewWindow.closed) {
      // 2. ウィンドウが有効なら、生成したURLに遷移
      previewWindow.location.href = url;
      console.log('[PDF] 新規タブへ送信完了');
    } else {
      // ウィンドウが閉じられている、またはブロックされた場合のフォールバック（直接ダウンロード）
      console.log('[PDF] ウィンドウが無効なため直接ダウンロード実行');
      const a = document.createElement('a');
      const safeFileName = `見積書_${estimate.estimate_number}.pdf`.replace(/[\\s　]+/g, '_');
      a.href = url;
      a.download = safeFileName;
      a.click();
    }
  } catch (err) {
    console.error('[PDF] 生成エラー:', err);
    if (previewWindow) {
      previewWindow.document.body.innerHTML = `<div style="text-align:center;color:#ef4444;padding:20px;">生成に失敗しました: ${err.message}</div>`;
    }
    throw err;
  }
};

export default EstimateDocument;
