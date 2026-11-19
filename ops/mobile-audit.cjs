const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:12302';
const VIEWPORT = process.env.P2M_VIEWPORT || '390x844';
const [VW, VH] = VIEWPORT.split('x').map(Number);
const OUT = path.join(__dirname, 'mobile-audit');
const SHOTS = path.join(OUT, VIEWPORT);
const ROUTES = [
  ['dashboard', ''], ['todo', 'todo'], ['calendar', 'calendar'], ['calendar2', 'calendar2'],
  ['notes', 'notes'], ['pomodoro', 'pomodoro'], ['timecenter', 'timecenter'],
  ['video', 'video'], ['learning', 'learning'], ['journey', 'journey'],
  ['transcriber', 'transcriber'], ['health', 'health'], ['compare', 'compare'],
  ['shop', 'shop'], ['esports', 'esports'], ['stats', 'stats'], ['reader', 'reader'],
  ['snippets', 'snippets'], ['habits', 'habits'], ['flashcards', 'flashcards'],
  ['bookmarks', 'bookmarks'], ['tokens', 'tokens'], ['leetcode', 'leetcode'],
  ['interview', 'interview'], ['codenav', 'codenav'], ['aiagent', 'aiagent'],
  ['openclaw', 'openclaw'], ['hermes', 'hermes'], ['settings', 'settings'],
];
const SHOT = new Set(['dashboard', 'todo', 'calendar', 'calendar2', 'notes', 'pomodoro', 'video', 'transcriber', 'aiagent', 'settings', 'stats', 'health', 'shop']);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  if (process.env.P2M_AUDIT_TOKEN) {
    await context.addCookies([{
      name: 'p2m_session',
      value: process.env.P2M_AUDIT_TOKEN,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    }]);
  }
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('p2m-auth-user-id', '1');
    localStorage.setItem('p2m-role', 'member');
    localStorage.setItem('p2m-current-user', 'Mobile Audit');
  });

  const rows = [];
  for (const [id, route] of ROUTES) {
    await page.goto(`${BASE}/#/${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      const main = document.querySelector('.mobile-app-main');
      return Boolean(main && main.clientWidth > 0);
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(900);
    const info = await page.evaluate(() => {
      const main = document.querySelector('main');
      const visible = main ? [...main.children].find((el) => getComputedStyle(el).display !== 'none') : null;
      const overflow = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || s.position === 'fixed') continue;
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          overflow.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || '').slice(0, 60),
            left: Math.round(r.left),
            right: Math.round(r.right),
            w: Math.round(r.width),
          });
        }
        if (overflow.length >= 8) break;
      }
      return {
        title: document.title,
        hash: location.hash,
        innerWidth: window.innerWidth,
        docW: document.documentElement.scrollWidth,
        bodyW: document.body.scrollWidth,
        mainW: main ? main.clientWidth : 0,
        mainScrollW: main ? main.scrollWidth : 0,
        mainH: main ? main.clientHeight : 0,
        mainScrollH: main ? main.scrollHeight : 0,
        visibleText: visible ? visible.innerText.slice(0, 60).replace(/\s+/g, ' ') : '',
        overflow,
      };
    });
    rows.push({ id, route, ...info });
    if (SHOT.has(id)) {
      await page.screenshot({ path: path.join(SHOTS, `${id}.png`), fullPage: false });
    }
  }
  fs.writeFileSync(path.join(OUT, `mobile-audit-${VIEWPORT}.json`), JSON.stringify(rows, null, 2), 'utf8');
  console.table(rows.map((r) => ({
    id: r.id,
    docW: r.docW,
    mainW: r.mainW,
    scrollW: r.mainScrollW,
    h: r.mainScrollH,
    overflow: r.overflow.length,
    text: r.visibleText.slice(0, 18),
  })));
  console.log(JSON.stringify(rows.filter((r) => r.docW > r.innerWidth || r.mainScrollW > r.mainW || r.overflow.length), null, 2));
  await browser.close();
})();
