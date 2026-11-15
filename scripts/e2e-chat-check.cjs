// 端到端验证：登录 → 打开灵境小助手 → 发带检索的问题 → 校验流式输出与引用卡片
const { chromium } = require('playwright');

const USER = { username: 'e2e_tester', password: 'e2e-test-2026' };

async function login(page) {
  await page.goto('http://localhost:5002/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);

  const inputs = page.locator('input');
  const count = await inputs.count();
  if (count < 2) {
    console.log('输入框数量异常:', count);
    return false;
  }
  // 登录表单通常第一个是用户名，第二个是密码
  await inputs.nth(0).fill(USER.username);
  await inputs.nth(1).fill(USER.password);
  const submit = page.getByRole('button', { name: /登录/ }).first();
  await submit.click();
  await page.waitForTimeout(2500);
  return true;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 950 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 240));
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 240)));

  const loggedIn = await login(page);
  if (!loggedIn) {
    await browser.close();
    process.exit(2);
  }
  await page.screenshot({ path: 'test-results/after-login.png' });

  // 聊天入口在 AI 助手页，直接导航
  await page.goto('http://localhost:5002/#/aiagent', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/aiagent-page.png' });

  // 打开聊天面板
  let opened = false;
  for (const locator of [
    page.getByRole('button', { name: /打开灵境小助手/ }),
    page.getByRole('button', { name: /灵境小助手/ }),
    page.locator('[title*="灵境"]'),
  ]) {
    try {
      if (await locator.count()) {
        await locator.first().click({ timeout: 3000 });
        opened = true;
        break;
      }
    } catch {
      /* 试下一个 */
    }
  }

  if (!opened) {
    const buttons = await page.locator('button').allInnerTexts();
    console.log('未找到聊天入口，按钮列表：', JSON.stringify(buttons.slice(0, 30)));
    await page.screenshot({ path: 'test-results/no-chat-entry.png' });
    await browser.close();
    process.exit(3);
  }

  console.log('[step] 点击入口完成:', opened);
  await page.waitForTimeout(1500);

  console.log('[step] aside 数量:', await page.locator('aside').count());
  console.log('[step] textarea 数量:', await page.locator('textarea').count());
  const placeholders = await page.locator('textarea').evaluateAll((els) =>
    els.map((el) => el.getAttribute('placeholder'))
  );
  console.log('[step] textarea placeholders:', JSON.stringify(placeholders));
  await page.screenshot({ path: 'test-results/chat-opened.png' });

  const textarea = page.locator('textarea[placeholder*="输入消息"]').first();
  try {
    await textarea.waitFor({ timeout: 15000 });
  } catch {
    console.log('[fail] 找不到聊天输入框');
    await browser.close();
    process.exit(4);
  }

  const question = '库里有讲事件循环的视频吗？给具体时间点';
  await textarea.fill(question);
  await textarea.press('Enter');
  console.log('[step] 已发送消息，等待流式响应');

  // 等流式输出稳定
  let last = '';
  let stable = 0;
  const start = Date.now();
  while (Date.now() - start < 70000) {
    await page.waitForTimeout(1500);
    const text = await page.locator('aside').last().innerText().catch(() => '');
    if (text.length > 250 && text === last) {
      stable += 1;
      if (stable >= 3) break;
    } else {
      stable = 0;
    }
    last = text;
    // 早期中断：出现错误提示
    if (/对话请求失败|连不上后端|请求失败/.test(text)) break;
  }

  await page.screenshot({ path: 'test-results/chat-answered.png' });
  const asideText = await page.locator('aside').last().innerText();
  console.log('=== 聊天面板 ===');
  console.log(asideText.slice(0, 1500));
  console.log('=== 引用卡片数量 ===');
  console.log(await page.locator('aside button:has-text("相关片段")').count());
  console.log('=== 控制台错误 ===');
  console.log(errors.length ? [...new Set(errors)].slice(0, 8).join('\n') : '(无)');

  await browser.close();
})();
