import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const login = await context.request.post('http://127.0.0.1:12402/api/auth/login', {
  data: { username: 'demo', password: 'Demo2026' },
});
console.log('login_status=', login.status());
await context.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.iv-tab', { timeout: 15000 });

const counts = await page.locator('.iv-tab-count').allTextContents();
console.log('tab_counts=', counts.join(' / '));

await page.locator('.iv-tab').filter({ hasText: '题库' }).first().click();
await page.waitForSelector('.iv-q-card', { timeout: 15000 });
await page.locator('select').nth(1).selectOption({ label: '个人项目 · 当前进度' });
await page.waitForTimeout(500);
const personalCards = await page.locator('.iv-q-card').count();
console.log('personal_cards=', personalCards);
console.log('personal_titles=', (await page.locator('.iv-q-card').locator('h3').allTextContents()).slice(0, 3).join(' | '));
await page.screenshot({ path: 'interview-personal-source-1440.png', fullPage: false });

await page.locator('.iv-tab').filter({ hasText: '项目特训' }).click();
await page.waitForSelector('.iv-project-strip', { timeout: 15000 });
const groupText = await page.locator('.iv-project-group').allTextContents();
console.log('project_groups=', groupText.join(' | '));
await page.screenshot({ path: 'interview-personal-matrix-1440.png', fullPage: false });

await page.locator('.iv-tab').filter({ hasText: '知识库' }).click();
await page.waitForSelector('.kb-article-item', { timeout: 15000 });
await page.locator('.kb-cat').filter({ hasText: '个人项目' }).click();
await page.waitForTimeout(300);
const kbTitles = await page.locator('.kb-article-item').allTextContents();
console.log('kb_personal_items=', kbTitles.join(' | '));
await page.locator('.kb-article-item').first().click();
await page.waitForTimeout(400);
console.log('kb_article_heading=', (await page.locator('.kb-article-head h1').first().textContent())?.trim());
const related = await page.locator('.kb-related, .kb-related-question, .kb-question-card').count();
console.log('related_cards=', related);
await page.screenshot({ path: 'interview-personal-kb-1440.png', fullPage: false });

console.log('page_errors=', pageErrors.length ? pageErrors.join(' | ') : 'none');
await browser.close();
