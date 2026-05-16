const xlsx = require('xlsx-js-style');
const wb = xlsx.readFile('docs/estimate_excel_import/estimate_excel_data.xlsx');

console.log('=== Sheets:', wb.SheetNames);

// 表紙シート（1枚目）の構造を確認
const s = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(s, { header: 1 });

console.log('\n=== Sheet 1 (Cover) - first 40 rows ===');
for (let r = 0; r < Math.min(rows.length, 40); r++) {
  const row = rows[r];
  if (!row) continue;
  const cells = [];
  for (let c = 0; c < Math.min(row.length, 60); c++) {
    if (row[c] != null && row[c] !== '') {
      cells.push('[' + c + ']=' + String(row[c]).substring(0, 30));
    }
  }
  if (cells.length > 0) console.log('Row' + r + ': ' + cells.join(' | '));
}

// 2枚目以降のシートでコメント行を検出テスト
for (let si = 1; si < wb.SheetNames.length; si++) {
  const sheet = wb.Sheets[wb.SheetNames[si]];
  const sheetRows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  console.log('\n=== Sheet ' + (si + 1) + ': ' + wb.SheetNames[si] + ' ===');
  
  // コメント行候補を探す（C列に文字列があり、他の列にデータがない行）
  for (let r = 0; r < sheetRows.length; r++) {
    const row = sheetRows[r];
    if (!row) continue;
    const name = row[2]; // C列
    if (!name || typeof name !== 'string') continue;
    
    // C列以外にデータがあるかチェック
    let hasOtherData = false;
    for (let c = 0; c < row.length; c++) {
      if (c === 2) continue; // C列はスキップ
      if (row[c] != null && row[c] !== '') {
        hasOtherData = true;
        break;
      }
    }
    
    if (!hasOtherData) {
      console.log('COMMENT Row' + r + ': [2]=' + name);
    }
  }
}
