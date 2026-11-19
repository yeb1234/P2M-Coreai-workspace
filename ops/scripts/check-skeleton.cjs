const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();

  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);

  // 拦截待办接口，延迟 4 秒 —— 模拟慢网
  await p.route('**/api/schedule-items*', async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  await p.goto('http://localhost/#/todo', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  const during = await p.locator('body').innerText();
  const hasSkeleton = during.includes('暂无待办事项');
  console.log('慢网时显示「暂无待办」:', hasSkeleton, '(应为 false)');
  await p.screenshot({ path: 'test-results/skeleton-loading.png' });

  await p.waitForTimeout(4500);
  const after = await p.locator('body').innerText();
  console.log('加载完成后显示「暂无待办」:', after.includes('暂无待办事项'), '(应为 true)');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
