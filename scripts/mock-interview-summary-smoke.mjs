import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const login = await context.request.post('http://127.0.0.1:12402/api/auth/login', {
  data: { username: 'demo', password: 'Demo2026' },
});
console.log('login_status=', login.status());
await context.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));

const page = await context.newPage();
const pageErrors = [];
const responses = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/interview/') || url.includes('/assets/')) {
    responses.push({ url, status: response.status(), size: response.headers()['content-length'] || '?' });
  }
});
let evaluateBody = null;
await page.route('**/api/interview/evaluate', async (route) => {
  evaluateBody = route.request().postDataJSON();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      score: 78,
      verdict: 'pass',
      dimensions: [
        { name: '概念准确性', score: 80, comment: '主链路讲到了。' },
        { name: '链路完整性', score: 76, comment: '边界还可以再补。' },
      ],
      strengths: ['能先给结论'],
      gaps: ['缓存失效只讲了一半'],
      rewrite: '结论 → 链路 → 边界。',
      followUps: ['Redis 挂了怎么办？'],
      provider: 'test',
      model: 'mock',
      latencyMs: 1,
    }),
  });
});

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.locator('.iv-tab').filter({ hasText: '模拟面试' }).click();
await page.waitForSelector('.iv-mock-top', { timeout: 20000 });
await page.waitForSelector('.iv-mock-question-card', { timeout: 20000 });

const scopeCounts = await page.locator('.iv-chip-count').allTextContents();
console.log('scope_counts=', scopeCounts.join(' / '));
const selectedTitle = (await page.locator('.iv-mock-question-card h3').textContent())?.trim();
console.log('selected_title=', selectedTitle);

await page.getByRole('button', { name: /开始抽一套/ }).click();
await page.waitForTimeout(500);
console.log('round_rows=', await page.locator('.iv-round-mini-row').count());
await page.locator('textarea.iv-answer-input').fill('先说结论：题库列表只取摘要，提交时按题拿参考答案，再用 Redis 缓存热点。');
await page.getByRole('button', { name: /提交，交给 AI 面试官/ }).click();
await page.waitForTimeout(900);
console.log('evaluate_reference_len=', evaluateBody?.reference?.length ?? 0);
console.log('evaluate_question_id=', evaluateBody?.question_id ?? '');
console.log('result_visible=', await page.locator('.iv-evaluation').count());
console.log('detail_requests=', responses.filter((item) => item.url.includes('/api/interview/questions/')).length);
console.log('bank_json_requests=', responses.filter((item) => item.url.includes('questions.json')).length);
console.log('mock_chunk=', responses.find((item) => item.url.includes('MockInterviewTab'))?.url.split('/').pop(), responses.find((item) => item.url.includes('MockInterviewTab'))?.size);
console.log('page_errors=', pageErrors.length ? pageErrors.join(' | ') : 'none');
await page.screenshot({ path: 'mock-interview-summary-1440.png', fullPage: false });
await browser.close();
