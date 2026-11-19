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
  name: 'p2m_session',
  value: accessToken,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));

await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.mobile-tabbar').waitFor({ timeout: 15000 });

const before = await page.evaluate(() => ({ hash: location.hash, pathname: location.pathname }));
await page.getByRole('button', { name: '全部功能' }).click();
await page.locator('.mobile-nav-sheet').waitFor({ timeout: 10000 });
await page.screenshot({ path: 'mobile-nav-sheet.png', fullPage: true });

const notesTile = page.locator('.mobile-nav-sheet .mobile-page-tile').filter({ hasText: '笔记' }).first();
console.log('notesTileCount=', await page.locator('.mobile-nav-sheet .mobile-page-tile').filter({ hasText: '笔记' }).count());
await notesTile.click();
await page.waitForTimeout(1200);
const afterNotes = await page.evaluate(() => ({
  hash: location.hash,
  pathname: location.pathname,
  sheet: Boolean(document.querySelector('.mobile-nav-sheet')),
  brand: document.querySelector('.mdn-brand strong')?.textContent ?? null,
}));
console.log('before=', JSON.stringify(before));
console.log('afterNotes=', JSON.stringify(afterNotes));

await page.getByRole('button', { name: '工作台', exact: true }).click();
await page.waitForTimeout(800);
const afterDashboard = await page.evaluate(() => ({
  hash: location.hash,
  pathname: location.pathname,
  dashboardHeading: document.querySelector('main')?.textContent?.slice(0, 40) ?? null,
}));
console.log('afterDashboard=', JSON.stringify(afterDashboard));
console.log('errors=', JSON.stringify(errors));
await page.screenshot({ path: 'mobile-nav-after-dashboard.png', fullPage: true });
await browser.close();
