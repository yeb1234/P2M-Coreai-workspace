const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);

  await p.goto('http://localhost/#/settings', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  // 切到「转写设置」tab —— 我改的表单在那里
  const tab = p.getByText('转写设置', { exact: true }).first();
  if (await tab.count()) { await tab.click(); await p.waitForTimeout(1500); console.log('已切到转写设置'); }

  // 统计 label/input 配对
  const stats = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('label[for]')];
    const ok = labels.filter((l) => document.getElementById(l.getAttribute('for')));
    const orphanInputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox])')]
      .filter((el) => !el.id && !el.closest('label') && !el.getAttribute('aria-label'));
    return { labels: labels.length, paired: ok.length, orphan: orphanInputs.length };
  });
  console.log(`设置页：label[for] ${stats.labels} 个，能找到对应 input 的 ${stats.paired} 个`);
  console.log(`无 id 又无 aria-label 的输入框: ${stats.orphan} 个`);

  // 实测：点标签能否聚焦输入框
  const clickTest = await p.evaluate(async () => {
    const label = [...document.querySelectorAll('label[for]')].find((l) => l.getAttribute('for')?.startsWith('f-'));
    if (!label) return { ok: false, reason: '没找到生成的 label' };
    const target = document.getElementById(label.getAttribute('for'));
    if (!target) return { ok: false, reason: 'id 找不到元素' };
    label.click();
    return { ok: document.activeElement === target, text: label.textContent.trim() };
  });
  console.log(`点标签聚焦输入框: ${clickTest.ok ? '✓' : '✗ ' + (clickTest.reason || '')}  「${clickTest.text || ''}」`);
  console.log('JS 错误:', errs.length ? errs.slice(0, 2) : '无');
  await p.screenshot({ path: 'test-results/labels-fixed.png' });
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
