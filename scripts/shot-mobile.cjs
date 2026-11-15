const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  // iPhone 13 尺寸
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(1000);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);
  await p.screenshot({ path: 'test-results/mobile-home.png' });

  const pages = [
    ['todo', '待办'], ['journey', '学习轨迹'], ['notes', '笔记'], ['settings', '设置'],
  ];
  for (const [id, name] of pages) {
    await p.goto('http://localhost/#/' + id, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `test-results/mobile-${id}.png` });
    console.log(`已截 ${name}`);
  }
  // 底部 tab 栏有哪些
  const tabs = await p.$$eval('nav a, nav button, [class*="tab"]', (els) => els.map((e) => (e.textContent || '').trim()).filter((t) => t && t.length < 10));
  console.log('底部/导航项:', JSON.stringify([...new Set(tabs)].slice(0, 12)));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
