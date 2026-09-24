import { describe, it, expect } from 'vitest';
import { formatDateTime } from './dateTimeFormat';

// SettingsPanel.jsx と EstimateSidebar.jsx に重複していた日時フォーマットの一本化（§9.26）。

describe('formatDateTime', () => {
  it('ISO文字列を "YYYY/MM/DD HH:mm" に変換する', () => {
    expect(formatDateTime('2026-07-08T01:23:45.000Z')).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  });

  it('月日時分を2桁ゼロ詰めする', () => {
    const d = new Date(2026, 0, 5, 9, 3);
    expect(formatDateTime(d.toISOString())).toBe('2026/01/05 09:03');
  });

  it('falsy値には空文字を返す', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('')).toBe('');
  });

  it('不正な日時文字列には空文字を返す', () => {
    expect(formatDateTime('not-a-date')).toBe('');
  });
});
