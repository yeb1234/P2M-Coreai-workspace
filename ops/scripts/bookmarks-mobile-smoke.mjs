import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addCookies([{ name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));

await page.goto('http://127.0.0.1:12302/#/bookmarks', { waitUntil: 'networkidle', timeout: 30000 });
await page.getByText('书签收藏', { exact: true }).first().waitFor({ timeout: 10000 });
const metrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  bodyScrollWidth: document.body.scrollWidth,
}));
console.log('metrics=', JSON.stringify(metrics));
console.log('cards=', await page.locator('article').count());
await page.getByRole('button', { name: '添加书签' }).click();
console.log('form_visible=', await page.getByPlaceholder('例如：FastAPI 官方文档').isVisible());
const formMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
console.log('form_metrics=', JSON.stringify(formMetrics));
await page.screenshot({ path: `${out}/bookmarks-mobile.png`, fullPage: false });
await browser.close();
