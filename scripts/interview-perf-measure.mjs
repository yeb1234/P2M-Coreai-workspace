import { chromium } from 'playwright';

const API = 'http://127.0.0.1:12402';
const WEB = 'http://127.0.0.1:12302/#/interview';
const OUT = process.env.IV_OUT || '.';

const login = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'demo', password: 'Demo2026' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const loginBody = await login.json();
const setCookie = login.headers.get('set-cookie') || '';
const session = /p2m_session=([^;]+)/.exec(setCookie)?.[1];
if (!session) throw new Error('p2m_session cookie missing');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await context.addCookies([{
  name: 'p2m_session', value: session, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
}]);
const page = await context.newPage();
await page.addInitScript((userId) => localStorage.setItem('p2m-auth-user-id', String(userId)), loginBody.user.id);

const errors = [];
const apiTimes = [];
page.on('response', (response) => {
  if (!response.url().includes('/api/interview')) return;
  const request = response.request();
  let timing = null;
  try { timing = request.timing(); } catch { timing = null; }
  apiTimes.push({
    url: response.url().replace(API, ''),
    status: response.status(),
    duration: timing?.responseStart != null && timing?.requestStart != null
      ? Math.round((timing.responseStart - timing.requestStart) * 10) / 10
      : null,
  });
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

const startedAt = Date.now();
await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.locator('.iv-tabs').waitFor({ timeout: 10000 });
const tabsReadyMs = Date.now() - startedAt;
await page.locator('.iv-q-card').first().waitFor({ timeout: 10000 });
const firstCardMs = Date.now() - startedAt;

const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const resources = performance.getEntriesByType('resource').map((entry) => ({
    name: entry.name,
    duration: Math.round(entry.duration),
    transferSize: entry.transferSize,
    encodedBodySize: entry.encodedBodySize,
    decodedBodySize: entry.decodedBodySize,
    initiatorType: entry.initiatorType,
  }));
  return {
    domNodes: document.querySelectorAll('*').length,
    qCards: document.querySelectorAll('.iv-q-card').length,
    nav: nav && {
      duration: Math.round(nav.duration),
      domInteractive: Math.round(nav.domInteractive),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      loadEventEnd: Math.round(nav.loadEventEnd),
      transferSize: nav.transferSize,
      encodedBodySize: nav.encodedBodySize,
      decodedBodySize: nav.decodedBodySize,
    },
    interviewResources: resources.filter((entry) => entry.name.includes('InterviewPage') || entry.name.includes('/api/interview')),
    largestResources: resources.sort((a, b) => b.decodedBodySize - a.decodedBodySize).slice(0, 12),
  };
});

const result = {
  wallClock: { tabsReadyMs, firstCardMs },
  metrics,
  apiTimes,
  errors,
};
console.log(JSON.stringify(result, null, 2));

await browser.close();
