import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const WEB = 'http://127.0.0.1:12302/#/interview';
const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'demo', password: 'Demo2026' }),
});
const session = /p2m_session=([^;]+)/.exec(login.headers.get('set-cookie') || '')?.[1];
const user = (await login.json()).user;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([{ name: 'p2m_session', value: session, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript((id) => localStorage.setItem('p2m-auth-user-id', String(id)), user.id);
page.on('response', async (res) => {
  if (!res.url().includes('/api/auth') && !res.url().includes('/api/interview/library')) return;
  let timing = null;
  try { timing = res.request().timing(); } catch {}
  console.log('RESP', res.status(), res.url(), timing);
});
const t0 = Date.now();
await page.goto(WEB, { waitUntil: 'domcontentloaded' });
console.log('domcontentloaded wall', Date.now() - t0);
for (const wait of [100, 300, 600, 1000, 1500, 2500]) {
  await page.waitForTimeout(wait);
  const state = await page.evaluate(() => ({
    now: Math.round(performance.now()),
    tabs: Boolean(document.querySelector('.iv-tabs')),
    cards: document.querySelectorAll('.iv-q-card').length,
    welcome: Boolean(document.querySelector('.animate-pulse')),
  }));
  console.log('STATE', Date.now() - t0, state);
}
const entries = await page.evaluate(() => performance.getEntriesByType('resource')
  .filter((e) => e.name.includes('InterviewPage') || e.name.includes('/api/auth/me') || e.name.includes('/api/interview/library'))
  .map((e) => ({ name: e.name.split('/').pop(), start: Math.round(e.startTime), duration: Math.round(e.duration), transfer: e.transferSize })));
console.log('ENTRIES', entries);
await browser.close();
