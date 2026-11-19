import { chromium } from 'playwright';

const token = process.env.IV_TOKEN;
if (!token) throw new Error('IV_TOKEN missing');
const out = process.env.IV_OUT || '.';

const steps = [
  { id: 'step-1', order_index: 0, title: 'Python 工具链', objective: '完成 Python 工程化工具链。', video_ids: [], videos: [], est_minutes: 480, status: 'done', reflection: '' },
  { id: 'step-2', order_index: 1, title: 'FastAPI 基础', objective: '完成 FastAPI 基础。', video_ids: [], videos: [], est_minutes: 480, status: 'done', reflection: '' },
  { id: 'step-3', order_index: 2, title: 'LangChain 工具调用与 Agent 链', objective: '完成 LangChain 工具调用。', video_ids: [], videos: [], est_minutes: 540, status: 'done', reflection: '' },
  { id: 'step-4', order_index: 3, title: 'LangGraph 状态图编排', objective: '能用 LangGraph 搭建状态图与普通边实现 Agent 核心编排。', video_ids: [], videos: [], est_minutes: 480, status: 'in_progress', reflection: '' },
  { id: 'step-5', order_index: 4, title: 'RAG 工程化闭环', objective: 'RAG 工程化闭环执行与评测。', video_ids: [], videos: [], est_minutes: 600, status: 'pending', reflection: '' },
  { id: 'step-6', order_index: 5, title: 'FastAPI 服务化部署', objective: '完成 FastAPI 服务化部署。', video_ids: [], videos: [], est_minutes: 480, status: 'pending', reflection: '' },
  { id: 'step-7', order_index: 6, title: 'Agent 评估与可观测性', objective: '完成 Agent 评估与可观测性。', video_ids: [], videos: [], est_minutes: 420, status: 'pending', reflection: '' },
];

let step4Done = false;

function currentPath() {
  const current = steps.map((step) => ({
    ...step,
    status: step.id === 'step-4' && step4Done ? 'done' : step.status,
  }));
  const done = current.filter((step) => step.status === 'done').length;
  return {
    id: 'path-mock',
    goal_id: 'goal-mock',
    title: 'AI Agent 工程师：补齐工程化闭环',
    summary: '从 Python 工具链一路做到 Agent 评估。',
    status: 'active',
    total_est_minutes: current.reduce((sum, step) => sum + step.est_minutes, 0),
    created_at: '2026-11-19T00:00:00+08:00',
    progress: { done, total: current.length, percent: Math.round((done / current.length) * 100), done_minutes: done * 480 },
    steps: current,
  };
}

const profile = {
  total_watch_minutes: 4800,
  videos_started: 32,
  videos_completed: 12,
  completion_rate: 0.375,
  avg_session_minutes: 52,
  active_days_30d: 14,
  streak_days: 3,
  notes_count: 18,
  active_hours: {},
  top_categories: [],
  last_active_at: null,
  computed_at: null,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await context.addCookies([{ name: 'p2m_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }]);
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('p2m-auth-user-id', '1'));

await page.route('**/api/learning/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'GET' && url.pathname === '/api/learning/profile') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
  }
  if (request.method() === 'GET' && url.pathname === '/api/learning/paths') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([currentPath()]) });
  }
  if (request.method() === 'PATCH' && url.pathname.startsWith('/api/learning/steps/')) {
    const body = request.postDataJSON();
    if (body?.status === 'done') step4Done = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'step-4', status: body?.status ?? 'pending', path_status: 'active' }) });
  }
  return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'not mocked' }) });
});

await page.goto('http://127.0.0.1:12302/#/learning', { waitUntil: 'networkidle', timeout: 30000 });
await page.getByText('STEP 4', { exact: true }).waitFor({ timeout: 10000 });
await page.waitForTimeout(300);
const step4 = page.locator('li').filter({ hasText: 'STEP 4' });
const step5 = page.locator('li').filter({ hasText: 'STEP 5' });
console.log('before_step4_objective=', await step4.getByText('能用 LangGraph 搭建状态图与普通边实现 Agent 核心编排。').count());
console.log('before_step5_objective=', await step5.getByText('RAG 工程化闭环执行与评测。').count());

await step4.getByRole('button', { name: '标记完成' }).click();
await page.getByText('RAG 工程化闭环执行与评测。').waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
console.log('after_step4_objective=', await step4.getByText('能用 LangGraph 搭建状态图与普通边实现 Agent 核心编排。').count());
console.log('after_step5_objective=', await step5.getByText('RAG 工程化闭环执行与评测。').count());
console.log('after_step5_status=', (await step5.textContent())?.includes('未开始'));
await page.screenshot({ path: `${out}/learning-path-auto-expand.png`, fullPage: false });
await browser.close();
