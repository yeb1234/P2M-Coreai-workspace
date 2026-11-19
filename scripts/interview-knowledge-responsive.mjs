import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 1000 } });
await context.addCookies([{
  name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/',
  httpOnly: true, secure: false, sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tab').filter({ hasText: '知识库' }).click();
await page.waitForTimeout(600);
const layout = await page.evaluate(() => {
  const shell = document.querySelector('.kb-shell');
  const body = document.querySelector('.kb-body');
  const sidebar = document.querySelector('.kb-sidebar');
  return {
    columns: shell ? getComputedStyle(shell).gridTemplateColumns : null,
    shellWidth: shell?.clientWidth,
    bodyScrollWidth: body?.scrollWidth,
    bodyClientWidth: body?.clientWidth,
    sidebarWidth: sidebar?.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  };
});
console.log(JSON.stringify(layout));
await page.screenshot({ path: `${process.env.IV_OUT || '.'}/interview-knowledge-900.png`, fullPage: false });
await browser.close();
