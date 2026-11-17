import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// ヘルプが触れている画面上の名前が、実装側の画面にまだ存在することを確かめる
// （画面の文言を変えたのにヘルプが古いまま、を検出する）
const UI_LABELS = [
    ['estimate', '単価の一括調整', 'src/estimate-editor/SettingsPanel.jsx'],
    ['assignment', '予定人数', 'src/components/assignment/AssignmentPopup.jsx'],
    ['dashboard', '協力業者の契約', 'src/components/tabs/SubcontractContractsPanel.jsx'],
    ['workers', '下請け会社', 'src/components/tabs/SubcontractorMasterSection.jsx'],
];

describe('HELP_CONTENT と画面の文言', () => {
    it.each(UI_LABELS)('%s のヘルプの「%s」が %s に存在する', (key, label, file) => {
        const help = HELP_CONTENT[key];
        const text = [help.summary, ...help.steps, ...(help.notes || [])].join('\n');
        expect(text).toContain(label);
        const path = fileURLToPath(new URL(`../../${file}`, import.meta.url));
        // コメント行だけに残った語では通さない
        const code = readFileSync(path, 'utf-8').split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(code).toContain(label);
    });
});
