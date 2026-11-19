const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const ins = p.locator('input');
  await ins.nth(0).fill('demo');
  await ins.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5000);
  await p.goto('http://localhost/#/calendar2', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  // 周历页内的那个 aside（不是主侧栏）
  const panel = p.locator('main aside').first();
  await panel.screenshot({ path: 'shots/leftpanel.png' });
  const h = await panel.boundingBox();
  console.log('左栏尺寸:', h ? `${Math.round(h.width)}×${Math.round(h.height)}px` : '未找到');

  // 四个块的文字
  const txt = await panel.innerText();
  console.log('内容:\n' + txt.split('\n').filter(Boolean).join(' | '));
  await b.close();
})();
