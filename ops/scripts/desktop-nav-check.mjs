import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const BASE = 'http://127.0.0.1:12302';
const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password: 'Demo2026' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { access_token } = await login.json();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.addCookies([{ name: 'p2m_session', value: access_token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.theme-sidebar').waitFor({ timeout: 10000 });

const result = [];
for (const label of ['待办事项', '便签', '笔记', '书签收藏', '面试 Agent']) {
  const nav = page.locator('.theme-sidebar nav').getByText(label, { exact: true }).first();
  if (await nav.count() === 0) { result.push({ label, error: 'missing' }); continue; }
  await nav.click();
  await page.waitForTimeout(450);
  result.push({
    label,
    hash: await page.evaluate(() => location.hash),
    activeNav: await page.locator('.theme-sidebar nav button.is-active').count(),
    visibleTitle: await page.locator('.app-main > div:not([style*="display: none"])').first().textContent().catch(() => null),
  });
}
console.log(JSON.stringify(result, null, 2));
console.log('errors=', JSON.stringify(errors));
await browser.close();
