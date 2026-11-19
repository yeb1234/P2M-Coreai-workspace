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
  for (const [r, name] of [['todo','待办页'], ['timecenter','时间中心'], ['calendar2','周历']]) {
    await p.goto('http://localhost/#' + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    const t = await p.locator('body').innerText();
    console.log(`${name}: 含「来自时间中心的待办」= ${t.includes('来自时间中心的待办')}`);
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
