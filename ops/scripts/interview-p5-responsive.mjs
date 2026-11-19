import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
const out = process.env.IV_OUT || '.';
const browser = await chromium.launch({ headless: true });

async function openDrawer(width, height, name) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addCookies([{
    name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/',
    httpOnly: true, secure: false, sameSite: 'Lax',
  }]);
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
  await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
  await page.locator('.iv-tab').filter({ hasText: '知识库' }).click();
  await page.waitForTimeout(500);
  await page.locator('.kb-p5-entry').click();
  await page.waitForTimeout(800);
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    drawer: document.querySelector('.p5-drawer')?.getBoundingClientRect().width ?? 0,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  console.log(name, JSON.stringify(metrics));
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await context.close();
}

await openDrawer(900, 1000, 'interview-p5-900');
await openDrawer(390, 844, 'interview-p5-390');
await browser.close();
