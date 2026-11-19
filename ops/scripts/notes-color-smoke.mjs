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
const viewport = process.env.VIEWPORT === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
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
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto(`${BASE}/#/mdnotes`, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.mdn-brand strong').waitFor({ timeout: 10000 });
await page.getByText('富文本', { exact: true }).click();
await page.locator('.mdn-rich-editor').waitFor({ timeout: 10000 });

await page.evaluate(() => {
  const editor = document.querySelector('.mdn-rich-editor');
  const paragraph = editor?.querySelector('p') || editor;
  if (!paragraph) throw new Error('rich editor content missing');
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
});

await page.getByText('文字色', { exact: true }).click();
await page.screenshot({ path: `${OUT}/notes-color-menu-${viewport.width}.png`, fullPage: true });
await page.locator('[aria-label="文字颜色：红"]').click();
await page.waitForTimeout(500);

// 选中的富文本通常还在选区里，继续给它加底色。
await page.getByText('底色', { exact: true }).click();
await page.locator('[aria-label="文字背景色：黄"]').click();
await page.waitForTimeout(500);

const richHtml = await page.locator('.mdn-rich-editor').innerHTML();
await page.getByText('源码', { exact: true }).click();
const source = await page.locator('textarea[aria-label="Markdown 源码编辑器"]').inputValue();
await page.locator('textarea[aria-label="Markdown 源码编辑器"]').evaluate((textarea) => {
  textarea.focus();
  textarea.setSelectionRange(0, Math.min(12, textarea.value.length));
});
await page.getByText('文字色', { exact: true }).click();
await page.locator('[aria-label="文字颜色：蓝"]').click();
await page.waitForTimeout(200);
const sourceAfter = await page.locator('textarea[aria-label="Markdown 源码编辑器"]').inputValue();

const checks = {
  text_color_in_editor: /color\s*:\s*(?:rgb|#)/i.test(richHtml),
  background_in_editor: /background-color\s*:\s*(?:rgb|#)/i.test(richHtml),
  text_color_in_markdown: /color\s*:\s*(?:rgb|#)/i.test(source),
  background_in_markdown: /background-color\s*:\s*(?:rgb|#)/i.test(source),
  source_mode_color: /color\s*:\s*#2563eb/i.test(sourceAfter),
  no_unsafe_style: !/url\s*\(|javascript:/i.test(`${richHtml}\n${source}\n${sourceAfter}`),
  no_horizontal_overflow: await page.evaluate(() =>
    document.documentElement.scrollWidth <= window.innerWidth + 1
  ),
};
console.log('checks=', JSON.stringify(checks));
console.log('sourceExcerpt=', JSON.stringify(source.slice(0, 600)));
console.log('errors=', JSON.stringify(errors));
await page.screenshot({ path: `${OUT}/notes-color-toolbar-${viewport.width}.png`, fullPage: true });
await browser.close();
