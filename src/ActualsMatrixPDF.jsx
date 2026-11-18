// src/ActualsMatrixPDF.jsx
// 実績入力の人工表PDF（@react-pdf/renderer）。1か月＝1ページ（A4横）

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import { buildActualsMatrixReport, formatPeriodLabel, formatNinku } from './utils/actualsMatrixReport';
import { NINKU_NOTE, actualsMatrixFileName } from './utils/actualsMatrixExport';

const fontBase = typeof window !== 'undefined' ? `${window.location.origin}/fonts` : '/fonts';

Font.register({
  family: 'NotoSansJP',
  fonts: [
    { src: `${fontBase}/NotoSansJP-Regular.ttf`, fontWeight: 'normal' },
    { src: `${fontBase}/NotoSansJP-Bold.ttf`, fontWeight: 'bold' },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const NAME_W = 96;
const SUM_W = 34;
const LINE = '0.5pt solid #94a3b8';
// 1ページに載せる行数（A4横。タイトル・見出しを除いた本文の行数）
const ROWS_PER_PAGE = 22;

const S = StyleSheet.create({
  page: { fontFamily: 'NotoSansJP', fontSize: 7, paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24, color: '#1a1a1a' },
  title: { fontSize: 14, fontWeight: 'bold', marginBottom: 3 },
  meta: { fontSize: 8, color: '#475569', marginBottom: 2 },
  note: { fontSize: 7, color: '#64748b', marginBottom: 6 },
  row: { flexDirection: 'row', borderLeft: LINE, borderBottom: LINE },
  cell: { borderRight: LINE, paddingVertical: 3, justifyContent: 'center', alignItems: 'center', textAlign: 'center' },
  name: { width: NAME_W, borderRight: LINE, paddingVertical: 3, paddingHorizontal: 4, justifyContent: 'center', fontWeight: 'bold' },
  sum: { width: SUM_W, borderRight: LINE, paddingVertical: 3, justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', backgroundColor: '#dbeafe' },
});

const headFill = (d) => (d.isSunday || d.isHoliday ? '#fee2e2' : d.isSaturday ? '#dbeafe' : '#f1f5f9');
const headColor = (d) => (d.isSunday || d.isHoliday ? '#dc2626' : d.isSaturday ? '#2563eb' : '#334155');
const bodyFill = (d) => (d.isSunday || d.isHoliday ? '#fef2f2' : d.isSaturday ? '#eff6ff' : undefined);

// 1か月分（行が多いときは複数ページ）
const MonthPages = ({ month, projectName, periodLabel, exportedAt }) => {
  const dayW = (842 - 48 - NAME_W - SUM_W * 2 - 1) / month.dates.length;
  const dayCell = (d, content, extra = {}) => (
    <View key={d.day} style={[S.cell, { width: dayW, backgroundColor: bodyFill(d) }, extra]}>
      <Text>{content}</Text>
    </View>
  );
  // 行が多い月は、ページ送りに任せず自分で分割し、各ページに見出し行を付ける
  // （react-pdf の fixed は先頭ページの本文と重なるため使わない）
  const items = [
    ...month.rows.map(r => ({ key: r.name, kind: 'row', r })),
    ...(month.otherRow ? [{ key: 'other', kind: 'other' }] : []),
    { key: 'total', kind: 'total' },
  ];
  const chunks = [];
  for (let i = 0; i < items.length; i += ROWS_PER_PAGE) chunks.push(items.slice(i, i + ROWS_PER_PAGE));
  // 合計行だけが次のページに取り残されないよう、最後のページが合計行だけなら1行前から送る
  if (chunks.length > 1 && chunks[chunks.length - 1].length === 1) {
    chunks[chunks.length - 1].unshift(chunks[chunks.length - 2].pop());
  }

  const renderItem = (it) => {
    if (it.kind === 'row') {
      const r = it.r;
      return (
        <View key={it.key} style={S.row} wrap={false}>
          <View style={S.name}><Text>{r.name}</Text></View>
          {month.dates.map((d, i) => dayCell(d, formatNinku(r.cells[i])))}
          <View style={S.sum}><Text>{formatNinku(r.monthTotal)}</Text></View>
          <View style={S.sum}><Text>{formatNinku(r.cumulative)}</Text></View>
        </View>
      );
    }
    if (it.kind === 'other') {
      return (
        <View key={it.key} style={S.row} wrap={false}>
          <View style={S.name}><Text style={{ fontSize: 6.5 }}>{month.otherRow.name}</Text></View>
          {month.dates.map(d => dayCell(d, ''))}
          <View style={S.sum}><Text /></View>
          <View style={S.sum}><Text>{formatNinku(month.otherRow.cumulative)}</Text></View>
        </View>
      );
    }
    return (
      <View key={it.key} style={[S.row, { backgroundColor: '#dbeafe' }]} wrap={false}>
        <View style={S.name}><Text>合計</Text></View>
        {month.dates.map((d, i) => (
          <View key={d.day} style={[S.cell, { width: dayW, fontWeight: 'bold' }]}>
            <Text>{formatNinku(month.total.cells[i])}</Text>
          </View>
        ))}
        <View style={S.sum}><Text>{formatNinku(month.total.monthTotal)}</Text></View>
        <View style={S.sum}><Text>{formatNinku(month.total.cumulative)}</Text></View>
      </View>
    );
  };

  return (
    <>
      {chunks.map((chunk, pageIndex) => (
        <Page key={pageIndex} size="A4" orientation="landscape" style={S.page}>
          <Text style={S.title}>実績入力（人工表）: {month.label}{pageIndex > 0 ? '（続き）' : ''}</Text>
          <Text style={S.meta}>工事名: {projectName || ''}</Text>
          <Text style={S.meta}>出力期間: {periodLabel}　出力日: {exportedAt}</Text>
          <Text style={S.note}>※{NINKU_NOTE}</Text>

          <View style={[S.row, { borderTop: LINE }]}>
            <View style={[S.name, { backgroundColor: '#f1f5f9' }]}><Text>作業員名</Text></View>
            {month.dates.map(d => (
              <View key={d.day} style={[S.cell, { width: dayW, backgroundColor: headFill(d) }]}>
                <Text style={{ color: headColor(d), fontWeight: 'bold' }}>{d.day}</Text>
                <Text style={{ color: headColor(d), fontSize: 6 }}>{d.dowLabel}</Text>
              </View>
            ))}
            <View style={S.sum}><Text>月合計</Text></View>
            <View style={S.sum}><Text>累計</Text></View>
          </View>

          {chunk.map(renderItem)}
        </Page>
      ))}
    </>
  );
};

export const ActualsMatrixDocument = ({ months, projectName, periodLabel, exportedAt }) => (
  <Document title={`実績入力 ${periodLabel}`}>
    {months.map(m => (
      <MonthPages key={m.monthKey} month={m} projectName={projectName} periodLabel={periodLabel} exportedAt={exportedAt} />
    ))}
  </Document>
);

// ユーザー操作に直結させて新規タブを確保（ポップアップブロック回避）。表示できなければダウンロードにする
export const downloadActualsMatrixPDF = async (params) => {
  const { projectName, startMonth, endMonth, exportedAt } = params;
  const previewWindow = window.open('', '_blank');
  if (previewWindow) {
    previewWindow.document.write(`
      <html><head><title>実績入力を生成中...</title>
      <style>body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;
        font-family:sans-serif;background:#f8fafc;color:#64748b;}</style></head>
      <body><p>PDFを生成しています。少々お待ちください...</p></body></html>`);
  }
  try {
    const { months } = buildActualsMatrixReport(params);
    const periodLabel = formatPeriodLabel(startMonth, endMonth);
    const doc = <ActualsMatrixDocument months={months} projectName={projectName} periodLabel={periodLabel} exportedAt={exportedAt} />;
    const blob = await pdf(doc).toBlob();
    const url = URL.createObjectURL(blob);
    if (previewWindow && !previewWindow.closed) {
      previewWindow.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = actualsMatrixFileName(projectName, startMonth, endMonth, 'pdf');
      a.click();
    }
  } catch (err) {
    console.error('[PDF] 実績入力の生成エラー:', err);
    if (previewWindow) {
      previewWindow.document.body.textContent = `生成に失敗しました: ${err.message}`;
    }
    throw err;
  }
};
