/** 产品形态：full = P2 Media / Transcribe；lite = P2 Lite 云 demo。 */
export type AppProfile = 'full' | 'lite';

const rawProfile = String(import.meta.env.VITE_APP_PROFILE || 'full').trim().toLowerCase();

export const APP_PROFILE: AppProfile = rawProfile === 'lite' ? 'lite' : 'full';
export const IS_LITE = APP_PROFILE === 'lite';

/**
 * Lite 不注册视频、学习路径、学习轨迹、书签和开发中占位页。
 * 保留 Agent、面试题学习、笔记、待办、日历与设置。
 */
export const LITE_HIDDEN_VIEWS = new Set<string>([
  'video',
  'learning',
  'journey',
  'bookmarks',
  'health',
  'compare',
  'shop',
  'esports',
  'reader',
  'snippets',
  'habits',
  'flashcards',
  'tokens',
  'leetcode',
  'codenav',
  'openclaw',
  'hermes',
]);

/**
 * 只在 Lite 出现的产品演示页。
 *
 * 这些页面展示 P2 Media / Transcribe 的界面与能力说明，数据是静态样例，
 * 不向 Lite 后端申请视频、转写或向量能力。完整版已有真实页面，不能重复挂
 * 一份“演示入口”去稀释主站导航。
 */
export const LITE_ONLY_VIEWS = new Set<string>([
  'videopreview',
  'media',
  'transcribe',
]);

export function isPageEnabled(id: string): boolean {
  if (IS_LITE) return !LITE_HIDDEN_VIEWS.has(id);
  return !LITE_ONLY_VIEWS.has(id);
}
