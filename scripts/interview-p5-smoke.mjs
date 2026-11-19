import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([{
  name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/',
  httpOnly: true, secure: false, sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
page.on('response', (res) => { if (res.status() >= 400 && !res.url().includes('/api/user-data/')) errors.push(`http ${res.status()}: ${res.url()}`); });

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tab').filter({ hasText: '模拟面试' }).click();
await page.waitForTimeout(700);

console.log('mockMode=', (await page.locator('.iv-project-mode').count()));
console.log('projectToggle=', await page.locator('.iv-project-toggle').count());

// 先切到项目题池，再选 P5 对应的项目题。
await page.getByRole('button', { name: /项目题/ }).click();
await page.waitForTimeout(300);
const options = await page.locator('.iv-question-select option').allTextContents();
console.log('projectOptionsHasP5=', options.some((text) => text.includes('企业知识库 RAG')));
await page.selectOption('.iv-question-select', 'X-PROJ-15');
await page.waitForTimeout(400);

console.log('p5Profile=', (await page.locator('.iv-project-profile').textContent())?.slice(0, 160));
console.log('toggleChecked=', await page.locator('.iv-project-toggle input').isChecked());
console.log('p5Entry=', await page.getByRole('button', { name: /P5 知识库对标/ }).count());
await page.locator('.iv-project-profile').screenshot({ path: `${out}/interview-project-profile.png` });
await page.locator('.iv-project-mode').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/interview-project-mode.png`, fullPage: false });

await page.locator('.iv-project-toggle').click();
await page.waitForTimeout(200);
console.log('modeOff=', (await page.locator('.iv-project-mode-off').textContent())?.trim());
await page.locator('.iv-project-toggle').click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: /P5 知识库对标/ }).click();
await page.waitForTimeout(900);
console.log('drawer=', await page.locator('.p5-drawer').count());
console.log('baselineScore=', (await page.locator('.p5-baseline-score strong').textContent())?.trim());
console.log('baselineDims=', await page.locator('.p5-baseline-dim').count());
console.log('baselineLimits=', await page.locator('.p5-limits li').count());
await page.screenshot({ path: `${out}/interview-p5-drawer.png`, fullPage: false });

const sample = `我们做的是一个企业内部 RAG 知识库：支持 PDF/Word/Markdown 上传，按 800 字切片，用 bge-m3 生成向量，存 pgvector。检索用关键词 + 向量混合召回，RRF 融合，Top5 给大模型回答，回答里带引用。权限只做到账号级，所有用户共享一个知识库，没有部门隔离。异步入库用 Celery + Redis，失败重试 3 次，没有死信队列。版本只保留最新一版，不能 diff 和回滚。评测用 20 条人工问题，看回答是否正确，没有 RAGAS。部署用 Docker Compose，单机，有健康检查，没有备份演练和告警。`;
await page.locator('.p5-input-card textarea').fill(sample);
await page.getByRole('button', { name: '开始对标' }).click();
await page.waitForSelector('.p5-result', { timeout: 120000 });
await page.waitForTimeout(400);
console.log('winner=', (await page.locator('.p5-verdict-copy strong').textContent())?.trim());
console.log('scorePair=', (await page.locator('.p5-score-pair').textContent())?.replace(/\s+/g, ' ').trim());
console.log('dimRows=', await page.locator('.p5-dim-row').count());
console.log('feedbackCols=', await page.locator('.p5-feedback-block').count());
await page.screenshot({ path: `${out}/interview-p5-result.png`, fullPage: false });

await page.locator('.p5-close').click();
await page.waitForTimeout(300);
await page.locator('.iv-tab').filter({ hasText: '知识库' }).click();
await page.waitForTimeout(500);
console.log('kbP5Entry=', await page.locator('.kb-p5-entry').count());
await page.locator('.kb-p5-entry').click();
await page.waitForTimeout(500);
console.log('kbDrawer=', await page.locator('.p5-drawer').count());
console.log('errors=', JSON.stringify(errors));
await browser.close();


