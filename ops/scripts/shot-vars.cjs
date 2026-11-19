const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 90)));
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);
  await p.screenshot({ path: 'test-results/vars-home.png' });
  for (const [id, name] of [['journey','轨迹'], ['todo','待办'], ['notes','笔记'], ['settings','设置']]) {
    await p.goto('http://localhost/#/' + id, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    await p.screenshot({ path: `test-results/vars-${id}.png` });
  }
  console.log('JS 错误:', errs.length ? errs.slice(0, 3) : '无');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
