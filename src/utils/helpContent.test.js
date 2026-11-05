import { describe, it, expect } from 'vitest';
import { HELP_CONTENT } from './helpContent';

// AdminApp.jsx のナビにあるタブキー + 工事詳細(master)
const TAB_KEYS = ['dashboard', 'master', 'assignment', 'daily_report', 'estimate', 'workers', 'paint_db', 'settings'];

describe('HELP_CONTENT', () => {
    it.each(TAB_KEYS)('%s タブにタイトル・概要・操作がある', (key) => {
        const help = HELP_CONTENT[key];
        expect(help).toBeDefined();
        expect(help.title).toBeTruthy();
        expect(help.summary).toBeTruthy();
        expect(help.steps.length).toBeGreaterThan(0);
    });
});
