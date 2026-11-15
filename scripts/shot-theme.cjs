const { chromium } = require('playwright');

const VARS = {
  '--bg-body': '#eceae5', '--bg-base': '#f7f6f3', '--bg-card': '#fdfcfa',
  '--bg-elevated': '#f2f0eb', '--bg-accent': '#f0ede6',
  '--text-primary': '#1c1c1a', '--text-secondary': '#6b6862', '--text-muted': '#a19d96',
  '--border-light': '#e6e3dc', '--border-medium': '#d5d1c9',
  '--accent': '#3a3733', '--accent-hover': '#26241f', '--accent-bg': '#ece9e2',
  '--paper-bg': '#fbfaf7', '--scrollbar-thumb': '#d5d1c9', '--scrollbar-hover': '#bdb8af',
  '--header-bg': 'rgba(247,246,243,0.82)', '--sidebar-bg': 'rgba(247,246,243,0.92)',
  '--success': '#4a7c59', '--danger': '#a4442f',
  '--shadow-card': '0 1px 2px rgba(28,28,26,0.04)',
};

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await p.goto('http://localhost', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('input', { state: 'visible', timeout: 20000 });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('demo'); await i.nth(1).fill('Demo2026');
  await p.getByRole('button', { name: /登录/ }).first().click();
  await p.waitForTimeout(5500);

  // 注入学术纸感主题
  await p.evaluate((vars) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'scholar-paper');
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, VARS);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'test-results/vars-scholar-home.png' });

  await p.goto('http://localhost/#/journey', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  await p.evaluate((vars) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'scholar-paper');
    Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }, VARS);
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'test-results/vars-scholar-journey.png' });
  console.log('主题截图完成');
  await b.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
