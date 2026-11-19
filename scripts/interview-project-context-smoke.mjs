import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const bodies = [];
await page.route('**/api/interview/evaluate', (route) => {
  bodies.push(route.request().postDataJSON());
  return route.abort();
});

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tab').filter({ hasText: '模拟面试' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /项目题/ }).click();
await page.selectOption('.iv-question-select', 'X-PROJ-15');
await page.waitForTimeout(400);
await page.locator('textarea.iv-answer-input, textarea').first().fill('P5 用 PG 全文 + Milvus 语义召回，RRF 融合，tenant_id 和部门路径做前置过滤，版本快照可回溯。');
await page.getByRole('button', { name: /提交，交给 AI 面试官/ }).click();
await page.waitForTimeout(600);
const onBody = bodies.at(-1);
console.log('on_hasProject=', Boolean(onBody?.project_context), 'chars=', onBody?.project_context?.length ?? 0, 'head=', onBody?.project_context?.slice(0, 60));

await page.locator('.iv-project-toggle').click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /提交，交给 AI 面试官/ }).click();
await page.waitForTimeout(600);
const offBody = bodies.at(-1);
console.log('off_hasProject=', Boolean(offBody?.project_context), 'value=', JSON.stringify(offBody?.project_context));
console.log('bodies=', bodies.length);
await browser.close();
