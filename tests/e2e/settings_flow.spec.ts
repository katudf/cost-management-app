import { test, expect } from '@playwright/test';

test.describe('Settings Flow E2E Test', () => {
  test('設定画面と各サブタブが正常に切り替わること', async ({ page }) => {
    // 1. ホームページを開く
    await page.goto('/');
    
    // ロード完了を待つ
    await expect(page.locator('h1', { hasText: '工事管理システム' })).toBeVisible({ timeout: 10000 });
    console.log('Homepage loaded.');

    // 2. 「設定」メインタブをクリック
    // ヘッダー内のnavにある5番目のボタン (0-indexed で 4)
    const settingsTab = page.locator('header nav button').nth(4);
    await expect(settingsTab).toBeVisible();
    await settingsTab.click();
    
    // システム共通設定のヘッダーが表示されるのを待つ
    const generalHeader = page.locator('h2', { hasText: 'システム共通設定' });
    await expect(generalHeader).toBeVisible({ timeout: 5000 });
    console.log('Successfully transitioned to Settings Tab.');

    // 3. サブタブ「資格管理」をクリック
    // サブタブコンテナの中の3番目のボタン (0-indexed で 2)
    const certTab = page.locator('div.flex.items-center.gap-2.mb-8 button').nth(2);
    await expect(certTab).toBeVisible();
    await certTab.click();

    // 資格情報マスターが表示されるのを待つ
    const certHeader = page.locator('h3', { hasText: '資格情報マスター' });
    await expect(certHeader).toBeVisible({ timeout: 5000 });
    console.log('Successfully transitioned to Certification Manager.');

    // 4. サブタブ「自社情報」をクリック
    // サブタブコンテナの中の6番目のボタン (0-indexed で 5)
    const companyTab = page.locator('div.flex.items-center.gap-2.mb-8 button').nth(5);
    await expect(companyTab).toBeVisible();
    await companyTab.click();

    // 自社情報設定が表示されるのを待つ
    const companyHeader = page.locator('h3', { hasText: '自社情報設定' });
    await expect(companyHeader).toBeVisible({ timeout: 5000 });
    console.log('Successfully transitioned to Company Info Settings.');
  });
});
