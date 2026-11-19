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
await page.addInitScript((id) => {
  localStorage.setItem('p2m-auth-user-id', String(id));
  window.__t = { navStart: performance.now(), tabsAt: null, firstCardAt: null, longtasks: [], mutations: [] };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 30) window.__t.longtasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration), name: entry.name });
    }
  }).observe({ entryTypes: ['longtask'] });
  const obs = new MutationObserver(() => {
    if (!window.__t.tabsAt && document.querySelector('.iv-tabs')) {
      window.__t.tabsAt = Math.round(performance.now());
      window.__t.mutations.push({ at: window.__t.tabsAt, event: 'tabs' });
    }
    if (!window.__t.firstCardAt && document.querySelector('.iv-q-card')) {
      window.__t.firstCardAt = Math.round(performance.now());
      window.__t.mutations.push({ at: window.__t.firstCardAt, event: 'firstCard' });
    }
  });
  obs.observe(document, { childList: true, subtree: true });
}, user.id);
const t0 = Date.now();
await page.goto(WEB, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const t = await page.evaluate(() => window.__t);
console.log(JSON.stringify({ wall: Date.now() - t0, ...t }, null, 2));
await browser.close();
