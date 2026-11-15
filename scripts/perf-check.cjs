const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();

  const t0 = Date.now();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  const domReady = Date.now() - t0;

  const t1 = Date.now();
  await p.waitForSelector('input', { state: 'visible', timeout: 30000 });
  const loginVisible = Date.now() - t1;

  // 登录后测工作台首屏
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  const t2 = Date.now();
  await p.getByRole('button', { name: /登录/ }).first().click();
  // 等真实信号：欢迎页消失 + 侧边栏出现（登录后整页 reload）
  await p.waitForFunction(
    () => document.body.innerText.includes('工作台') && !document.querySelector('form input[autocomplete="username"]'),
    { timeout: 30000 },
  );
  const loginDone = Date.now() - t2;

  // 资源统计
  const res = await p.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const byType = {};
    let total = 0;
    entries.forEach((e) => {
      const t = e.initiatorType || 'other';
      byType[t] = (byType[t] || 0) + 1;
      total += e.transferSize || 0;
    });
    const audios = entries.filter((e) => e.initiatorType === 'audio');
    return {
      count: entries.length,
      byType,
      audioCount: audios.length,
      audioTotalKB: Math.round(audios.reduce((s, a) => s + (a.transferSize || 0), 0) / 1024),
      audioSample: audios.slice(0, 4).map((a) => `${a.name.split('/').pop()}:${Math.round((a.transferSize || 0) / 1024)}KB`),
      totalKB: Math.round(total / 1024),
      domInteractive: Math.round(performance.timing.domInteractive - performance.timing.navigationStart),
      loadComplete: Math.round(performance.timing.loadEventEnd - performance.timing.navigationStart),
    };
  });

  console.log(`DOM 就绪:        ${domReady}ms`);
  console.log(`登录表单可见:    ${loginVisible}ms`);
  console.log(`登录+进工作台:   ${loginDone}ms`);
  console.log(`资源请求数:      ${res.count} 个 (${JSON.stringify(res.byType)})`);
  console.log(`传输总量:        ${res.totalKB}KB`);
  console.log(`DOM Interactive: ${res.domInteractive}ms`);
  console.log(`音频请求:        ${res.audioCount} 个 / ${res.audioTotalKB}KB`);
  console.log(`  样本:          ${res.audioSample.join(', ')}`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
