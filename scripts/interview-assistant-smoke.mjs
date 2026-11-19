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
await page.locator('.iv-q-card').first().waitFor({ timeout: 10000 });
const firstQuestionTitle = await page.locator('.iv-q-card .iv-q-title').first().innerText();
await page.locator('.iv-q-card').first().click();
await page.locator('.iv-drawer').waitFor({ timeout: 10000 });

const explainButton = page.getByRole('button', { name: '助手讲这题' });
const videoButton = page.getByRole('button', { name: '推荐相关视频' });
await explainButton.waitFor({ timeout: 5000 });

await explainButton.click();
const input = page.getByPlaceholder('发消息…').first();
await input.waitFor({ timeout: 10000 });
const drawerAfterExplain = await page.locator('.iv-drawer').count();
const explainPrompt = await input.inputValue();

await input.press('Enter');
await page.waitForFunction(() => {
  const panel = document.querySelector('.ai-panel');
  return Boolean(panel && !panel.textContent?.includes('正在思考') && !panel.textContent?.includes('get_interview_question'));
}, { timeout: 60000 });
const lastAssistant = await page.locator('.ai-panel .flex.flex-col').last().innerText();
const assistantAnswered = lastAssistant.includes('答题骨架');
const bodyAfterExplain = await page.locator('body').innerText();
const panelVisible = await page.locator('.ai-panel').isVisible();

// 移动端聊天面板是全屏层，验证完讲题先收起，避免挡住第二道题。
if (VIEWPORT_WIDTH < 700) {
  const closePanel = page.getByLabel('关闭灵境小助手').first();
  if (await closePanel.isVisible().catch(() => false)) {
    await closePanel.click();
    await page.waitForTimeout(250);
  }
}

await page.locator('.iv-q-card').first().click();
await page.locator('.iv-drawer').waitFor({ timeout: 10000 });
await page.getByRole('button', { name: '推荐相关视频' }).click();
await page.waitForTimeout(300);
const videoPrompt = await input.inputValue();

await page.screenshot({ path: `${OUT}/interview-assistant-smoke-${VIEWPORT_WIDTH}.png`, fullPage: false });
console.log(JSON.stringify({
  firstQuestionTitle,
  explainPrompt,
  videoPrompt,
  drawer_closed_after_explain: drawerAfterExplain === 0,
  panel_visible: panelVisible,
  assistantAnswered,
  lastAssistant,
  pageContextTitle: bodyAfterExplain.includes(firstQuestionTitle),
  errors,
  failedResponses,
  metrics: await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    bodyHeight: document.body.scrollHeight,
  })),
}, null, 2));
await browser.close();
