const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 90)));
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);
  await p.goto('http://localhost/#/settings', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const btn = p.getByText('外观', { exact: true }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(1500); }
  const body = await p.locator('body').innerText();
  console.log('还有「导入主题」按钮:', body.includes('导入主题'));
  console.log('还有「导出」功能:', body.includes('导出'));
  console.log('主题预设数量（数「经典/纸」等名字）:', (body.match(/(经典|纸|夜|极简|墨)/g) || []).length);
  console.log('JS 错误:', errs.length ? errs.slice(0, 2) : '无');
  await p.screenshot({ path: 'test-results/appearance-after.png' });
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
