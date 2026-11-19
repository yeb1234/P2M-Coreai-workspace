import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await context.addCookies([{
  name: 'p2m_session',
  value: token,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem('p2m-auth-user-id', '1');
});
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('response', (res) => {
  if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
});

await page.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.locator('.iv-q-card').first().click();
await page.waitForTimeout(350);

const trigger = page.locator('.iv-report-btn');
console.log('trigger=', await trigger.count());
console.log('triggerLabel=', await trigger.textContent());
await trigger.click();
await page.waitForSelector('.iv-report-dialog', { timeout: 5000 });
console.log('reasons=', await page.locator('.iv-report-reason').count());
console.log('dialogTitle=', await page.locator('#iv-report-title').textContent());

await page.locator('.iv-report-reason').filter({ hasText: '参考答案有误' }).click();
await page.locator('#iv-report-detail').fill('验收脚本：参考答案第二段的结论和题干条件对不上，请核对。');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/interview-report-form-1440.png`, fullPage: false });
await page.locator('.iv-report-form .iv-btn-primary').click();
await page.waitForSelector('.iv-report-success', { timeout: 5000 });
console.log('success=', await page.locator('.iv-report-success h4').textContent());
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/interview-report-1440.png`, fullPage: false });

await page.getByRole('button', { name: '关闭' }).last().click();
await page.waitForTimeout(250);
console.log('reportedLabel=', await page.locator('.iv-report-btn').textContent());
await page.locator('.iv-drawer-head .iv-icon-btn').click();
await page.waitForTimeout(250);

// 重新打开同一张卡，确认 GET 状态回填“已反馈”。
await page.locator('.iv-q-card').first().click();
await page.waitForTimeout(600);
console.log('persistedLabel=', await page.locator('.iv-report-btn').textContent());
console.log('errors=', JSON.stringify(errors));

// 390px 下检查浮层不横向溢出。
const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await narrow.addCookies([{
  name: 'p2m_session',
  value: token,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  secure: false,
  sameSite: 'Lax',
}]);
const mobile = await narrow.newPage();
await mobile.addInitScript(() => {
  localStorage.setItem('p2m-auth-user-id', '1');
});
await mobile.goto('http://127.0.0.1:12302/#/interview', { waitUntil: 'networkidle', timeout: 30000 });
await mobile.waitForSelector('.iv-q-card', { timeout: 15000 });
await mobile.waitForTimeout(400);
await mobile.locator('.iv-q-card').first().click();
await mobile.waitForTimeout(500);
await mobile.locator('.iv-report-btn').click();
await mobile.waitForTimeout(450);
await mobile.waitForSelector('.iv-report-dialog', { timeout: 5000 });
await mobile.screenshot({ path: `${out}/interview-report-390.png`, fullPage: false });
console.log('mobileOverflow=', await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
await browser.close();
