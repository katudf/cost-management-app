import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateAge,
  calculateTenure,
  toDateStr,
  addDays,
  getDayOfWeek,
  getMonday,
} from './dateUtils';

describe('dateUtils', () => {
  beforeEach(() => {
    // テストでの基準現在時刻を「2026-05-27」に固定する
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-27T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateAge', () => {
    it('生年月日がnullまたは空の場合はハイフンを返すこと', () => {
      expect(calculateAge(null)).toBe('-');
      expect(calculateAge(undefined)).toBe('-');
      expect(calculateAge('')).toBe('-');
    });

    it('誕生日を過ぎている場合の年齢を正しく計算すること', () => {
      // 1990-05-20 生まれ（2026-05-27時点では誕生日を過ぎているので36歳）
      expect(calculateAge('1990-05-20')).toBe(36);
    });

    it('誕生日を迎えていない場合の年齢を正しく計算すること', () => {
      // 1990-06-01 生まれ（2026-05-27時点ではまだ誕生日を迎えていないので35歳）
      expect(calculateAge('1990-06-01')).toBe(35);
    });
  });

  describe('calculateTenure', () => {
    it('入社日がnullまたは空の場合はハイフンを返すこと', () => {
      expect(calculateTenure(null)).toBe('-');
      expect(calculateTenure('')).toBe('-');
    });

    it('勤続年数・月数を正しく計算すること', () => {
      // 入社日: 2024-03-27、現在: 2026-05-27（ちょうど2年2ヶ月）
      expect(calculateTenure('2024-03-27')).toBe('2年2ヶ月');
    });

    it('1年未満の場合にヶ月のみで表記すること', () => {
      // 入社日: 2025-10-27、現在: 2026-05-27（7ヶ月）
      expect(calculateTenure('2025-10-27')).toBe('7ヶ月');
    });

    it('ちょうど整数の年の場合にヶ月を表示しないこと', () => {
      // 入社日: 2024-05-27、現在: 2026-05-27（ちょうど2年）
      expect(calculateTenure('2024-05-27')).toBe('2年');
    });

    it('退職日（resignationDate）が指定されている場合に、退職日基準で計算すること', () => {
      // 入社日: 2020-04-01, 退職日: 2023-08-15
      expect(calculateTenure('2020-04-01', '2023-08-15')).toBe('3年4ヶ月');
    });
  });

  describe('toDateStr', () => {
    it('Dateオブジェクトを YYYY-MM-DD 形式の文字列に変換すること', () => {
      const d = new Date('2026-05-27T00:00:00');
      expect(toDateStr(d)).toBe('2026-05-27');
    });
  });

  describe('addDays', () => {
    it('日付を正しく加算できること', () => {
      const d = new Date('2026-05-27T00:00:00');
      const result = addDays(d, 3);
      expect(toDateStr(result)).toBe('2026-05-30');
    });

    it('負の値を指定したときに減算できること', () => {
      const d = new Date('2026-05-27T00:00:00');
      const result = addDays(d, -7);
      expect(toDateStr(result)).toBe('2026-05-20');
    });
  });

  describe('getDayOfWeek', () => {
    it('曜日の日本語表記を正しく返すこと', () => {
      expect(getDayOfWeek(new Date('2026-05-27'))).toBe('水'); // 2026-05-27は水曜日
      expect(getDayOfWeek(new Date('2026-05-24'))).toBe('日'); // 2026-05-24は日曜日
    });
  });

  describe('getMonday', () => {
    it('指定された日付の週の月曜日を返すこと', () => {
      // 2026-05-27（水曜日）の週の月曜日は 2026-05-25
      const monday = getMonday(new Date('2026-05-27'));
      expect(toDateStr(monday)).toBe('2026-05-25');
    });

    it('日曜日を指定したときに、その週（前週月曜日）を返すこと', () => {
      // 2026-05-24（日曜日）の週の月曜日は 2026-05-18
      const monday = getMonday(new Date('2026-05-24'));
      expect(toDateStr(monday)).toBe('2026-05-18');
    });
  });
});
