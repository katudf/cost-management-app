import { describe, expect, it } from 'vitest';
import { getApproverStampName } from './estimateApprovalStamp';
describe('承認者印', () => {
  const estimate = { approved_by: 2, approved_at: '2026-10-01', approver: { id: 2, name: '木村　賢二' } };
  it('実際の承認者の姓を表示する', () => expect(getApproverStampName(estimate)).toBe('木村'));
  it('承認前は表示しない', () => expect(getApproverStampName({ ...estimate, approved_at: null })).toBe(''));
  it('依頼先が違っても承認証跡の本人を使用する', () => expect(getApproverStampName({ ...estimate, approver_staff_id: 3 })).toBe('木村'));
  it('別人の印は表示しない', () => expect(getApproverStampName(estimate, {id:3,name:'別人'})).toBe(''));
  it('氏名が保存された承認証跡も表示する', () => expect(getApproverStampName({ approved_by: '佐藤　勝義', approved_at: '2026-10-01' })).toBe('佐藤'));
  it('氏名形式でも承認日時がなければ表示しない', () => expect(getApproverStampName({ approved_by: '佐藤　勝義', approved_at: null })).toBe(''));
  it('ID形式で担当者情報がないときはIDを印字しない', () => expect(getApproverStampName({ approved_by: '2', approved_at: '2026-10-01' })).toBe(''));
});
