const { chromium } = require('playwright');

const BASE = process.env.E2E_BASE || 'http://localhost';
const USER = { username: 'demo', password: 'Demo2026' };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);

  const inputs = page.locator('input');
  if ((await inputs.count()) < 2) {
    console.log('没找到登录表单');
    await browser.close();
    process.exit(1);
  }
  await inputs.nth(0).fill(USER.username);
  await inputs.nth(1).fill(USER.password);
  await page.getByRole('button', { name: /登录/ }).first().click();
  await page.waitForTimeout(3500);
  await page.waitForLoadState('networkidle').catch(() => {});

  if ((await page.getByRole('button', { name: /^登录$/ }).count()) > 0) {
    console.log('登录失败');
    await browser.close();
    process.exit(1);
  }

  await page.goto(`${BASE}/#/journey`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle').catch(() => {});

  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  await page.screenshot({ path: 'test-results/journey-page.png', fullPage: true });
  const body = await page.locator('body').innerText();
  console.log('页面是否含「学习轨迹」:', body.includes('学习轨迹'));
  console.log('页面是否含「Lv.」:', /Lv\.\d/.test(body));
  console.log('页面是否含「成就墙」:', body.includes('成就墙'));
  console.log('截图: test-results/journey-page.png');
  await browser.close();
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
