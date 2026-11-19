import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const BASE = 'http://127.0.0.1:12302';

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password: 'Demo2026' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { access_token: accessToken } = await login.json();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await context.addCookies([{
  name: 'p2m_session', value: accessToken, domain: '127.0.0.1', path: '/',
  httpOnly: true, secure: false, sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.mobile-tabbar').waitFor({ timeout: 15000 });

const state = async () => page.evaluate(() => ({
  hash: location.hash,
  activeTab: document.querySelector('.mobile-tabbar [aria-current="page"]')?.getAttribute('aria-label') ?? null,
  visibleTitle: document.querySelector('.mobile-app-main > div:not([style*="display: none"])')?.textContent?.slice(0, 28) ?? null,
}));

const steps = [];
for (const tab of ['待办', '番茄', '视频']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(500);
  steps.push({ tab, ...(await state()) });
}

await page.getByRole('button', { name: '全部功能' }).click();
await page.locator('.mobile-nav-sheet').waitFor({ timeout: 10000 });
for (const label of ['便签', '笔记', '书签收藏', '面试 Agent', '设置']) {
  const tile = page.locator('.mobile-nav-sheet .mobile-page-tile').filter({ hasText: label }).first();
  if (await tile.count() === 0) {
    steps.push({ tab: label, error: 'tile missing' });
    continue;
  }
  await tile.click();
  await page.waitForTimeout(600);
  steps.push({ tab: label, ...(await state()) });
  if (await page.locator('.mobile-nav-sheet').count()) {
    // 如果面板没有自动关闭，再点“全部”打开下一轮
    await page.getByRole('button', { name: '全部功能' }).click();
  }
  if (label !== '设置') {
    await page.getByRole('button', { name: '全部功能' }).click();
    await page.locator('.mobile-nav-sheet').waitFor({ timeout: 5000 });
  }
}

console.log(JSON.stringify(steps, null, 2));
console.log('errors=', JSON.stringify(errors));
await browser.close();
