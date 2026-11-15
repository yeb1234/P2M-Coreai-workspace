const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

  // ---- 登录页：先不带凭据，检查表单语义 ----
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(1000);
  const form = await p.evaluate(() => {
    const labels = [...document.querySelectorAll('label[for]')];
    const inputs = [...document.querySelectorAll('input[id]')];
    return {
      labelFor: labels.map((l) => l.getAttribute('for')),
      inputId: inputs.map((i) => i.id),
    };
  });
  console.log('登录页 label[for]:', form.labelFor);
  console.log('登录页 input[id]:', form.inputId);
  console.log('label 与 input 配对:', form.labelFor.every((f) => form.inputId.includes(f)) ? '✓ 全部配对' : '✗ 有落单');

  // ---- 故意输错密码，看错误提示是否有 role=alert ----
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('wrongpassword');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(2500);
  const err = await p.evaluate(() => {
    const el = document.querySelector('[role="alert"]');
    if (!el) return null;
    return {
      text: el.textContent.trim().slice(0, 20),
      described: [...document.querySelectorAll('input[aria-describedby]')].length,
      invalid: [...document.querySelectorAll('input[aria-invalid="true"]')].length,
    };
  });
  console.log('错误提示 role=alert:', err ? `✓「${err.text}」` : '✗ 没有');
  if (err) console.log(`  关联输入框: ${err.described} 个 aria-describedby, ${err.invalid} 个 aria-invalid=true`);

  // ---- 表格 scope ----
  const i2 = p.locator('input');
  await i2.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);
  await p.goto('http://localhost/#/settings', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const th = await p.evaluate(() => {
    const all = [...document.querySelectorAll('th')];
    return { total: all.length, withScope: all.filter((e) => e.getAttribute('scope')).length };
  });
  console.log(`表格表头: ${th.total} 个 th，${th.withScope} 个有 scope`);
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
