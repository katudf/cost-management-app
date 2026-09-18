import { describe, it, expect } from 'vitest';
import { injectCategorySubtotals } from './estimateCalc';
import { ITEM_TYPE } from '../utils/constants';

// EstimateEditor.jsx のプレビュー構築（sort_order 付与）と保存ペイロード構築
// （sheet_id 付与）に、ほぼ同一の「工種ごとの合　計行を注入する」ロジックが
// 別々にべた書きされていた（差分は付加フィールドのみ）。ここに一本化する。

const category = (id, name) => ({ item_type: ITEM_TYPE.CATEGORY, id, name });
const item = (amount) => ({ item_type: ITEM_TYPE.ITEM, amount });

describe('injectCategorySubtotals', () => {
    it('カテゴリの境目ごとに合　計行を挿入する', () => {
        const items = [
            category('c1', '土工'),
            item(1000),
            item(2000),
            category('c2', '型枠工'),
            item(500),
        ];

        const result = injectCategorySubtotals(items);

        expect(result.map(r => r.item_type)).toEqual([
            ITEM_TYPE.CATEGORY,
            ITEM_TYPE.ITEM,
            ITEM_TYPE.ITEM,
            ITEM_TYPE.SUBTOTAL,
            ITEM_TYPE.CATEGORY,
            ITEM_TYPE.ITEM,
            ITEM_TYPE.SUBTOTAL,
        ]);
        expect(result[3].amount).toBe(3000);
        expect(result[3].name).toBe('合　計');
        expect(result[6].amount).toBe(500);
    });

    it('先頭にカテゴリ行が無い場合は合計行を挿入しない', () => {
        const items = [item(100), item(200)];
        const result = injectCategorySubtotals(items);
        expect(result).toEqual(items);
    });

    it('空配列を渡すと空配列を返す', () => {
        expect(injectCategorySubtotals([])).toEqual([]);
    });

    it('amount が空文字/null/undefined の明細は0として合算する（NaN を伝播させない）', () => {
        const items = [
            category('c1', '土工'),
            { item_type: ITEM_TYPE.ITEM, amount: '' },
            { item_type: ITEM_TYPE.ITEM, amount: null },
            { item_type: ITEM_TYPE.ITEM, amount: undefined },
            item(1500),
        ];
        const result = injectCategorySubtotals(items);
        const subtotal = result[result.length - 1];
        expect(subtotal.item_type).toBe(ITEM_TYPE.SUBTOTAL);
        expect(subtotal.amount).toBe(1500);
    });

    it('extraFields で sort_order など任意フィールドを付与できる（プレビュー用途）', () => {
        const items = [category('c1', '土工'), item(1000)];
        const result = injectCategorySubtotals(items, (sortOrder) => ({ sort_order: sortOrder }));
        const subtotal = result[result.length - 1];
        expect(subtotal.sort_order).toBe(2);
    });

    it('extraFields で sheet_id を付与できる（保存用途）', () => {
        const items = [category('c1', '土工'), item(1000)];
        const result = injectCategorySubtotals(items, () => ({ sheet_id: 'sheet-A' }));
        const subtotal = result[result.length - 1];
        expect(subtotal.sheet_id).toBe('sheet-A');
        expect(subtotal.sort_order).toBeUndefined();
    });
});
