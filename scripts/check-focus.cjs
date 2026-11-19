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

  // 连续 Tab，检查每次聚焦元素是否有可见 outline
  const results = [];
  for (let n = 0; n < 8; n += 1) {
    await p.keyboard.press('Tab');
    await p.waitForTimeout(180);
    const info = await p.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'body' };
      const cs = getComputedStyle(el);
      const style = cs.outlineStyle;
      const width = cs.outlineWidth;
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 14),
        outline: `${style} ${width}`,
        hasOutline: style !== 'none' && parseFloat(width) >= 1,
      };
    });
    results.push(info);
  }
  const withOutline = results.filter((r) => r.hasOutline).length;
  console.log(`Tab 8 次，有可见焦点框: ${withOutline}/8`);
  results.slice(0, 5).forEach((r) => console.log(`  ${r.tag} "${r.text || ''}" → ${r.outline}`));
  await p.screenshot({ path: 'test-results/focus-check.png' });
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
