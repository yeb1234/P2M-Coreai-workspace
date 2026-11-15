// 渲染检查：截几张关键区域，看排版有没有问题
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const file = 'file:///C:/Users/yeb12/WorkBuddy/Worktrees/SiteYeb/p2u-3-0-langchain-529238b4/docs/project-story.html';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5 });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(file, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(600);

  await page.screenshot({ path: 'test-results/story-01-hero.png' });

  // 架构图
  await page.locator('#arch').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/story-02-arch.png' });

  // 决策卡
  await page.locator('#decisions').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/story-03-decisions.png' });

  // 坑
  await page.locator('#pits').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/story-04-pits.png' });

  // 面试问答
  await page.locator('#interview').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/story-05-interview.png' });

  // 统计
  const stats = await page.evaluate(() => ({
    height: document.body.scrollHeight,
    sections: document.querySelectorAll('section').length,
    decisions: document.querySelectorAll('.decision').length,
    pits: document.querySelectorAll('.pit').length,
    qa: document.querySelectorAll('.qa').length,
    tables: document.querySelectorAll('table').length,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }));

  console.log('渲染结果:', JSON.stringify(stats, null, 2));
  console.log('JS 错误:', errors.length ? errors.slice(0, 3).join('\n') : '无');

  // 移动端视图
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await mobile.goto(file, { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: 'test-results/story-06-mobile.png' });
  const mOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  console.log('移动端横向溢出:', mOverflow ? '有（需修）' : '无');

  await browser.close();
})();
