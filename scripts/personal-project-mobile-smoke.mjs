import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
await context.request.post('http://127.0.0.1:12402/api/auth/login', {
  data: { username: 'demo', password: 'Demo2026' },
});
await context.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const page = await context.newPage();
await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tab').filter({ hasText: '题库' }).first().click();
await page.waitForSelector('.iv-q-card', { timeout: 15000 });
await page.locator('select').nth(1).selectOption({ label: '个人项目 · 当前进度' });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('personal_cards=', await page.locator('.iv-q-card').count(), 'overflow=', overflow);
await page.screenshot({ path: 'interview-personal-source-390.png', fullPage: false });

await page.locator('.iv-tab').filter({ hasText: '知识库' }).click();
await page.waitForSelector('.kb-cat', { timeout: 15000 });
await page.locator('.kb-cat').filter({ hasText: '个人项目' }).click();
await page.waitForTimeout(300);
console.log('kb_overflow=', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
await page.screenshot({ path: 'interview-personal-kb-390.png', fullPage: false });
await browser.close();
