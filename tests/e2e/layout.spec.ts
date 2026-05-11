import { expect, test, type Page } from '@playwright/test';
import { THEME_PRESETS } from '../../src/lib/themes';

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
  await page.addInitScript(() => {
    window.localStorage.setItem('p2m-current-user', 'Playwright');
  });
  await page.goto(route);
  if (await page.getByRole('button', { name: '登录' }).isVisible().catch(() => false)) {
    await page.getByText('去注册').click();
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
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
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
    await expect(page.getByText('视频站').first()).toBeVisible();
    await expect(page.locator('.video-card-grid').first()).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('video-list-layout.png');
  });

  test('time center plugin fits desktop layout', async ({ page }) => {
    await prepareApp(page, '/#/timecenter');
    await expect(page.getByText('时间中心').first()).toBeVisible();
    await expect(page.getByText('时间任务表')).toBeVisible();
    await expect(page.getByText('统一管理计时、倒计时、闹钟与提醒')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main.app-main')).toHaveScreenshot('time-center-layout.png');
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
      await expect(page.getByText('视频站').first()).toBeVisible();
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
    await expect(page.getByText('视频站').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('main')).toHaveScreenshot('mobile-video-list.png');
  });
});
