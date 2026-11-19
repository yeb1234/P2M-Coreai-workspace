import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const WEB = 'http://127.0.0.1:12302/#/interview';
const OUT = process.env.IV_OUT || '.';
const VIEWPORT_WIDTH = Number(process.env.IV_WIDTH || 1440);

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password: 'Demo2026' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const loginBody = await login.json();
const setCookie = login.headers.get('set-cookie') || '';
const session = /p2m_session=([^;]+)/.exec(setCookie)?.[1];
if (!session) throw new Error('p2m_session cookie missing');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: VIEWPORT_WIDTH, height: 1000 }, deviceScaleFactor: 1 });
await context.addCookies([{
  name: 'p2m_session', value: session, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript((userId) => localStorage.setItem('p2m-auth-user-id', String(userId)), loginBody.user.id);

const fakeEvaluation = {
  score: 82,
  verdict: 'pass',
  dimensions: [
    { name: '概念准确性', score: 86, comment: '概念正确，能落到主链路。' },
    { name: '链路完整性', score: 84, comment: '从入口到结果串起来了。' },
    { name: '边界与失败路径', score: 72, comment: '失败路径还可以再具体。' },
    { name: '项目落地', score: 83, comment: '有可验证的工程细节。' },
    { name: '表达结构', score: 85, comment: '结论先行，层次清楚。' },
  ],
  strengths: ['结论先行', '关键机制讲清楚了'],
  gaps: ['再补一个超时或降级路径'],
  rewrite: '先给结论，再讲链路，最后补失败路径。',
  followUps: ['如果请求量翻十倍，先改哪一层？'],
  provider: 'smoke',
  model: 'mock',
};
await page.route('**/api/interview/evaluate', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(fakeEvaluation),
}));

const errors = [];
const failedResponses = [];
page.on('response', (response) => {
  if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

await page.goto(WEB, { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tabs').waitFor({ timeout: 10000 });
await page.getByRole('button', { name: /模拟面试/ }).click();
await page.locator('.iv-round-builder').waitFor({ timeout: 10000 });
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/interview-round-top-${VIEWPORT_WIDTH}.png`, fullPage: false });

const presetLabels = await page.locator('.iv-round-preset-copy strong').allInnerTexts();
const defaultTotal = await page.locator('.iv-round-total strong').innerText();
const defaultRows = await page.locator('.iv-round-count').count();

// 搜索：知识库结果应能切 tab 并打开对应文章。
const searchInput = page.locator('.iv-global-search input');
await searchInput.fill('DeepSeek');
await page.locator('.iv-global-search-pop').waitFor({ timeout: 5000 });
await page.locator('.iv-global-search-group').first().waitFor({ timeout: 5000 });
await page.waitForFunction(() => document.querySelectorAll('.iv-global-search-group').length >= 2, null, { timeout: 5000 });
const searchGroups = await page.locator('.iv-global-search-group').count();
const knowledgeGroup = page.locator('.iv-global-search-group').last();
const knowledgeResults = await knowledgeGroup.locator('.iv-global-search-item').count();
await page.screenshot({ path: `${OUT}/interview-search-${VIEWPORT_WIDTH}.png`, fullPage: false });
await knowledgeGroup.locator('.iv-global-search-item').first().click();
await page.locator('.kb-main h1').waitFor({ timeout: 5000 });
const knowledgeTitle = await page.locator('.kb-main h1').innerText();

await page.getByRole('button', { name: /模拟面试/ }).click();
await page.locator('.iv-round-builder').waitFor({ timeout: 5000 });

// 题目结果应打开题目抽屉。
await page.locator('.iv-global-search input').fill('FastAPI');
await page.locator('.iv-global-search-pop').waitFor({ timeout: 5000 });
await page.locator('.iv-global-search-group').first().waitFor({ timeout: 5000 });
await page.locator('.iv-global-search-group').first().locator('.iv-global-search-item').first().click();
await page.locator('.iv-drawer').waitFor({ timeout: 5000 });
const searchQuestionTitle = await page.locator('.iv-drawer h2').first().innerText();
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.locator('.iv-drawer').waitFor({ state: 'hidden', timeout: 5000 });

// 自定义配置：6 个数字输入，数量变化应反映到总题数。
await page.locator('.iv-round-preset').filter({ hasText: '自定义套卷' }).click();
const customInputs = await page.locator('.iv-round-count input').count();
await page.locator('.iv-round-count input').first().fill('3');
const customTotal = await page.locator('.iv-round-total strong').innerText();

// 回到默认一面，开始抽题。
await page.locator('.iv-round-preset').filter({ hasText: '一面 · 基础筛' }).click();
await page.locator('.iv-round-builder').scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/interview-round-builder-${VIEWPORT_WIDTH}.png`, fullPage: false });
await page.getByRole('button', { name: /开始抽一套/ }).click();
await page.locator('.iv-round-mini-list').waitFor({ timeout: 5000 });
const roundRows = await page.locator('.iv-round-mini-row').count();
const startProgress = await page.locator('.iv-round-work-head').innerText();
const firstRoundTitle = await page.locator('.iv-mock-question-card h3').innerText();

await page.locator('.iv-answer-input').fill('先给结论：这条链路由入口、编排、检索、生成和埋点组成。核心是把请求分级，再做超时、重试和降级；项目里用队列削峰，并记录每次失败的原因。');
await page.getByRole('button', { name: /提交，交给 AI 面试官/ }).click();
await page.locator('.iv-evaluation').waitFor({ timeout: 10000 });
const score = await page.locator('.iv-score-ring strong').innerText();
await page.getByRole('button', { name: /下一题/ }).click();
await page.waitForTimeout(300);
const nextProgress = await page.locator('.iv-round-work-head').innerText();
const nextRowDone = await page.locator('.iv-round-mini-row').first().innerText();

for (let index = 2; index <= 6; index += 1) {
  await page.locator('.iv-answer-input').fill(`第 ${index} 题：先给结论，再讲关键链路，最后补超时、重试和降级路径。项目里用队列削峰，并记录失败原因。`);
  await page.getByRole('button', { name: /提交，交给 AI 面试官/ }).click();
  await page.locator('.iv-evaluation').waitFor({ timeout: 10000 });
  const button = index === 6
    ? page.getByRole('button', { name: /完成本套/ })
    : page.getByRole('button', { name: /下一题/ });
  await button.click();
  await page.waitForTimeout(250);
}
await page.locator('.iv-round-summary').waitFor({ timeout: 5000 });
const summaryText = await page.locator('.iv-round-summary-head').innerText();

await page.screenshot({ path: `${OUT}/interview-round-search-${VIEWPORT_WIDTH}.png`, fullPage: false });
console.log(JSON.stringify({
  presetLabels,
  defaultTotal,
  defaultRows,
  searchGroups,
  knowledgeResults,
  knowledgeTitle,
  searchQuestionTitle,
  customInputs,
  customTotal,
  roundRows,
  startProgress,
  firstRoundTitle,
  score,
  nextProgress,
  nextRowDone,
  summaryText,
  errors,
  failedResponses,
  metrics: await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bodyHeight: document.body.scrollHeight,
  })),
}, null, 2));
await browser.close();
