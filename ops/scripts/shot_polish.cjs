const { chromium } = require('playwright');
const OUT = process.argv[2] || 'shots/before';

const pages = [
  ['dashboard', '工作台'], ['todo', '待办'], ['calendar2', '周历'],
  ['notes', '笔记'], ['pomodoro', '番茄钟'], ['timecenter', '时间中心'],
];

(async () => {
  const b = await chromium.launch();

  // 桌面
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const ins = p.locator('input');
  await ins.nth(0).fill('demo');
  await ins.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5000);

  for (const [route, name] of pages) {
    await p.goto('http://localhost/#' + route, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1800);
    await p.screenshot({ path: `${OUT}/${route}.png` });
    console.log(`  ${name}`);
  }

  // 聊天框展开
  await p.goto('http://localhost/#dashboard', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  const chatBtn = p.locator('button[aria-label*="助手"], button[title*="助手"]').first();
  if (await chatBtn.count()) { await chatBtn.click(); await p.waitForTimeout(1200); }
  await p.screenshot({ path: `${OUT}/chat.png` });
  console.log('  聊天框');

  await ctx.close();

  // 移动端
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await m.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await m.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await m.waitForTimeout(800);
  const mi = m.locator('input');
  await mi.nth(0).fill('demo');
  await mi.nth(1).fill('Demo2026');
  await m.getByRole('button', { name: /登录/ }).first().click();
  await m.waitForTimeout(5000);
  await m.screenshot({ path: `${OUT}/m-dashboard.png` });
  console.log('  移动端首页');

  await b.close();
})();
