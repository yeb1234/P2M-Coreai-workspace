const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const ins = p.locator('input');
  await ins.nth(0).fill('demo');
  await ins.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5000);

  // 从灵境小助手页的明确按钮打开对话栏
  await p.goto('http://localhost/#/aiagent', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1800);
  const openBtn = p.getByRole('button', { name: '打开灵境小助手' }).first();
  if (await openBtn.count()) await openBtn.click();
  await p.waitForTimeout(1500);

  const ta = p.locator('aside textarea:visible').first();
  if (!(await ta.count())) { console.log('聊天输入框未找到'); await b.close(); return; }

  await ta.fill('有没有适合AI产品开发的课程');
  await p.locator('aside button[title="发送"]').first().click();
  await p.waitForTimeout(1800);

  const header = await p.locator('aside').filter({ hasText: '识别意图' }).first().innerText().catch(() => '(没找到)');
  console.log('面板顶部:', header.split('\n').slice(0, 4).join(' | '));

  const editBtn = p.locator('aside button[aria-label="查看或修改提示词"]');
  if (await editBtn.count()) { await editBtn.click(); await p.waitForTimeout(600); }
  await p.screenshot({ path: 'shots/intent.png' });
  await b.close();
})();
