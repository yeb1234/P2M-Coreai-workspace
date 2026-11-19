import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([{ name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));

await page.goto('http://127.0.0.1:12302/#/bookmarks', { waitUntil: 'networkidle', timeout: 30000 });
await page.getByText('书签收藏', { exact: true }).first().waitFor({ timeout: 10000 });
console.log('fastapi_link=', await page.locator('a[href="https://fastapi.tiangolo.com/zh/"]').count());
console.log('bookmark_cards=', await page.locator('article').count());

const navText = await page.locator('aside.theme-sidebar nav').innerText();
console.log('nav_order=', JSON.stringify({
  bookmarks: navText.indexOf('书签收藏'),
  learning: navText.indexOf('学习路径'),
}));

const search = page.getByPlaceholder('搜标题、用途、标签，例如 FastAPI / 权限 / 评估');
await search.fill('FastAPI');
await page.waitForTimeout(300);
console.log('fastapi_search_cards=', await page.locator('article').count());
await page.getByRole('button', { name: '清空搜索' }).click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: '添加书签' }).click();
await page.getByPlaceholder('例如：FastAPI 官方文档').fill('冒烟测试书签');
await page.getByPlaceholder('https://...').fill('example.com');
await page.getByPlaceholder('为什么值得收藏').fill('本地存储验证');
await page.getByRole('button', { name: '保存书签' }).click();
await page.getByText('冒烟测试书签', { exact: true }).waitFor({ timeout: 5000 });
console.log('custom_card=', await page.getByText('冒烟测试书签', { exact: true }).count());
console.log('custom_storage=', await page.evaluate(() => (localStorage.getItem('p2m-custom-bookmarks-v1') || '').includes('冒烟测试书签')));

await page.screenshot({ path: `${out}/bookmarks-page.png`, fullPage: false });

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.getByRole('button', { name: /题库/ }).first().click();
await page.getByPlaceholder('搜题目、章节、标签…').fill('企业级 RAG 权限');
await page.getByText('企业级 RAG 权限：检索和生成怎么都不越权', { exact: true }).waitFor({ timeout: 10000 });
console.log('scenario_card=', await page.getByText('企业级 RAG 权限：检索和生成怎么都不越权', { exact: true }).count());
console.log('scenario_label=', await page.getByText('场景', { exact: true }).count());
await page.getByRole('button', { name: '清空搜索' }).click();
const typeSelect = page.getByLabel('题型');
console.log('type_options=', (await typeSelect.locator('option').allTextContents()).join('/'));
await typeSelect.selectOption('debug');
await page.waitForTimeout(500);
console.log('debug_cards=', await page.locator('article.iv-q-card').count());
await typeSelect.selectOption('handwrite');
await page.waitForTimeout(500);
console.log('handwrite_cards=', await page.locator('article.iv-q-card').count());
await page.screenshot({ path: `${out}/interview-new-types.png`, fullPage: false });
await browser.close();
