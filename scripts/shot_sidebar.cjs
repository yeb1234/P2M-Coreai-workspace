const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const ins = p.locator('input');
  await ins.nth(0).fill('demo');
  await ins.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5000);

  const aside = p.locator('aside');
  await aside.screenshot({ path: 'shots/sidebar.png' });

  const info = await p.evaluate(() => {
    const a = document.querySelector('aside');
    const txt = a ? a.innerText : '';
    return {
      hasToolGroup: txt.includes('工具'),
      hasWipText: txt.includes('施工中'),
      constructionIcons: a ? a.querySelectorAll('svg.lucide-construction').length : 0,
    };
  });
  console.log(JSON.stringify(info));
  await b.close();
})();
