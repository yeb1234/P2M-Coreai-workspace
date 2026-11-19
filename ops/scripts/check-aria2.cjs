const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);

  for (const [route, name] of [['transcriber', '转写页'], ['notes', '笔记页'], ['todo', '待办页']]) {
    await p.goto('http://localhost/#' + route, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    const found = await p.evaluate(() => {
      const els = [...document.querySelectorAll('[aria-expanded]')];
      return els.map((e) => ({
        expanded: e.getAttribute('aria-expanded'),
        label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 16),
      }));
    });
    console.log(`${name}: ${found.length} 个 [aria-expanded]`);
    found.slice(0, 4).forEach((e) => console.log(`   expanded=${e.expanded}  "${e.label}"`));
  }
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
