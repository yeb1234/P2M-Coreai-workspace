// 验证管理员用户管理界面：登录 → 设置 → 用户管理 → 建号 / 改角色 / 停用 → 校验
const { chromium } = require('playwright');

const ADMIN = { username: 'ui_admin', password: 'UiAdmin2026' };

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
  const inputs = page.locator('input');
  await inputs.nth(0).fill(ADMIN.username);
  await inputs.nth(1).fill(ADMIN.password);
  await page.getByRole('button', { name: /^登录$/ }).first().click();
  await page.waitForTimeout(4000);
  await page.waitForLoadState('networkidle').catch(() => {});

  // 设置页
  const settingsNav = page.getByText('设置', { exact: true }).first();
  if (await settingsNav.count()) {
    await settingsNav.click();
  } else {
    await page.goto('http://localhost/#/settings', { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(2000);

  const adminEntry = page.getByText('用户管理', { exact: true }).first();
  if ((await adminEntry.count()) === 0) {
    console.log('  FAIL  管理员看不到「用户管理」入口');
    await page.screenshot({ path: 'test-results/admin-01-missing.png' });
    await browser.close();
    process.exit(1);
  }
  console.log('  PASS  管理员能看到「用户管理」入口');

  await adminEntry.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/admin-02-users.png' });

  const text = await page.locator('body').innerText();
  console.log(`  ${/账号列表/.test(text) ? 'PASS' : 'FAIL'}  账号列表已渲染`);
  console.log(`  ${text.includes('ui_admin') ? 'PASS' : 'FAIL'}  列表包含当前管理员自身`);
  console.log(`  ${/管理员/.test(text) ? 'PASS' : 'FAIL'}  角色列显示正确`);

  // 建一个新号
  const suffix = String(Date.now()).slice(-5);
  const newName = `uiu${suffix}`;
  const allInputs = page.locator('input');
  const inputCount = await allInputs.count();
  let userIdx = -1;
  let pwdIdx = -1;
  for (let i = 0; i < inputCount; i++) {
    const type = await allInputs.nth(i).getAttribute('type');
    if (type === 'password') {
      if (pwdIdx < 0) pwdIdx = i;
    } else if (userIdx < 0) {
      userIdx = i;
    }
  }
  if (userIdx >= 0 && pwdIdx >= 0) {
    await allInputs.nth(userIdx).fill(newName);
    await allInputs.nth(pwdIdx).fill('NewUser2026');
    await page.getByRole('button', { name: /^创建$/ }).first().click();
    await page.waitForTimeout(2500);
    const after = await page.locator('body').innerText();
    console.log(`  ${after.includes(newName) ? 'PASS' : 'FAIL'}  新建账号出现在列表（${newName}）`);
    await page.screenshot({ path: 'test-results/admin-03-created.png' });
  } else {
    console.log('  FAIL  未找到创建账号的输入框');
  }

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
