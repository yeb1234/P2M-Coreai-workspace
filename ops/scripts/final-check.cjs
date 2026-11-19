const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 70)));

  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);

  // 登录表单关联
  const loginForm = await p.evaluate(() => {
    const ls = [...document.querySelectorAll('label[for]')];
    return { labels: ls.length, paired: ls.filter((l) => document.getElementById(l.getAttribute('for'))).length };
  });
  console.log(`登录页 label 配对: ${loginForm.paired}/${loginForm.labels}`);

  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);

  // 各页面渲染 + 错误
  const pages = [['dashboard','工作台'], ['todo','待办'], ['journey','轨迹'], ['notes','笔记'],
                 ['calendar2','周历'], ['timecenter','时间中心'], ['settings','设置'], ['stats','统计']];
  for (const [r, name] of pages) {
    await p.goto('http://localhost/#' + r, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1600);
    const t = await p.locator('body').innerText();
    console.log(`  ${name.padEnd(6)} 渲染 ${String(t.length).padStart(4)} 字符`);
  }

  // 设置页番茄钟字段关联
  await p.goto('http://localhost/#/settings', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const pomo = await p.evaluate(() => {
    const ls = [...document.querySelectorAll('label[for^="pomodoro-"]')];
    return { labels: ls.length, paired: ls.filter((l) => document.getElementById(l.getAttribute('for'))).length };
  });
  console.log(`番茄钟字段: ${pomo.paired}/${pomo.labels} 配对`);

  console.log('JS 错误:', errs.length ? errs.slice(0, 3) : '无');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
