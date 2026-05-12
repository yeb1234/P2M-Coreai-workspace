import { expect, test, type Page } from '@playwright/test';
import { THEME_PRESETS } from '../../src/lib/themes';

const TEST_NOW_ISO = '2026-05-11T07:30:00+08:00';
const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const mockVideo = {
  id: 101,
  title: '布局回归测试视频',
  filename: 'layout-regression.mp4',
  filepath: 'C:/SiteYeb/mock/layout-regression.mp4',
  file_size: 1024,
  duration: 180,
  thumbnail: null,
  tags: null,
  category_id: null,
  category_path: '测试文件夹',
  transcription: '这是一段用于布局回归的测试字幕。',
  transcript_segments: [
    { start: 0, end: 4, text: '这是一段用于布局回归的测试字幕。' },
  ],
  summary: '这是一个用于 Playwright 布局回归的测试总结。',
  markdown_path: null,
  subtitle_path: null,
  subtitle_url: null,
  ai_status: 'completed',
  ai_stage: 'completed',
  ai_error: null,
  active_job_id: null,
  watch_progress: null,
  completed: false,
  is_favorite: false,
  favorited_at: null,
  created_at: '2026-05-11T00:00:00',
  updated_at: '2026-05-11T00:00:00',
};

async function prepareApp(page: Page, route = '/') {
  await mockApi(page);
  await page.addInitScript((testNowIso) => {
    window.localStorage.setItem('p2m-current-user', 'Playwright');
    const fixedTime = new Date(testNowIso).getTime();
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(...(args.length > 0 ? args : [fixedTime]));
      }

      static now() {
        return fixedTime;
      }
    }
    FixedDate.UTC = NativeDate.UTC;
    FixedDate.parse = NativeDate.parse;
    FixedDate.prototype = NativeDate.prototype;
    window.Date = FixedDate as DateConstructor;
  }, TEST_NOW_ISO);
  await page.goto(route);
  const registerLink = page.getByText('去注册');
  if (
    await page.getByRole('button', { name: '登录' }).isVisible().catch(() => false)
    && await registerLink.isVisible({ timeout: 1000 }).catch(() => false)
  ) {
    await registerLink.click();
    await page.getByPlaceholder('输入用户名').fill(`e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await page.getByPlaceholder('输入密码', { exact: true }).fill('e2e-password');
    await page.getByPlaceholder('再次输入密码').fill('e2e-password');
    await page.getByRole('button', { name: '注册' }).click();
    await page.goto(route);
  }
  await expect(page.locator('main').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForLoadState('networkidle');
}

async function mockApi(page: Page) {
  const scheduleItems: Array<Record<string, unknown>> = [];
  const normalizeScheduleItem = (body: Record<string, unknown>) => ({
    id: String(body.id || `schedule-${scheduleItems.length + 1}`),
    type: body.type || 'todo',
    title: body.title || '未命名事项',
    description: body.description || '',
    status: body.status || 'pending',
    priority: body.priority || 'green',
    start_at: body.start_at || '2026-05-11T01:00:00.000Z',
    due_at: body.due_at || '2026-05-11T02:00:00.000Z',
    reminder_at: body.reminder_at ?? null,
    pomodoro_count: body.pomodoro_count || 0,
    pomodoro_rounds: body.pomodoro_rounds || 0,
    total_focus_minutes: body.total_focus_minutes || 0,
    completed_at: body.completed_at ?? null,
    deleted_at: body.deleted_at ?? null,
    sort_order: body.sort_order || 0,
    created_at: body.created_at || '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
  });

  await page.route('**/api/auth/register', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'playwright-token',
        token_type: 'bearer',
        user: { username: 'playwright', display_name: 'Playwright' },
      }),
    });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ username: 'playwright', display_name: 'Playwright' }),
    });
  });
  await page.route('**/api/user-data/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ value: null }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/schedule-items**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathParts = url.pathname.split('/').filter(Boolean);
    const itemId = pathParts[2];

    if (method === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: scheduleItems }) });
      return;
    }

    if (method === 'POST' && itemId && pathParts[3] === 'restore') {
      const item = scheduleItems.find((entry) => entry.id === itemId);
      if (item) item.deleted_at = null;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(item) });
      return;
    }

    if (method === 'POST') {
      const body = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
      const item = normalizeScheduleItem(body);
      scheduleItems.push(item);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(item) });
      return;
    }

    if (method === 'PATCH' && itemId) {
      const body = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
      const index = scheduleItems.findIndex((entry) => entry.id === itemId);
      if (index >= 0) {
        scheduleItems[index] = normalizeScheduleItem({ ...scheduleItems[index], ...body, id: itemId });
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(scheduleItems[index]) });
        return;
      }
    }

    if (method === 'DELETE' && itemId) {
      const permanent = url.searchParams.get('permanent') === 'true';
      const index = scheduleItems.findIndex((entry) => entry.id === itemId);
      if (index >= 0 && permanent) {
        scheduleItems.splice(index, 1);
      } else if (index >= 0) {
        scheduleItems[index].deleted_at = '2026-05-11T00:00:00.000Z';
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    if (method === 'DELETE') {
      scheduleItems.splice(0, scheduleItems.length);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/categories/tree', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/videos?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [mockVideo], total: 1, page: 1, page_size: 20, total_pages: 1 }),
    });
  });
  await page.route('**/api/videos/101', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(mockVideo) });
  });
  await page.route('**/api/videos/*/favorite', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { is_favorite?: boolean };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...mockVideo,
        is_favorite: Boolean(body.is_favorite),
        favorited_at: body.is_favorite ? '2026-05-11T00:00:00' : null,
      }),
    });
  });
  await page.route('**/api/videos/101/playlist?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        videos: [
          { id: 101, title: mockVideo.title, thumbnail: null, category_path: '测试文件夹', watch_progress: null, completed: false, is_favorite: false, favorited_at: null, subtitle_url: null },
          { id: 102, title: '第二个测试视频', thumbnail: null, category_path: '测试文件夹', watch_progress: null, completed: false, is_favorite: false, favorited_at: null, subtitle_url: null },
        ],
        current_index: 0,
        total: 2,
      }),
    });
  });
  await page.route('**/api/ai-jobs?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            id: 'job-1',
            video_id: 101,
            video_title: mockVideo.title,
            status: 'completed',
            stage: 'completed',
            message: 'Processing complete',
            error: null,
            whisper_engine: 'whisper.cpp',
            whisper_model: 'large-v3',
            language: 'zh',
            do_summary: true,
            word_limit: 200,
            cpu_threads: null,
            compute_type: null,
            subtitle_correction_enabled: false,
            subtitle_correction_scope: 'off',
            subtitle_correction_prompt: null,
            summary_error: null,
            created_at: '2026-05-11T00:00:00',
            updated_at: '2026-05-11T00:00:00',
          },
        ],
        total: 1,
        running: 0,
        queued: 0,
        failed: 0,
        completed: 1,
      }),
    });
  });
  await page.route('**/api/admin/ai-jobs/queue', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ paused: false, running: 0, queued: 0, failed: 0, completed: 1 }) });
  });
  await page.route('**/api/admin/assistant-settings', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        local_base_url: 'http://127.0.0.1:1234/v1',
        local_api_key: '',
        local_model: 'qwen3-4b',
        external_base_url: 'https://api.deepseek.com/v1',
        external_api_key: '',
        external_model: 'deepseek-v4-flash',
        llm_usage_policy: 'external_first',
      }),
    });
  });
  await page.route('**/api/videos/history', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/videos/101/file', async (route) => {
    await route.fulfill({ status: 404, body: '' });
  });
  await page.route('**/api/videos/101/sprite', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'X-Sprite-Meta': JSON.stringify({
          video_id: 101,
          cols: 2,
          rows: 1,
          frame_width: 1,
          frame_height: 1,
          frame_interval: 90,
          total_frames: 2,
          duration: 180,
        }),
      },
      body: onePixelPng,
    });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

async function getCalendar2DropPoint(page: Page, dayIndex: number, hourOffset: number) {
  const grid = page.locator('main.app-main [class*="select-none"]').first();
  const metrics = await grid.evaluate((node) => {
    const element = node as HTMLElement;
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      leftGutter: 64,
    };
  });
  const visibleDays = await getCalendar2VisibleDayCount(page);
  const dayWidth = (metrics.width - metrics.leftGutter) / visibleDays;
  return {
    x: metrics.leftGutter + dayWidth * dayIndex + Math.min(40, dayWidth / 2),
    y: 64 * hourOffset + 8,
  };
}

async function getCalendar2VisibleDayCount(page: Page) {
  return page.locator('main.app-main').evaluate(() => {
    const header = Array.from(document.querySelectorAll('main.app-main p'))
      .filter((item) => /^周[一二三四五六日]$/.test(item.textContent || ''));
    return header.length;
  });
}

function getCalendar2Grid(page: Page) {
  return page.locator('main.app-main [class*="select-none"]').first();
}

async function expectCalendar2NoInternalHorizontalOverflow(page: Page) {
  const overflow = await page.locator('main.app-main').evaluate(() => {
    const shells = Array.from(document.querySelectorAll('main.app-main section, main.app-main div'));
    let maxOverflow = 0;
    for (const node of shells) {
      const element = node as HTMLElement;
      const delta = element.scrollWidth - element.clientWidth;
      if (delta > maxOverflow) maxOverflow = delta;
    }
    return maxOverflow;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

async function openAiPanel(page: Page) {
  const button = page.getByTitle('灵境小助手').or(page.getByRole('button', { name: /灵境小助手|AI/ })).first();
  await button.click();
  await expect(page.getByText('灵境小助手').first()).toBeVisible();
}

async function applyThemePreset(page: Page, themeId: string) {
  const theme = THEME_PRESETS.find((preset) => preset.id === themeId);
  expect(theme, `${themeId} theme preset should exist`).toBeTruthy();
  await page.evaluate((preset) => {
    document.documentElement.setAttribute('data-theme', preset.id);
    for (const [key, value] of Object.entries(preset.vars)) {
      document.documentElement.style.setProperty(key, value);
    }
  }, theme!);
}

test.describe('layout regression', () => {
  test.skip(({ isMobile }) => isMobile, 'desktop layout screenshots are covered by desktop projects');

  test('settings page fits with right assistant panel open', async ({ page }) => {
    await prepareApp(page, '/#/settings');
    await expect(page.getByText('设置').first()).toBeVisible();
    await openAiPanel(page);
    await expect(page.locator('main.app-main')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('settings-with-ai-panel.png');
  });

  test('video page list uses adaptive grids without overflow', async ({ page }) => {
    await prepareApp(page, '/#/video');
    await expect(page.getByText('IT视频站').first()).toBeVisible();
    await expect(page.locator('.video-card-grid').first()).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('video-list-layout.png');
  });

  test('video card sprite preview loads only after hover', async ({ page }) => {
    let spriteRequests = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/videos/101/sprite')) spriteRequests += 1;
    });

    await prepareApp(page, '/#/video');
    await expect(page.locator('.video-card-grid').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    expect(spriteRequests).toBe(0);

    await page.locator('.video-card-grid .theme-card .theme-progress-track').first().hover();
    await expect.poll(() => spriteRequests, { timeout: 2_000 }).toBeGreaterThan(0);
  });

  test('time center plugin fits desktop layout', async ({ page }) => {
    await prepareApp(page, '/#/timecenter');
    await expect(page.getByText('时间中心').first()).toBeVisible();
    await expect(page.getByText('时间任务表')).toBeVisible();
    await expect(page.getByText('统一管理计时、倒计时、闹钟与提醒')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('time-center-layout.png');
  });

  test('calendar2 week view supports drag selection', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();
    const grid = getCalendar2Grid(page);
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const start = await getCalendar2DropPoint(page, 2, 4);
    const end = await getCalendar2DropPoint(page, 2, 6);
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + end.x, box.y + end.y);
    await page.mouse.up();

    await expect(page.getByText('新建日程')).toBeVisible();
    await page.getByPlaceholder('日程标题').fill('测试拖拽日程');
    await page.getByLabel('保存为待办').check();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('[data-calendar-event]').filter({ hasText: '测试拖拽日程' }).first()).toBeVisible();

    await page.goto('/#/todo');
    await expect(page.locator('main.app-main').getByText('测试拖拽日程', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('calendar2 supports dragging calendar lanes and events', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();

    const grid = getCalendar2Grid(page);
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    await page.locator('label', { hasText: '粉色待办' }).getByText('拖入').dragTo(grid, {
      targetPosition: await getCalendar2DropPoint(page, 3, 8),
    });
    await expect(page.getByText('新建日程')).toBeVisible();
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('[data-calendar-event]').filter({ hasText: '粉色待办' })).toHaveCount(1);

    const createdEvent = page.locator('[data-calendar-event]').filter({ hasText: '粉色待办' }).first();
    await createdEvent.dragTo(grid, {
      targetPosition: await getCalendar2DropPoint(page, 1, 9),
    });
    await expect(createdEvent).toBeVisible();
    await expect(page.locator('[data-calendar-event]').filter({ hasText: '粉色待办' })).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
  });

  test('calendar2 shows overlapping events side by side', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();

    const grid = getCalendar2Grid(page);
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    for (const title of ['重叠任务1', '重叠任务2']) {
      const start = await getCalendar2DropPoint(page, 2, 4);
      const end = await getCalendar2DropPoint(page, 2, 6);
      await page.mouse.move(box.x + start.x, box.y + start.y);
      await page.mouse.down();
      await page.mouse.move(box.x + end.x, box.y + end.y);
      await page.mouse.up();

      await expect(page.getByText('新建日程')).toBeVisible();
      await page.getByPlaceholder('日程标题').fill(title);
      await page.getByLabel('保存为待办').check();
      await page.getByRole('button', { name: '保存' }).click();
    }

    const overlappedEvents = page.locator('[data-calendar-event]').filter({ hasText: /重叠任务[12]/ });
    await expect(overlappedEvents).toHaveCount(2);

    const boxes = await overlappedEvents.evaluateAll((nodes) => nodes.map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        conflictColumn: element.dataset.conflictColumn,
        conflictColumns: element.dataset.conflictColumns,
      };
    }));

    expect(new Set(boxes.map((item) => item.conflictColumns))).toEqual(new Set(['2']));
    expect(new Set(boxes.map((item) => item.conflictColumn))).toEqual(new Set(['0', '1']));
    expect(Math.abs(boxes[0].left - boxes[1].left)).toBeGreaterThan(20);
    expect(boxes[0].width).toBeLessThan((await grid.boundingBox())!.width / 2);
  });

  test('calendar2 right panel only shows concrete todos for this week', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();
    await expect(page.getByText('本周还没有具体事项')).toBeVisible();

    const grid = getCalendar2Grid(page);
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const start = await getCalendar2DropPoint(page, 1, 5);
    const end = await getCalendar2DropPoint(page, 1, 6);
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + end.x, box.y + end.y);
    await page.mouse.up();

    await page.getByPlaceholder('日程标题').fill('右栏待办显示测试');
    await page.getByLabel('保存为待办').check();
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText('本周还没有具体事项')).toBeHidden();
    await expect(page.locator('aside').getByText('右栏待办显示测试', { exact: true })).toBeVisible();
    await expect(page.getByText('拖入').first()).toBeVisible();
  });

  test('calendar2 closing draft modal clears pending selection', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();

    const grid = getCalendar2Grid(page);
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const start = await getCalendar2DropPoint(page, 2, 4);
    const end = await getCalendar2DropPoint(page, 2, 6);
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + end.x, box.y + end.y);
    await page.mouse.up();

    await expect(page.getByText('新建日程')).toBeVisible();
    await page.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('新建日程')).toBeHidden();
    await expect(page.locator('[data-calendar-event]').filter({ hasText: '未命名事项' })).toHaveCount(0);
  });

  test('calendar2 supports context-menu deletion for scheduled items', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await page.on('dialog', (dialog) => dialog.accept());

    const grid = getCalendar2Grid(page);
    const box = await grid.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const start = await getCalendar2DropPoint(page, 2, 4);
    const end = await getCalendar2DropPoint(page, 2, 6);
    await page.mouse.move(box.x + start.x, box.y + start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + end.x, box.y + end.y);
    await page.mouse.up();

    await page.getByPlaceholder('日程标题').fill('右键删除测试');
    await page.getByRole('button', { name: '保存' }).click();
    const createdEvent = page.locator('[data-calendar-event]').filter({ hasText: '右键删除测试' }).first();
    await expect(createdEvent).toBeVisible();

    await createdEvent.click({ button: 'right' });
    await expect(createdEvent).toBeHidden();
  });

  test('calendar2 month picker collapses and switches weeks', async ({ page }) => {
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();
    await expect(page.getByTitle('切换到 2026-05-18 所在周')).toBeVisible();
    await page.getByTitle('切换到 2026-05-18 所在周').click();
    await expect(page.locator('main.app-main').getByText('18').first()).toBeVisible();

    await page.getByTitle('折叠月历').click();
    await expect(page.getByTitle('切换到 2026-05-18 所在周')).toBeHidden();
    await page.getByTitle('展开月历').click();
    await expect(page.getByTitle('切换到 2026-05-18 所在周')).toBeVisible();
  });

  test('calendar2 narrows to four visible days on low width', async ({ page }) => {
    await page.setViewportSize({ width: 980, height: 820 });
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();
    await expect(page.getByTitle('切换显示前半周/后半周')).toHaveText('周一-周四');
    await expect(page.locator('main.app-main').getByText('周五').first()).toBeHidden();
    await page.getByTitle('切换显示前半周/后半周').click();
    await expect(page.getByTitle('切换显示前半周/后半周')).toHaveText('周二-周五');
    await expect(page.locator('main.app-main').getByText('周五').first()).toBeVisible();
    await page.getByTitle('切换显示前半周/后半周').click();
    await expect(page.getByTitle('切换显示前半周/后半周')).toHaveText('周三-周六');
    await expectNoHorizontalOverflow(page);
  });

  test('calendar2 progressively shows 4, 5, 6, and 7 days as width grows', async ({ page }) => {
    const cases = [
      { width: 860, count: 4 },
      { width: 1120, count: 5 },
      { width: 1380, count: 6 },
      { width: 1540, count: 7 },
    ];

    for (const item of cases) {
      await page.setViewportSize({ width: item.width, height: 820 });
      await prepareApp(page, '/#/calendar2');
      await expect.poll(() => getCalendar2VisibleDayCount(page)).toBe(item.count);
      await expectNoHorizontalOverflow(page);
    }
  });

  test('calendar2 full-width desktop view avoids internal horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 900 });
    await prepareApp(page, '/#/calendar2');
    await expect(page.getByText('日历2').first()).toBeVisible();
    await expect.poll(() => getCalendar2VisibleDayCount(page)).toBe(7);
    await expectCalendar2NoInternalHorizontalOverflow(page);
  });

  test('dark theme keeps settings surfaces dark and readable', async ({ page }) => {
    await prepareApp(page, '/#/settings');
    await applyThemePreset(page, 'primer-dark');

    const panel = page.locator('main.app-main').locator('div').filter({ hasText: '番茄钟设置' }).first();
    await expect(panel).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('settings-primer-dark.png');
  });

  test('video player page keeps playlist and AI job center aligned', async ({ page }) => {
    await prepareApp(page, '/#/video');
    await page.getByText(mockVideo.title).first().click();

    await expect(page.getByText(mockVideo.filename).first()).toBeVisible();
    await expect(page.getByText('AI 总结').first()).toBeVisible();
    await expect(page.getByText('AI 任务中心').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('video-player-ai-center-expanded.png');

    await page.getByTitle('收起 AI 任务中心').click();
    await expect(page.getByTitle('展开 AI 任务中心')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('video-player-ai-center-collapsed.png');
  });
});

test.describe('dark theme visual comparison', () => {
  test.skip(({ isMobile }) => isMobile, 'dark theme comparisons use desktop/narrow screenshots');

  for (const themeId of ['night', 'claude-ink', 'primer-dark', 'antigravity-dark', 'blue-night']) {
    test(`${themeId} settings and video pages stay readable`, async ({ page }) => {
      await prepareApp(page, '/#/settings');
      await applyThemePreset(page, themeId);
      await expect(page.getByText('设置').first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expect(page.locator('main.app-main')).toHaveScreenshot(`dark-${themeId}-settings.png`);

      await page.goto('/#/video');
      await page.waitForLoadState('networkidle');
      await applyThemePreset(page, themeId);
      await expect(page.getByText('IT视频站').first()).toBeVisible();
      await expect(page.locator('.video-card-grid').first()).toBeVisible({ timeout: 10_000 });
      await expectNoHorizontalOverflow(page);
      await expect(page.locator('main.app-main')).toHaveScreenshot(`dark-${themeId}-video.png`);
    });

    test(`${themeId} pomodoro surfaces use theme accent`, async ({ page }) => {
      await prepareApp(page, '/#/pomodoro');
      await applyThemePreset(page, themeId);
      await page.locator('main.app-main').getByRole('button', { name: '参数' }).click();
      await expect(page.getByText('专注参数')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expect(page).toHaveScreenshot(`dark-${themeId}-pomodoro-running.png`, { fullPage: true });
    });
  }
});

test.describe('mobile layout regression', () => {
  test('mobile settings and video pages avoid horizontal overflow', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile layout is covered by the mobile project');

    await prepareApp(page, '/#/settings');
    await expect(page.getByText('设置').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main')).toHaveScreenshot('mobile-settings.png');

    await page.goto('/#/video');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('IT视频站').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main')).toHaveScreenshot('mobile-video-list.png');
  });
});
