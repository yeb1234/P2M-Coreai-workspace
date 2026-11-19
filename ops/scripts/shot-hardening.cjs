const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
  const file = 'file:///' + path.resolve(__dirname, '../docs/project-story.html').replace(/\\/g, '/');
  await p.goto(file, { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const el = await p.$('#hardening');
  if (!el) { console.log('未找到 #hardening'); await b.close(); process.exit(1); }
  await el.screenshot({ path: 'test-results/story-hardening.png' });
  console.log('截图完成');
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
