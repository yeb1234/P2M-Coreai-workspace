const { chromium } = require('playwright');

const BASE = 'http://localhost';
const USER = { username: 'demo', password: 'Demo2026' };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
  const inputs = page.locator('input');
  await inputs.nth(0).fill(USER.username);
  await inputs.nth(1).fill(USER.password);
  await page.getByRole('button', { name: /登录/ }).first().click();
  await page.waitForTimeout(3500);

  // 读 zustand 持久化后的 navOrder
  const info = await page.evaluate(async () => {
    const out = {};
    // IndexedDB 里的持久化状态
    const dbs = await indexedDB.databases();
    out.dbs = dbs.map((d) => d.name);
    for (const db of dbs) {
      const open = indexedDB.open(db.name);
      const handle = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const stores = Array.from(handle.objectStoreNames);
      out[db.name] = { stores };
      for (const s of stores) {
        const tx = handle.transaction(s, 'readonly');
        const req = tx.objectStore(s).getAll();
        const rows = await new Promise((res) => { req.onsuccess = () => res(req.result); });
        out[db.name][s] = rows.map((r) => {
          if (r && typeof r === 'object' && r.state && r.state.navOrder) {
            return { key: r.key || r.name, navOrderLen: r.state.navOrder.length, hasJourney: r.state.navOrder.includes('journey'), hidden: r.state.hiddenNavItems };
          }
          return { key: r && (r.key || r.id), type: typeof r };
        });
      }
      handle.close();
    }
    // 侧边栏实际渲染的项
    const navTexts = Array.from(document.querySelectorAll('nav a, nav [role="button"], nav div'))
      .map((el) => (el.textContent || '').trim())
      .filter((t) => t && t.length < 12);
    out.sidebarTexts = [...new Set(navTexts)].slice(0, 40);
    return out;
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
