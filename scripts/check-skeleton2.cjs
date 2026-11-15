const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();

  // 关键：登录前就挂拦截 —— loadItems 在 App 挂载时就会调
  await p.route('**/api/schedule-items*', async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.continue();
  });

  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();

  // 登录后会 reload，等待骨架出现的时间窗
  await p.waitForTimeout(4000);
  await p.goto('http://localhost/#/todo', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  const during = await p.locator('body').innerText();
  console.log('慢网期间显示「暂无待办」:', during.includes('暂无待办事项'), '(期望 false)');
  console.log('慢网期间有骨架块:', (await p.locator('.animate-pulse').count()) > 0, '(期望 true)');
  await p.screenshot({ path: 'test-results/skeleton-loading.png' });

  await p.waitForTimeout(6000);
  const after = await p.locator('body').innerText();
  console.log('加载完成后显示「暂无待办」:', after.includes('暂无待办事项'), '(期望 true)');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
