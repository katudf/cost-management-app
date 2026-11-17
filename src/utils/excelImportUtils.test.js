import { describe, it, expect } from 'vitest';
import * as xlsx from 'xlsx-js-style';
import { findCustomerNameByHonorific, extractCustomerName, stripHonorific } from './excelImportUtils';

// aoa からシートを作り、parseExcelForEstimate と同じ形（シート＋行配列）で抽出する
const extractFromAoa = (aoa) => {
  const sheet = xlsx.utils.aoa_to_sheet(aoa);
  return extractCustomerName(sheet, xlsx.utils.sheet_to_json(sheet, { header: 1 }));
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
