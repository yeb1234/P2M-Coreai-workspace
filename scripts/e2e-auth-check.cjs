// 验证 Cookie 会话下的浏览器流程：登录 → 整页重载 → 登录态保持 → 可进入受保护页面
const { chromium } = require('playwright');

const USER = { username: 'cookie_test', password: 'Cookie1234' };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));

  await page.goto('http://localhost/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  // 登录
  const inputs = page.locator('input');
  await inputs.nth(0).fill(USER.username);
  await inputs.nth(1).fill(USER.password);
  await page.getByRole('button', { name: /^登录$/ }).first().click();

  // 登录会触发整页 reload，等它稳定
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});

  const bodyAfterLogin = await page.locator('body').innerText();
  const stillOnLogin = /注册账号|请输入用户名和密码/.test(bodyAfterLogin) && !bodyAfterLogin.includes('工作台');
  console.log(`  ${stillOnLogin ? 'FAIL' : 'PASS'}  登录后重载仍保持登录态`);

  // Cookie 是否不可被 JS 读取（httpOnly 的核心保证）
  const cookieVisible = await page.evaluate(() => document.cookie.includes('p2m_session'));
  console.log(`  ${cookieVisible ? 'FAIL' : 'PASS'}  document.cookie 读不到会话（httpOnly 生效）`);

  // 进入学习路径页
  const nav = page.getByText('学习路径', { exact: true }).first();
  if (await nav.count()) {
    await nav.click();
    await page.waitForTimeout(2200);
    const text = await page.locator('body').innerText();
    console.log(`  ${text.includes('学习路径') ? 'PASS' : 'FAIL'}  学习路径页可进入`);
    await page.screenshot({ path: 'test-results/auth-01-learning.png' });
  } else {
    console.log('  FAIL  侧栏没有学习路径入口（可能未登录）');
    await page.screenshot({ path: 'test-results/auth-01-learning.png' });
  }

  // 刷新一次，确认会话不是靠内存维持
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const afterReload = await page.locator('body').innerText();
  console.log(`  ${/工作台|学习路径|待办/.test(afterReload) ? 'PASS' : 'FAIL'}  手动刷新后仍登录`);

  if (errors.length) {
    console.log('\n=== 控制台错误 ===');
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e);
  } else {
    console.log('\n  控制台无错误');
  }

  await browser.close();
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});
