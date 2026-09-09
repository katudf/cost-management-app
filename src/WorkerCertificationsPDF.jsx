// src/WorkerCertificationsPDF.jsx
// 作業員保有資格一覧PDF出力コンポーネント（@react-pdf/renderer）

import React from 'react';
import {
  Document, Page, Text, View, StyleSheet, Font, pdf
} from '@react-pdf/renderer';

// ============================================================
// フォント登録（EstimatePDF.jsx と同じNotoSansJPを使用）
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

// 日本語の折り返しでハイフンが付与されるのを防ぐ
Font.registerHyphenationCallback((word) => [word]);

// ============================================================
// スタイル定義
// ============================================================
const S = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 32,
    color: '#1a1a1a',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    letterSpacing: 4,
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 8,
  },
  headerMeta: { fontSize: 9, color: '#555' },

  // テーブル
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#dae8f5',
    borderTop: '1pt solid #1a1a1a',
    borderBottom: '1pt solid #1a1a1a',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
  },
  row: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #aaa',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
  },
  // 同一作業員の2件目以降の行（氏名セルの上罫線を消して結合表現）
  rowGrouped: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #aaa',
    borderLeft: '1pt solid #1a1a1a',
    borderRight: '1pt solid #1a1a1a',
    minHeight: 20,
  },
  // セル幅（合計値は cellName以外の固定幅 + flex）
  cellNo: { width: 30, paddingHorizontal: 4, paddingVertical: 4, fontSize: 9, textAlign: 'center', borderRight: '0.5pt solid #aaa', justifyContent: 'center' },
  cellWorker: { width: 110, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, fontWeight: 'bold', borderRight: '0.5pt solid #aaa', justifyContent: 'center' },
  cellCert: { flex: 1, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, borderRight: '0.5pt solid #aaa', justifyContent: 'center' },
  cellRegNo: { width: 120, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, borderRight: '0.5pt solid #aaa', justifyContent: 'center' },
  cellDate: { width: 80, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'center', borderRight: '0.5pt solid #aaa', justifyContent: 'center' },
  cellExpiry: { width: 80, paddingHorizontal: 6, paddingVertical: 4, fontSize: 9, textAlign: 'center', justifyContent: 'center' },

  // ヘッダー用セル
  hCell: { fontWeight: 'bold', textAlign: 'center', paddingVertical: 5 },

  emptyCert: { color: '#999' },
  expired: { color: '#E53935', fontWeight: 'bold' },

  pageNumber: {
    position: 'absolute',
    bottom: 16,
    right: 32,
    fontSize: 9,
    color: '#666',
  },
  footerNote: {
    position: 'absolute',
    bottom: 16,
    left: 32,
    fontSize: 8,
    color: '#999',
  },
});

// ============================================================
// ユーティリティ
// ============================================================
const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  return String(dateStr).replace(/-/g, '/');
};

// 有効期限が今日より前なら期限切れ
const isExpired = (dateStr) => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
};

