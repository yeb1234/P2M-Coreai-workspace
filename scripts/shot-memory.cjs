const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(3500);
  await p.goto('http://localhost/#/settings', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const btn = p.getByText('记忆与档案', { exact: false }).first();
  if (await btn.count()) { await btn.click(); await p.waitForTimeout(1800); }
  await p.screenshot({ path: 'test-results/memory-settings.png', fullPage: true });
  const body = await p.locator('body').innerText();
  console.log('含「关于我」:', body.includes('关于我'));
  console.log('含「助手设定」:', body.includes('助手设定'));
  console.log('含「长期记忆」:', body.includes('长期记忆'));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
