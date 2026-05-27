import { describe, it, expect } from 'vitest';
import {
  getSeasonConfig,
  calculateWorkHours,
  calculateNinku,
  formatTimeDisplay,
} from './workTimeUtils';

describe('workTimeUtils', () => {
  describe('getSeasonConfig', () => {
    it('夏季（3月〜10月）の設定を正しく取得できること', () => {
      // 8月は夏季
      const config = getSeasonConfig('2026-08-15');
      expect(config.label).toBe('夏季');
      expect(config.scheduledWorkHours).toBe(7.5);
      expect(config.totalBreakMinutes).toBe(120);
    });

    it('冬季（11月〜2月）の設定を正しく取得できること', () => {
      // 12月は冬季
      const config = getSeasonConfig('2026-12-15');
      expect(config.label).toBe('冬季');
      expect(config.scheduledWorkHours).toBe(7.5);
      expect(config.totalBreakMinutes).toBe(90);
    });

    it('日付が未指定の場合はデフォルト（夏季）を返すこと', () => {
      const config = getSeasonConfig(null);
      expect(config.label).toBe('夏季');
    });
  });

  describe('calculateWorkHours', () => {
    it('入力値が欠損している場合はすべて0を返すこと', () => {
      const emptyResult = {
        grossMinutes: 0,
        breakMinutes: 0,
        netWorkHours: 0,
        overtimeHours: 0,
        regularHours: 0,
      };
      expect(calculateWorkHours(null, '17:00', '2026-05-27')).toEqual(emptyResult);
      expect(calculateWorkHours('08:00', null, '2026-05-27')).toEqual(emptyResult);
    });

    it('終了時刻が開始時刻以前の場合はすべて0を返すこと', () => {
      const emptyResult = {
        grossMinutes: 0,
        breakMinutes: 0,
        netWorkHours: 0,
        overtimeHours: 0,
        regularHours: 0,
      };
      expect(calculateWorkHours('17:00', '08:00', '2026-05-27')).toEqual(emptyResult);
    });

    it('夏季の定時（08:00 - 17:30）の労働時間を正しく計算すること', () => {
      // 定時: 9.5時間拘束 - 休憩2時間 (10:00-10:30, 12:00-13:00, 15:00-15:30) = 7.5時間労働
      const result = calculateWorkHours('08:00', '17:30', '2026-08-15');
      expect(result.netWorkHours).toBe(7.5);
      expect(result.breakMinutes).toBe(120);
      expect(result.overtimeHours).toBe(0);
      expect(result.regularHours).toBe(7.5);
    });

    it('冬季の定時（08:00 - 17:00）の労働時間を正しく計算すること', () => {
      // 定時: 9時間拘束 - 休憩1.5時間 (10:00-10:15, 12:00-13:00, 15:00-15:15) = 7.5時間労働
      const result = calculateWorkHours('08:00', '17:00', '2026-12-15');
      expect(result.netWorkHours).toBe(7.5);
      expect(result.breakMinutes).toBe(90);
      expect(result.overtimeHours).toBe(0);
      expect(result.regularHours).toBe(7.5);
    });

    it('残業（定時以降）が発生した場合の計算が正しいこと', () => {
      // 夏季：08:00 - 19:30（定時17:30から2時間残業）
      const result = calculateWorkHours('08:00', '19:30', '2026-08-15');
      // 総労働: 11.5時間 - 休憩2時間 = 9.5時間実労働
      expect(result.netWorkHours).toBe(9.5);
      expect(result.overtimeHours).toBe(2);
      expect(result.regularHours).toBe(7.5);
    });

    it('早出（定時以前）が発生した場合の計算が正しいこと', () => {
      // 夏季：07:00 - 17:30（定時08:00から1時間早出）
      const result = calculateWorkHours('07:00', '17:30', '2026-08-15');
      expect(result.netWorkHours).toBe(8.5);
      expect(result.overtimeHours).toBe(1);
      expect(result.regularHours).toBe(7.5);
    });

    it('日跨ぎ（翌日フラグ）での夜勤労働時間を正しく計算すること', () => {
      // 夜勤: 20:00 - 翌05:00 (isOvernight = true)
      // 拘束: 9時間、休憩は12時〜13時などの昼休憩はないため0
      const result = calculateWorkHours('20:00', '05:00', '2026-08-15', true);
      expect(result.netWorkHours).toBe(9.0);
      expect(result.breakMinutes).toBe(0);
      // 夜勤は全時間帯が時間外(残業)扱いになる
      expect(result.overtimeHours).toBe(9.0);
    });
  });

  describe('calculateNinku', () => {
    it('労働時間から人工数を正しく計算すること（小数点第一位四捨五入/補正）', () => {
      // 夏季は定時 7.5 時間
      expect(calculateNinku(7.5, '2026-08-15')).toBe(1.0);
      expect(calculateNinku(3.75, '2026-08-15')).toBe(0.5);
      expect(calculateNinku(15.0, '2026-08-15')).toBe(2.0);
    });
  });

  describe('formatTimeDisplay', () => {
    it('時刻文字列をHH:MM形式にトリミングすること', () => {
      expect(formatTimeDisplay('08:30:00')).toBe('08:30');
      expect(formatTimeDisplay('17:45')).toBe('17:45');
      expect(formatTimeDisplay(null)).toBe('');
    });
  });
});
