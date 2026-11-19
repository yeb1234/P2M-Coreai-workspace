import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
await context.request.post('http://127.0.0.1:12402/api/auth/login', {
  data: { username: 'demo', password: 'Demo2026' },
});
await context.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const page = await context.newPage();
await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tab').filter({ hasText: '模拟面试' }).click();
await page.waitForSelector('.iv-mock-question-card', { timeout: 20000 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log('scope_counts=', (await page.locator('.iv-chip-count').allTextContents()).join(' / '));
console.log('overflow=', overflow);
await page.screenshot({ path: 'mock-interview-summary-390.png', fullPage: false });
await browser.close();
