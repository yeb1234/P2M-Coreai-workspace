import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const WEB = 'http://127.0.0.1:12302/#/';
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
const viewportWidth = Number(process.env.HITL_WIDTH || 1440);
const context = await browser.newContext({ viewport: { width: viewportWidth, height: 1000 }, deviceScaleFactor: 1 });
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
const openButton = page.getByTitle('打开灵境小助手');
if (await openButton.count()) {
  await openButton.click();
}
const input = page.getByPlaceholder('发消息…').first();
await input.waitFor({ timeout: 10000 });
await input.waitFor({ timeout: 10000 });
const clear = page.getByTitle('清空对话（同时开启新会话）');
if (await clear.count()) await clear.click();
const query = process.env.HITL_QUERY || '帮我规划一下学习';
await input.fill(query);
await input.press('Enter');

const cardTitle = process.env.HITL_CARD_TITLE || '先确认你的意图';
const card = page.getByText(cardTitle).first();
await card.waitFor({ timeout: 45000 });
await page.screenshot({ path: 'hitl-card.png', fullPage: true });
const cardRoot = card.locator('xpath=..');
const cardText = await cardRoot.innerText();
console.log('cardText=', JSON.stringify(cardText));
const options = await page.locator('button').filter({ hasText: /^A|^B|^C/ }).allInnerTexts();

const customMode = process.env.HITL_CUSTOM === '1';
const expectText = process.env.HITL_EXPECT || (customMode ? '' : '第 5 步');
const optionA = page.getByRole('button', { name: /^A/ }).first();
if (customMode) {
  await page.getByRole('button', { name: '其它（自己填写）' }).click();
  const customInput = page.getByPlaceholder('写下你的选择或补充…');
  await customInput.fill(process.env.HITL_CUSTOM_TEXT || '先做能力诊断，看看 RAG 和部署哪块更短板');
  await page.getByRole('button', { name: '提交' }).click();
  await page.getByText(/已选择：其它/).first().waitFor({ timeout: 5000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'hitl-custom.png', fullPage: true });
} else {
  await optionA.click();
  await page.getByText(/已选择：/).first().waitFor({ timeout: 5000 });
  if (expectText) {
    await page.getByText(new RegExp(expectText)).first().waitFor({ timeout: 45000 });
  } else {
    await page.waitForTimeout(8000);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'hitl-resumed.png', fullPage: true });
}

const bodyText = await page.locator('body').innerText();
const checks = {
  card_visible: (await card.count()) > 0,
  question: cardText.includes('你想怎么规划') || cardText.includes('规划') || cardText.includes('确认') || cardText.includes('补充'),
  options_a_b_c: options.length >= 2 && options.some((x) => x.includes('A')) && options.some((x) => x.includes('B')),
  custom_entry: cardText.includes('其它'),
  resumed: bodyText.includes('已选择：') && (!expectText || bodyText.includes(expectText)),
  no_fake_no_content: !bodyText.includes('（没有返回内容，请重试）'),
  errors: errors,
  failed_responses: failedResponses,
};
console.log(JSON.stringify({ options, checks, metrics: await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  bodyHeight: document.body.scrollHeight,
})) }, null, 2));
await browser.close();
