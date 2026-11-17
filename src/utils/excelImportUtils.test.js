import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx-js-style';
import {
  findCustomerNameByHonorific, extractCustomerName, stripHonorific, parseEstimateWorkbook,
  extractHeaderNotes, extractHeaderFields, toIsoDate, sheetToRowsFromA1,
} from './excelImportUtils';
import { ITEM_TYPE, ITEM_SENTINEL } from './constants';

// 明細の1行（C列=名称, AO列=数量, AR列=単位, AT列=単価, AX列=金額）
const detailRow = (name, quantity, unit, unitPrice, amount) => {
  const row = [];
  row[2] = name;
  if (quantity !== undefined) { row[40] = quantity; row[43] = unit; row[45] = unitPrice; row[49] = amount; }
  return row;
};
const workbookFromAoa = (aoa) => {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(aoa), '見積書');
  return wb;
};

describe('parseEstimateWorkbook', () => {
  // 横・鏡なし様式（胆沢第二発電所の見積）と同じ並び
  const aoa = [
    ['見積 No.'],
    ['株式会社　中央ｺｰﾎﾟﾚｰｼｮﾝ', null, null, '御中'],
    ['下記の通りお見積り申し上げます。'],
    Object.assign(['工事場所', null, null, null, '奥州市胆沢若柳 地内'], { 31: '備考' }),
    Object.assign(['工　　期', null, null, null, ''], { 31: '※現場管理費は含まれておりません。\r\n※別途追加見積り申し上げます。' }),
    ['有効期限', null, null, null, '2026年12月30日'],
    ['支払条件', null, null, null, '月末締め翌月末払い'],
    detailRow('名　　　称'),
    detailRow('■装置台座塗装工事　※人工見積り'),
    detailRow('　労務費(塗装工)　※材料支給', 1, '人工', 25000, 25000),
    detailRow('　諸雑費(労務費×5％+まるめ)', 1, '式', 1200, 1200),
    Object.assign([], { 40: '直接工事費計', 49: 26200 }),
    detailRow('諸経費', 1, '式', 2600, 2600),
    detailRow('法定福利費', 1, '式', 4100, 4100),
    Object.assign([], { 24: '※塗料支給をお願いします。' }),
    detailRow('※足場は別途'),
    detailRow('値引き', 1, '式', -2900, -2900),
    Object.assign(detailRow('税抜合計'), { 49: 30000 }),
    Object.assign(detailRow('消費税（10%）'), { 49: 3000 }),
    Object.assign(detailRow('総　計'), { 49: 33000 }),
    Object.assign(detailRow('小計'), { 49: 30000 }),
  ];

  it('諸経費・値引きを明細行として取り込み、合計・小計・消費税・総計の行は取り込まない', () => {
    const { items, customerName } = parseEstimateWorkbook(workbookFromAoa(aoa));
    expect(customerName).toBe('株式会社　中央ｺｰﾎﾟﾚｰｼｮﾝ');
    const priced = items.filter(i => i.item_type === ITEM_TYPE.ITEM && i.category_symbol !== ITEM_SENTINEL.COMMENT);
    expect(priced.map(i => [i.name, i.amount])).toEqual([
      ['労務費(塗装工)　※材料支給', 25000],
      ['諸雑費(労務費×5％+まるめ)', 1200],
      ['諸経費', 2600],
      ['法定福利費', 4100],
      ['値引き', -2900],
    ]);
    // 原本の税抜合計 30,000 と一致する
    expect(priced.reduce((s, i) => s + i.amount, 0)).toBe(30000);
  });

  it('「■」で始まる行はグループ、数量・単位・単価・金額が空の行はコメント行として表の位置どおりに取り込む', () => {
    const { items } = parseEstimateWorkbook(workbookFromAoa(aoa));
    expect(items.map(i => [i.item_type, i.category_symbol, i.name])).toEqual([
      [ITEM_TYPE.CATEGORY, 'A', '装置台座塗装工事　※人工見積り'],
      [ITEM_TYPE.ITEM, null, '労務費(塗装工)　※材料支給'],
      [ITEM_TYPE.ITEM, null, '諸雑費(労務費×5％+まるめ)'],
      [ITEM_TYPE.ITEM, null, '諸経費'],
      [ITEM_TYPE.ITEM, null, '法定福利費'],
      [ITEM_TYPE.ITEM, ITEM_SENTINEL.COMMENT, '※塗料支給をお願いします。'],
      [ITEM_TYPE.ITEM, ITEM_SENTINEL.COMMENT, '※足場は別途'],
      [ITEM_TYPE.ITEM, null, '値引き'],
    ]);
    expect(items.filter(i => i.category_symbol === ITEM_SENTINEL.COMMENT).every(i => i.amount === null)).toBe(true);
  });

  it('表紙の「備考」欄の内容を備考に取り込む（明細のコメントは備考に入れない）', () => {
    const { notes } = parseEstimateWorkbook(workbookFromAoa(aoa));
    expect(notes).toBe('※現場管理費は含まれておりません。\n※別途追加見積り申し上げます。');
  });
});