const fmtIssueDate = (date) => {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

// ============================================================
// 一覧の行データを構築
//  各作業員の保有資格を1資格=1行に展開する。
//  資格が無い作業員も1行（資格欄に「登録なし」）として表示する。
// ============================================================
const buildRows = (workers) => {
  const rows = [];
  (workers || []).forEach((w) => {
    const certs = w.certifications || [];
    if (certs.length === 0) {
      rows.push({ worker: w, isFirst: true, cert: null });
    } else {
      certs.forEach((cert, idx) => {
        rows.push({ worker: w, isFirst: idx === 0, cert });
      });
    }
  });
  return rows;
};

// ============================================================
// ドキュメント本体
// ============================================================
const WorkerCertificationsDocument = ({ workers, companyName }) => {
  const rows = buildRows(workers);
  const issuedAt = fmtIssueDate(new Date());

  // No.は作業員単位で採番
  let workerNo = 0;

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={S.page} wrap>
        <Text style={S.title}>保 有 資 格 一 覧</Text>
        <View style={S.headerRow}>
          <Text style={S.headerMeta}>{companyName || ''}</Text>
          <Text style={S.headerMeta}>作成日：{issuedAt}</Text>
        </View>

        {/* 列ヘッダー（各ページ繰り返し） */}
        <View style={S.tableHeader} fixed>
          <Text style={[S.cellNo, S.hCell]}>No.</Text>
          <Text style={[S.cellWorker, S.hCell]}>氏　名</Text>
          <Text style={[S.cellCert, S.hCell]}>資　格　名</Text>
          <Text style={[S.cellRegNo, S.hCell]}>登録番号</Text>
          <Text style={[S.cellDate, S.hCell]}>取得日</Text>
          <Text style={[S.cellExpiry, S.hCell]}>有効期限</Text>
        </View>

        {/* 明細行 */}
        {rows.map((r, idx) => {
          if (r.isFirst) workerNo++;
          const expired = r.cert && isExpired(r.cert.expiryDate);
          return (
            <View key={idx} style={S.row} wrap={false}>
              <Text style={S.cellNo}>{r.isFirst ? workerNo : ''}</Text>
              <Text style={S.cellWorker}>{r.isFirst ? r.worker.name : ''}</Text>
              {r.cert ? (
                <>
                  <Text style={S.cellCert}>{r.cert.name || ''}</Text>
                  <Text style={S.cellRegNo}>{r.cert.registrationNumber || ''}</Text>
                  <Text style={S.cellDate}>{fmtDate(r.cert.acquisitionDate)}</Text>
                  <Text style={[S.cellExpiry, expired ? S.expired : {}]}>{fmtDate(r.cert.expiryDate)}</Text>
                </>
              ) : (
                <>
                  <Text style={[S.cellCert, S.emptyCert]}>登録なし</Text>
                  <Text style={S.cellRegNo}></Text>
                  <Text style={S.cellDate}></Text>
                  <Text style={S.cellExpiry}></Text>
                </>
              )}
            </View>
          );
        })}

        {rows.length === 0 && (
          <View style={S.row} wrap={false}>
            <Text style={[S.cellCert, S.emptyCert, { flex: 1, textAlign: 'center' }]}>
              対象の作業員が登録されていません
            </Text>
          </View>
        )}

        <Text style={S.footerNote} fixed>※赤字の有効期限は期限切れを表します</Text>
        <Text
          style={S.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
};

// ============================================================
// PDFプレビュー・ダウンロード関数（外部から呼び出す）
// ============================================================
export const downloadWorkerCertificationsPDF = async (workers, companyName) => {
  // ユーザー操作に直結させて新規タブを確保（ポップアップブロック回避）
  const previewWindow = window.open('', '_blank');
  if (previewWindow) {
    previewWindow.document.write(`
      <html>
        <head><title>保有資格一覧を生成中...</title>
        <style>
          body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
            background:#f8fafc;color:#64748b;}
          .loader{border:3px solid #e2e8f0;border-top:3px solid #3b82f6;border-radius:50%;
            width:30px;height:30px;animation:spin 1s linear infinite;margin:0 auto 15px;}
          @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
        </style></head>
        <body><div style="text-align:center"><div class="loader"></div>
          <p>PDFを生成しています。少々お待ちください...</p></div></body>
      </html>
    `);
  }

  try {
    const doc = <WorkerCertificationsDocument workers={workers} companyName={companyName} />;
    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);

    if (previewWindow && !previewWindow.closed) {
      previewWindow.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = '保有資格一覧.pdf';
      a.click();
    }
  } catch (err) {
    console.error('[PDF] 保有資格一覧の生成エラー:', err);
    if (previewWindow) {
      previewWindow.document.body.innerHTML =
        `<div style="text-align:center;color:#ef4444;padding:20px;">生成に失敗しました: ${err.message}</div>`;
    }
    throw err;
  }
};

export default WorkerCertificationsDocument;
