import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProjectExcelImportModal from './ProjectExcelImportModal';

const render = (props = {}) => renderToStaticMarkup(
    <ProjectExcelImportModal
        parsed={{ projectName: '', items: [{ name: 'A', amount: '1000' }, { name: 'B', amount: '2500' }, { name: ' ', amount: '9' }] }}
        fileName="見積.xlsx"
        customerLabel="テスト商事"
        onConfirm={() => {}}
        onCancel={() => {}}
        {...props}
    />
);

describe('ProjectExcelImportModal', () => {
    it('工事名はファイル名（拡張子なし）が初期値、件数・合計・顧客を表示', () => {
        const html = render();
        expect(html).toContain('value="見積"');
        expect(html).toContain('2 件');
        expect(html).toContain('¥3,500');
        expect(html).toContain('テスト商事');
    });
    it('parsed.projectName を優先', () => {
        expect(render({ parsed: { projectName: '本館', items: [{ name: 'A', amount: 1 }] } })).toContain('value="本館"');
    });
    it('顧客未設定の表示', () => {
        expect(render({ customerLabel: '' })).toContain('（未設定）');
    });
    it('同名の現場があれば警告を表示', () => {
        expect(render({ existingSiteNames: ['見積'] })).toContain('同名の現場が既にあります');
        expect(render({ existingSiteNames: ['別'] })).not.toContain('同名の現場が既にあります');
    });
    it('busy 時は取込中表示でボタン無効', () => {
        const html = render({ busy: true });
        expect(html).toContain('取込中...');
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>キャンセル/);
    });
    it('明細が空なら取り込むボタンは無効', () => {
        const html = render({ parsed: { items: [] } });
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>取り込む/);
    });
});