describe('parseEstimateWorkbook（表紙の項目）', () => {
  it('工事場所・有効期限・支払条件を読み、空の工期は右側の備考本文を拾わず null にする', () => {
    const wb = workbookFromAoa([
      Object.assign(['工事場所', null, null, null, '奥州市胆沢若柳 地内'], { 31: '備考' }),
      Object.assign(['工　　期', null, null, null, ''], { 31: '※現場管理費は含まれておりません。' }),
      ['有効期限', null, null, null, '2026年12月30日'],
      ['支払条件', null, null, null, '従来通り'],
      detailRow('名　称'),
    ]);
    expect(parseEstimateWorkbook(wb)).toMatchObject({
      siteLocation: '奥州市胆沢若柳 地内',
      workPeriod: null,
      validUntil: '2026-12-30',
      paymentTerms: '従来通り',
    });
  });
});

describe('parseEstimateWorkbook（鏡あり様式の見出し）', () => {
  it('「A.」「Ｂ．」で始まる行はグループにし、先頭の英字と区切りは外す', () => {
    // A列が全行空のシート（使用範囲がC列始まり）でも列位置がずれないことも兼ねて確認する
    const wb = workbookFromAoa([
      detailRow('名　　称'),
      detailRow('A.整備工場床塗替(西側物置場含む全面)'),
      detailRow('下地調整', 412, 'm2', 600, 247200),
      detailRow('Ｂ．階段室(2階踊り場まで)'),
      detailRow('塗り床', 20, 'm2', 4000, 80000),
      detailRow('ALC面の注意事項'),
    ]);
    expect(parseEstimateWorkbook(wb).items.map(i => [i.item_type, i.category_symbol, i.name])).toEqual([
      [ITEM_TYPE.CATEGORY, 'A', '整備工場床塗替(西側物置場含む全面)'],
      [ITEM_TYPE.ITEM, null, '下地調整'],
      [ITEM_TYPE.CATEGORY, 'B', '階段室(2階踊り場まで)'],
      [ITEM_TYPE.ITEM, null, '塗り床'],
      // 英字で始まっても区切りが無ければコメント
      [ITEM_TYPE.ITEM, ITEM_SENTINEL.COMMENT, 'ALC面の注意事項'],
    ]);
  });
});

describe('extractHeaderFields', () => {
  it('工期の文字列はそのまま、有効期限は日付として読めないとき null', () => {
    expect(extractHeaderFields([
      ['工期', '契約後30日'],
      ['有効期限', '見積後3ヶ月'],
    ])).toEqual({ siteLocation: null, workPeriod: '契約後30日', validUntil: null, paymentTerms: null });
  });
});

