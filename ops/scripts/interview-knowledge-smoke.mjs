import { chromium } from 'playwright';

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

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(900);
console.log('bankCount=', await page.locator('.iv-hero-index strong').textContent());
console.log('llmChip=', await page.getByRole('button', { name: 'LLM 微调 & 原理' }).count());
await page.getByRole('button', { name: 'LLM 微调 & 原理' }).click();
await page.waitForTimeout(300);
console.log('llmFiltered=', await page.locator('.iv-q-card').count(), 'summary=', await page.locator('.iv-bank-summary strong').textContent());
await page.screenshot({ path: `${out}/interview-bank-llm.png`, fullPage: false });

await page.locator('.iv-tab').filter({ hasText: '知识库' }).click();
await page.waitForTimeout(900);
console.log('knowledgeShell=', await page.locator('.kb-shell').count());
console.log('articles=', await page.locator('.kb-article-item').count());
console.log('activeTitle=', await page.locator('.kb-article-head h1').textContent());
console.log('bodyH2=', await page.locator('.kb-body h2').count());
console.log('tables=', await page.locator('.kb-body table').count());
console.log('related=', await page.locator('.kb-related-card').count());
console.log('sources=', await page.locator('.kb-sources a').count());
await page.screenshot({ path: `${out}/interview-knowledge.png`, fullPage: false });

const related = page.locator('.kb-related-card').first();
if (await related.count()) {
  const cardTitle = await related.locator('strong').textContent();
  await related.click();
  await page.waitForTimeout(500);
  console.log('relatedOpen=', cardTitle, 'drawer=', await page.locator('.iv-drawer').count());
  await page.screenshot({ path: `${out}/interview-knowledge-question.png`, fullPage: false });
  await page.locator('.iv-drawer-head .iv-icon-btn').click();
}

await page.locator('.kb-article-item').nth(1).click();
await page.waitForTimeout(500);
console.log('secondTitle=', await page.locator('.kb-article-head h1').textContent());
const bodyText = await page.locator('.kb-body').innerText();
console.log('has890=', bodyText.includes('890'));
console.log('hasCSA2=', bodyText.includes('CSA2'));
await page.screenshot({ path: `${out}/interview-knowledge-second.png`, fullPage: false });

console.log('errors=', JSON.stringify(errors));
await browser.close();
