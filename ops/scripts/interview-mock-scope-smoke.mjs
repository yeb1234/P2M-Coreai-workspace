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

console.log('scopeChips=', await page.locator('.iv-mock-groups .iv-chip').count());
console.log('initialScope=', (await page.locator('.iv-mock-side-head .iv-eyebrow').textContent())?.trim());

await page.getByRole('button', { name: /LLM 微调 & 原理/ }).click();
await page.waitForTimeout(400);
console.log('llmHead=', (await page.locator('.iv-mock-side-head .iv-eyebrow').textContent())?.trim());
console.log('llmMeta=', (await page.locator('.iv-mock-question-meta').textContent())?.trim());
console.log('llmScopeTags=', await page.locator('.iv-mock-groups .iv-chip.is-on').count());
await page.screenshot({ path: `${out}/interview-mock-llm.png`, fullPage: false });

await page.getByRole('button', { name: /后端 & 异步管线/ }).click();
await page.waitForTimeout(400);
console.log('backendHead=', (await page.locator('.iv-mock-side-head .iv-eyebrow').textContent())?.trim());
console.log('backendMeta=', (await page.locator('.iv-mock-question-meta').textContent())?.trim());

await page.getByRole('button', { name: /项目题/ }).click();
await page.waitForTimeout(400);
console.log('projectHead=', (await page.locator('.iv-mock-side-head .iv-eyebrow').textContent())?.trim());
console.log('projectMeta=', (await page.locator('.iv-mock-question-meta').textContent())?.trim());
await page.screenshot({ path: `${out}/interview-mock-project.png`, fullPage: false });

console.log('errors=', JSON.stringify(errors));
await browser.close();
