import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.addCookies([{ name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});

await page.goto('http://127.0.0.1:12302/#/aiagent', { waitUntil: 'networkidle', timeout: 30000 });
await page.getByText('灵境小助手', { exact: true }).first().waitFor({ timeout: 10000 });
await page.getByText('小助手实际在做什么').waitFor({ timeout: 10000 });
await page.getByText('后端注册表实时').waitFor({ timeout: 15000 });

const oldCards = await page.locator('.auto-grid-cards > div').count();
const promptValue = await page.locator('textarea#f-cbdb6b').inputValue();
const text = await page.locator('body').innerText();
const checks = {
  old_six_cards: oldCards === 6,
  old_card_code: text.includes('代码助手'),
  old_card_auto: text.includes('自动化'),
  old_prompt: promptValue.length > 20 && promptValue.includes('灵境小助手'),
  old_template: text.includes('学习总结') && text.includes('任务拆解'),
  new_capability: text.includes('小助手实际在做什么'),
  intent_priority: text.includes('意图分支优先级'),
  page_context: text.includes('页面上下文与功能') && text.includes('当前题号') && text.includes('推荐视频'),
  runtime_prompt: text.includes('运行时实际提示词'),
  tool_table: text.includes('真实工具清单') && text.includes('search_videos') && text.includes('search_interview_questions') && text.includes('ask_user'),
  mcp: text.includes('MCP 出口') && text.includes('note_summarize') && text.includes('todo_create') && text.includes('calendar_create'),
  base_prompt: text.includes('展开后端基础人设 BASE_PROMPT'),
  counts: /10 个能力包 · 15 个 Agent 工具 · 19 个 MCP 工具/.test(text),
  intent_note: text.includes('保存笔记') && text.includes('interview-question') && text.includes('fallback'),
};
console.log('oldCards=', oldCards);
console.log('countLine=', text.split('\n').find((line) => line.includes('个能力包')));
console.log('checks=', JSON.stringify(checks));
console.log('metrics=', JSON.stringify(await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  bodyScrollWidth: document.body.scrollWidth,
  bodyHeight: document.body.scrollHeight,
})), null, 0));
console.log('errors=', JSON.stringify(errors));
await page.screenshot({ path: `${out}/assistant-capabilities.png`, fullPage: true });
await browser.close();
