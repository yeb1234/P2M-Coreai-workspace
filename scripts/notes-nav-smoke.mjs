import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const BASE = 'http://127.0.0.1:12302';
const OUT = process.env.IV_OUT || '.';

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password: 'Demo2026' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { access_token: accessToken } = await login.json();

const browser = await chromium.launch({ headless: true });
const errors = [];

async function openPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (response) => {
    if (response.status() === 404) errors.push(`404: ${response.url()}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  return { context, page };
}

const desktop = await openPage({ width: 1440, height: 1000 });
await desktop.page.goto(`${BASE}/#/notes`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.page.getByText('便签', { exact: true }).first().waitFor({ timeout: 10000 });
await desktop.page.getByText('新建便签', { exact: true }).first().waitFor({ timeout: 10000 });

const navLabels = await desktop.page.locator('aside nav > div.group').evaluateAll((items) =>
  items.map((item) => item.innerText.split('\n')[0].trim()).filter(Boolean)
);
const notesIndex = navLabels.indexOf('便签');
const mdNotesIndex = navLabels.indexOf('笔记');
const desktopText = await desktop.page.locator('body').innerText();
const notesPageChecks = {
  sidebar_has_biaqian: notesIndex >= 0,
  sidebar_has_biji: mdNotesIndex >= 0,
  adjacent_order: notesIndex >= 0 && mdNotesIndex === notesIndex + 1,
  page_title_biaqian: desktopText.includes('条便签') && desktopText.includes('AI 今日便签'),
  no_md_label: !desktopText.includes('MD 笔记'),
};
console.log('navLabels=', JSON.stringify(navLabels));
console.log('notesPageChecks=', JSON.stringify(notesPageChecks));
await desktop.page.screenshot({ path: `${OUT}/notes-nav-desktop.png`, fullPage: true });

await desktop.page.goto(`${BASE}/#/mdnotes`, { waitUntil: 'networkidle', timeout: 30000 });
await desktop.page.getByText('笔记', { exact: true }).first().waitFor({ timeout: 10000 });
await desktop.page.getByText('全部笔记', { exact: true }).first().waitFor({ timeout: 10000 });
const mdText = await desktop.page.locator('body').innerText();
const mdBrand = (await desktop.page.locator('.mdn-brand strong').innerText()).trim();
const mdCrumb = (await desktop.page.locator('.mdn-breadcrumb').innerText()).trim();
const mdPageChecks = {
  brand_biji: mdBrand === '笔记',
  breadcrumb_biji: mdCrumb.startsWith('笔记'),
  no_md_label_in_chrome: !(`${mdBrand}\n${mdCrumb}`.includes('MD 笔记')),
  editor_present: (await desktop.page.locator('.mdn-canvas').count()) > 0,
};
console.log('mdPageChecks=', JSON.stringify(mdPageChecks));
console.log('mdBrand=', JSON.stringify(mdBrand));
console.log('mdCrumb=', JSON.stringify(mdCrumb));
await desktop.page.screenshot({ path: `${OUT}/notes-md-page.png`, fullPage: true });
await desktop.context.close();

const mobile = await openPage({ width: 390, height: 844 });
await mobile.page.goto(`${BASE}/#/notes`, { waitUntil: 'networkidle', timeout: 30000 });
await mobile.page.getByText('便签', { exact: true }).first().waitFor({ timeout: 10000 });
await mobile.page.locator('[aria-label="全部功能"]').click();
await mobile.page.getByText('常用', { exact: true }).first().waitFor({ timeout: 10000 });
const mobileText = await mobile.page.locator('body').innerText();
const mobileNavChecks = {
  mobile_has_biaqian: mobileText.includes('便签'),
  mobile_has_biji: mobileText.includes('笔记'),
  notes_before_md: mobileText.indexOf('便签') < mobileText.indexOf('笔记'),
  no_horizontal_overflow: await mobile.page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ),
};
console.log('mobileNavChecks=', JSON.stringify(mobileNavChecks));
await mobile.page.screenshot({ path: `${OUT}/notes-nav-mobile.png`, fullPage: false });
await mobile.context.close();

console.log('errors=', JSON.stringify(errors));
await browser.close();
