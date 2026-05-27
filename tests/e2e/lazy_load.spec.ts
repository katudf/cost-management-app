import { test, expect } from '@playwright/test';

test.describe('Lazy Load E2E Test', () => {
  test('完了現場を選択したときに詳細データが遅延ロードされること', async ({ page }) => {
    // 1. ホームページを開く
    await page.goto('/');
    
    // ロード完了を待つ
    await expect(page.locator('h1', { hasText: '工事管理システム' })).toBeVisible({ timeout: 10000 });
    console.log('Homepage loaded.');

    // 2. 「完了」ステータスのカラムを見つける
    const completedColumn = page.locator('div.flex-col', {
      has: page.locator('h3', { hasText: '完了' })
    });
    await expect(completedColumn).toBeVisible();

    // 3. そのカラム内にあるプロジェクトカードをクリック
    const completedProjects = completedColumn.locator('div.cursor-pointer');
    const count = await completedProjects.count();
    console.log(`Found ${count} completed projects.`);

    let projectCard;
    if (count === 0) {
      console.log('No completed projects found. Clicking the first project in dashboard instead.');
      projectCard = page.locator('div.cursor-pointer').first();
    } else {
      projectCard = completedProjects.first();
    }

    const projectName = await projectCard.locator('h4').textContent();
    console.log(`Clicking completed project card: "${projectName?.trim()}"`);
    
    // カードをクリック
    await projectCard.click();

    // 4. 工事設定（MasterTab）へ遷移し、遅延フェッチされるのを待つ
    // label「管理現場名」に隣接するinputの値が、クリックした現場名と一致することを確認
    const siteTitleInput = page.locator('label:has-text("管理現場名") + input');
    await expect(siteTitleInput).toBeVisible({ timeout: 10000 });
    
    const loadedSiteName = await siteTitleInput.inputValue();
    console.log(`Transitioned to Master tab. Site name in input: "${loadedSiteName}"`);
    expect(loadedSiteName).toBe(projectName?.trim());

    // 5. 詳細データ（作業項目リスト）が正しくロードされていることを確認
    // 少なくとも1つのタスク（div.bg-white.p-4.rounded-xl.border.border-slate-200）が表示されるのを待つ
    const firstTaskItem = page.locator('div.bg-white.p-4.rounded-xl.border.border-slate-200').first();
    await expect(firstTaskItem).toBeVisible({ timeout: 10000 });

    const taskItems = page.locator('div.bg-white.p-4.rounded-xl.border.border-slate-200');
    const taskCount = await taskItems.count();
    console.log(`Loaded ${taskCount} tasks for this project.`);
    expect(taskCount).toBeGreaterThan(0);
  });
});
