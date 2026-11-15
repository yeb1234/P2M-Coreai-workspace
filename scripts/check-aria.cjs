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

  // 待办页：找带 aria-expanded 的元素
  await p.goto('http://localhost/#/todo', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const inTodo = await p.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-expanded]')];
    return els.map((e) => ({
      tag: e.tagName.toLowerCase(),
      expanded: e.getAttribute('aria-expanded'),
      label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 18),
    }));
  });
  console.log(`待办页 [aria-expanded] 元素: ${inTodo.length} 个`);
  inTodo.forEach((e) => console.log(`  ${e.tag} expanded=${e.expanded} "${e.label}"`));

  // 切到视频页看 AI 任务中心
  await p.goto('http://localhost/#/video', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const inVideo = await p.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-expanded]')];
    return els.map((e) => ({ expanded: e.getAttribute('aria-expanded'), label: (e.getAttribute('aria-label') || '').slice(0, 20) }));
  });
  console.log(`视频页 [aria-expanded] 元素: ${inVideo.length} 个`);
  inVideo.forEach((e) => console.log(`  expanded=${e.expanded} "${e.label}"`));
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