describe('toIsoDate', () => {
  it('和暦なしの日付文字列・Excelシリアル値・Date を YYYY-MM-DD にする', () => {
    expect(toIsoDate('2026年12月30日')).toBe('2026-12-30');
    expect(toIsoDate('2026/1/5')).toBe('2026-01-05');
    expect(toIsoDate(46343)).toBe('2026-11-17');
    expect(toIsoDate(new Date(2026, 0, 2))).toBe('2026-01-02');
  });

  it('存在しない日付や日付でない値は null', () => {
    expect(toIsoDate('2026年2月30日')).toBeNull();
    expect(toIsoDate('見積後3ヶ月')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });
});

describe('extractHeaderNotes', () => {
  it('見出しと本文の間に空行がある様式（鏡あり）も読む', () => {
    const rows = [
      Object.assign(['工事場所', '取り決めの通り'], { 33: '備　考' }),
      [],
      Object.assign(['工　　期'], { 33: '※別紙項目に無い塗装工事は別途追加見積り申し上げます。' }),
      [],
      ['有効期限', '2026年11月30日'],
    ];
    expect(extractHeaderNotes(rows)).toBe('※別紙項目に無い塗装工事は別途追加見積り申し上げます。');
  });

  it('「備考」の右にある内容も読む', () => {
    expect(extractHeaderNotes([['備　考', null, '雨天順延']])).toBe('雨天順延');
  });

  it('明細表の中の文字は読まず、備考欄が無ければ null', () => {
    expect(extractHeaderNotes([detailRow('名　称'), Object.assign([], { 31: '備考' }), [null, null, null]])).toBeNull();
    expect(extractHeaderNotes([['工事名', '胆沢']])).toBeNull();
  });
});

// aoa からシートを作り、parseExcelForEstimate と同じ形（シート＋行配列）で抽出する
const extractFromAoa = (aoa) => {
  const sheet = xlsx.utils.aoa_to_sheet(aoa);
  return extractCustomerName(sheet, sheetToRowsFromA1(sheet));
};
// D13 に値を置いた 13 行のシート
const withD13 = (value, extraRows = []) => {
  const aoa = Array.from({ length: 13 }, () => []);
  aoa[12] = [null, null, null, value];
  extraRows.forEach((row, i) => { aoa[i] = row; });
  return aoa;
};

describe('extractCustomerName', () => {
  it('従来様式: D13 の文字列を顧客名にする（末尾の敬称は除く）', () => {
    expect(extractFromAoa(withD13('株式会社X'))).toBe('株式会社X');
    expect(extractFromAoa(withD13('株式会社X　御中'))).toBe('株式会社X');
  });

  it('D13 が数値なら顧客名にしない', () => {
    expect(extractFromAoa(withD13(33000))).toBeNull();
  });

  it('敬称の左にある顧客名を D13 より優先する（横・鏡なし様式）', () => {
    const aoa = withD13(33000, [[], [], ['株式会社　中央ｺｰﾎﾟﾚｰｼｮﾝ', null, '御中']]);
    expect(extractFromAoa(aoa)).toBe('株式会社　中央ｺｰﾎﾟﾚｰｼｮﾝ');
  });

  it('顧客名がどこにも無ければ null', () => {
    expect(extractFromAoa([['工事名', '胆沢']])).toBeNull();
  });
});

describe('stripHonorific', () => {
  it('空白区切りの末尾の敬称だけを除く', () => {
    expect(stripHonorific('株式会社X 御中')).toBe('株式会社X');
    expect(stripHonorific('山田太郎　様')).toBe('山田太郎');
    expect(stripHonorific('お客様')).toBe('お客様');
  });
});

describe('findCustomerNameByHonorific', () => {
  it('「御中」の左にある文字列を顧客名として返す（横・鏡なし様式）', () => {
    const rows = [
      ['見積 No.', null, null, '261117-0039-001-000'],
      [],
      ['株式会社　中央ｺｰﾎﾟﾚｰｼｮﾝ', null, null, null, '御中'],
    ];
    expect(findCustomerNameByHonorific(rows)).toBe('株式会社　中央ｺｰﾎﾟﾚｰｼｮﾝ');
  });

  it('全角スペース入りの「様」も認識する', () => {
    expect(findCustomerNameByHonorific([[' 山田太郎 ', '様 ']])).toBe('山田太郎');
  });

  it('敬称が無い場合は null', () => {
    expect(findCustomerNameByHonorific([['工事名', '胆沢']])).toBeNull();
    expect(findCustomerNameByHonorific(undefined)).toBeNull();
  });

  it('1セルに「顧客名＋空白＋御中」がまとまった様式も認識する', () => {
    expect(findCustomerNameByHonorific([['見積 No.'], ['株式会社X　御中']])).toBe('株式会社X');
  });

  it('文中に「様」を含むだけのセルは敬称とみなさない', () => {
    expect(findCustomerNameByHonorific([['A社', 'お客様各位']])).toBeNull();
  });
});
