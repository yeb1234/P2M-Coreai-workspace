// 端到端验证「学习路径」页：登录 → 进入 TAB → 校验路径与视频卡片 → 勾选步骤 → 校验进度 +1
const { chromium } = require('playwright');

const USER = { username: 'audit_a', password: 'NewPass9876' };

async function login(page) {
  await page.goto('http://localhost/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  const inputs = page.locator('input');
  if ((await inputs.count()) < 2) return false;
  await inputs.nth(0).fill(USER.username);
  await inputs.nth(1).fill(USER.password);
  await page.getByRole('button', { name: /登录/ }).first().click();
  await page.waitForTimeout(2500);
  return true;
}

function readDoneCount(text) {
  const match = text.match(/(\d+)\/(\d+)\s*步完成/);
  return match ? { done: Number(match[1]), total: Number(match[2]) } : null;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  const failedUrls = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 200));
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err).slice(0, 200)));
  page.on('response', (res) => {
    if (res.status() === 404) failedUrls.push(res.url());
  });

  if (!(await login(page))) {
    console.log('FAIL 登录失败');
    await browser.close();
    process.exit(2);
  }

  const navLink = page.getByText('学习路径', { exact: true }).first();
  if (await navLink.count()) await navLink.click();
  else await page.goto('http://localhost/#/learning', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/learning-01-top.png' });

  const bodyText = await page.locator('body').innerText();
  const checks = [
    ['页面标题', bodyText.includes('学习路径')],
    ['画像卡片（累计观看）', bodyText.includes('累计观看')],
    ['完成率卡片', bodyText.includes('完成率')],
    ['路径标题', bodyText.includes('补齐 RAG 工程化闭环')],
    ['步骤渲染', /STEP\s*1/.test(bodyText)],
    ['进度文案', /\d+\/\d+\s*步完成/.test(bodyText)],
  ];
  console.log('=== 页面内容校验 ===');
  for (const [name, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);

  const before = readDoneCount(bodyText);
  console.log(`\n=== 步骤操作（当前 ${before ? `${before.done}/${before.total}` : '未知'}）===`);

  // 找出第一个还能操作的步骤（已完成的卡片只有「撤销完成」，不能用来测推进）
  const cards = page.locator('li').filter({ hasText: /STEP\s*\d+/ });
  const cardCount = await cards.count();
  let targetIndex = -1;
  for (let i = 0; i < cardCount; i++) {
    const canAdvance = await cards
      .nth(i)
      .getByRole('button', { name: /开始这一步|标记完成/ })
      .count();
    if (canAdvance) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex < 0) {
    console.log('  FAIL  没有可推进的步骤');
  } else {
    const card = cards.nth(targetIndex);
    const hasBody = await card.getByText('配套视频', { exact: false }).count();
    if (!hasBody) {
      await card.locator('button').first().click();
      await page.waitForTimeout(800);
    }
    await page.screenshot({ path: 'test-results/learning-02-step-open.png' });

    const videoCards = await card.getByRole('button').count();
    console.log(`  ${videoCards > 2 ? 'PASS' : 'FAIL'}  步骤展开后有可点视频（按钮数 ${videoCards}）`);

    // 两段式：pending → in_progress（开始这一步）→ done（标记完成）
    for (let round = 0; round < 2; round++) {
      const btn = page
        .locator('li')
        .filter({ hasText: /STEP\s*\d+/ })
        .nth(targetIndex)
        .getByRole('button', { name: /开始这一步|标记完成/ })
        .first();
      if (!(await btn.count())) break;
      await btn.click();
      await page.waitForTimeout(2000);
    }

    const after = readDoneCount(await page.locator('body').innerText());
    const ok = before && after && after.done === before.done + 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  两次点击后完成数 +1（${before?.done} → ${after?.done}）`);
    await page.screenshot({ path: 'test-results/learning-03-progress.png' });
  }

  // 校验展开状态在刷新后是否保留
  const stillExpanded = await page.getByText('配套视频', { exact: false }).count();
  console.log(`  ${stillExpanded > 0 ? 'PASS' : 'FAIL'}  操作后展开状态保留`);

  if (errors.length) {
    console.log('\n=== 控制台错误 ===');
    for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ' + e);
  } else {
    console.log('\n  控制台无错误');
  }
  if (failedUrls.length) {
    console.log('=== 404 资源 ===');
    for (const u of [...new Set(failedUrls)].slice(0, 5)) console.log('  ' + u);
  }

  await browser.close();
})().catch((err) => {
  console.error('脚本异常:', err);
  process.exit(1);
});
