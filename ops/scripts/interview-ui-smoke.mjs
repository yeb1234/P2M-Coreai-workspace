import { chromium } from 'playwright';
import fs from 'node:fs';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await context.addCookies([{
  name: process.env.IV_COOKIE || 'p2m_session',
  value: token,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
}]);

const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem('p2m-auth-user-id', '1');
});
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('response', (res) => {
  if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
});
page.on('request', (req) => {
  if (req.url().includes('/api/interview/evaluate')) console.log('evaluatePayload=', req.postData());
});

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);
console.log('title=', await page.title());
console.log('page=', await page.locator('.iv-page').count());
console.log('cards=', await page.locator('.iv-q-card').count());
console.log('hero=', (await page.locator('.iv-hero-copy h1').textContent().catch(() => '')) || '');
await page.screenshot({ path: `${out}/interview-bank.png`, fullPage: false });

await page.getByRole('button', { name: /项目特训/ }).click();
await page.waitForTimeout(600);
console.log('projectCards=', await page.locator('.iv-q-card').count());
await page.screenshot({ path: `${out}/interview-project.png`, fullPage: false });

const card = page.locator('.iv-q-card').first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(500);
  console.log('drawer=', await page.locator('.iv-drawer').count());
  await page.screenshot({ path: `${out}/interview-drawer.png`, fullPage: false });
  await page.locator('.iv-drawer-head .iv-icon-btn').click();
}

await page.getByRole('button', { name: /三本书/ }).click();
await page.waitForTimeout(1200);
console.log('bookTabs=', await page.locator('.iv-book-tab').count());
console.log('paper=', await page.locator('.iv-paper').count());
await page.screenshot({ path: `${out}/interview-books.png`, fullPage: false });

await page.getByRole('button', { name: /模拟面试/ }).click();
await page.waitForTimeout(600);
console.log('mock=', await page.locator('.iv-mock').count());
console.log('selectedBefore=', await page.locator('.iv-question-select').inputValue(), await page.locator('.iv-mock-question-card h3').textContent());
await page.screenshot({ path: `${out}/interview-mock.png`, fullPage: false });

await page.locator('.iv-answer-input').fill('先讲结论：MCP 长任务要拆成异步任务，工具调用立即返回 job_id，后台 worker 消费并写状态；客户端轮询或 SSE 订阅进度；失败要有重试、死信和幂等键，最后按状态机收口。');
const submit = page.getByRole('button', { name: /提交，交给 AI 面试官/ });
console.log('submitEnabled=', await submit.isEnabled());
await submit.click();
await page.waitForSelector('.iv-evaluation', { timeout: 120000 });
console.log('evalScore=', await page.locator('.iv-score-ring strong').textContent());
await page.screenshot({ path: `${out}/interview-eval.png`, fullPage: false });

console.log('errors=', JSON.stringify(errors));
await browser.close();
