const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(4000);

  // 直接通过 store API 改一条笔记，触发同步（比点 UI 稳）
  const changed = await p.evaluate(async () => {
    const mod = await import('/src/stores/notesStore.ts').catch(() => null);
    return Boolean(mod);
  }).catch(() => false);

  await p.goto('http://localhost/#/notes', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  // 用界面新增：找「新建」类按钮
  const btn = p.getByText(/新建|添加笔记|\+ 新/).first();
  if (await btn.count()) {
    await btn.click();
    await p.waitForTimeout(800);
    const titleInput = p.locator('input[placeholder*="标题"], input[placeholder*="title"]').first();
    if (await titleInput.count()) {
      await titleInput.fill('同步验证笔记');
      const textarea = p.locator('textarea').first();
      if (await textarea.count()) await textarea.fill('这条用来验证笔记会不会同步到后端');
      const saveBtn = p.getByText(/保存|确定/).first();
      if (await saveBtn.count()) await saveBtn.click();
    }
  }
  await p.waitForTimeout(3500); // 等防抖 2 秒 + 请求
  console.log('控制台错误:', errs.length ? errs.slice(0, 3) : '无');
  await p.screenshot({ path: 'test-results/notes-sync.png', fullPage: false });
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
