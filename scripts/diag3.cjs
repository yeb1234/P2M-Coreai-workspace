const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(4000);
  const items = await p.$$eval('nav > div', (els) => els.map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 14));
  console.log('侧边栏项数:', items.length);
  console.log(items.slice(0, 12).join(' / '));
  console.log('含学习轨迹:', items.some((t) => t.includes('学习轨迹')));
  await b.close();
})();
