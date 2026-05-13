export interface ThemeVars {
  '--bg-body': string;
  '--bg-base': string;
  '--bg-card': string;
  '--bg-elevated': string;
  '--bg-accent': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--border-light': string;
  '--border-medium': string;
  '--accent': string;
  '--accent-hover': string;
  '--accent-bg': string;
  '--paper-bg': string;
  '--scrollbar-thumb': string;
  '--scrollbar-hover': string;
  '--header-bg': string;
  '--sidebar-bg': string;
  '--success': string;
  '--danger': string;
  '--shadow-card': string;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  vars: ThemeVars;
}

export const BUILT_IN_THEME_IDS = new Set(['warm-wood', 'morning', 'corporate', 'meadow', 'lavender', 'night']);

export function themeGroupLabel(themeId: string): string {
  return BUILT_IN_THEME_IDS.has(themeId) ? '主题风格' : '自定义风格';
}

export function isThemeVars(value: unknown): value is ThemeVars {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return THEME_VAR_KEYS.every((key) => typeof candidate[key] === 'string' && candidate[key].trim().length > 0);
}

export function normalizeThemeVars(value: Partial<ThemeVars>): ThemeVars | null {
  const fallback = THEME_PRESETS[0].vars;
  const normalized = {} as ThemeVars;
  for (const key of THEME_VAR_KEYS) {
    const raw = value[key];
    normalized[key] = typeof raw === 'string' && raw.trim() ? raw.trim() : fallback[key];
  }
  return isThemeVars(normalized) ? normalized : null;
}

// CSS imports may omit optional variables, but must include core colors so normal CSS is not mistaken for a theme.
export function parseThemeVarsText(text: string): ThemeVars | null {
  const input = text.trim();
  if (!input) return null;

  try {
    const parsed = JSON.parse(input) as unknown;
    if (isThemeVars(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && 'vars' in parsed && isThemeVars((parsed as { vars?: unknown }).vars)) {
      return (parsed as { vars: ThemeVars }).vars;
    }
  } catch {
    // Continue to CSS parsing.
  }

  const cssMatches = [...input.matchAll(/(--[a-z-]+)\s*:\s*([^;{}]+);/gi)];
  if (cssMatches.length === 0) return null;

  const extracted: Partial<ThemeVars> = {};
  for (const match of cssMatches) {
    const key = match[1] as keyof ThemeVars;
    if (THEME_VAR_KEYS.includes(key)) {
      extracted[key] = match[2].trim();
    }
  }

  if (!REQUIRED_IMPORTED_CSS_KEYS.every((key) => extracted[key])) return null;

  return normalizeThemeVars(extracted);
}

export const THEME_VAR_COMMENTS: Record<keyof ThemeVars, string> = {
  '--bg-body': '最外层背景。影响应用框架外侧和页面大底色。',
  '--bg-base': '主工作区背景。影响页面主体、路由内容区和三栏布局的大面积底色。',
  '--bg-card': '默认卡片面。影响插件卡片、设置面板、视频信息卡、列表项、弹窗和表单容器。',
  '--bg-elevated': '抬高一级的表面。影响工具条、二级卡片、输入框、轻量面板和悬浮菜单。',
  '--bg-accent': '弱强调背景。影响选中项、筛选器、标签、当前播放项和浅色提示块。',
  '--text-primary': '主文字。标题、正文和列表主文本都依赖它，必须和卡片背景有足够对比度。',
  '--text-secondary': '次级文字。说明、表单标签、按钮次级状态和侧栏普通文字。',
  '--text-muted': '弱文字。时间、占位提示、空状态、禁用提示和历史数据说明。',
  '--border-light': '默认细边框。影响卡片、输入框、表格、日历格子和右侧栏分隔线。',
  '--border-medium': '更明显的边框。影响 hover 边框、拖拽宽度手柄和强调分割线。',
  '--accent': '主强调色。影响主按钮、当前选中、进度条、焦点环、链接和重要图标。',
  '--accent-hover': '主强调色悬停/按下状态。建议比主强调色略深或略亮。',
  '--accent-bg': '强调色浅背景。影响选中标签、提示块和当前项目背景；深色主题不要用纯白。',
  '--paper-bg': '纸面/内容板背景。影响带 paper-surface 的插件和日历区域。',
  '--scrollbar-thumb': '滚动条滑块颜色。',
  '--scrollbar-hover': '滚动条滑块悬停颜色。',
  '--header-bg': '顶部栏背景，通常带透明度。',
  '--sidebar-bg': '左侧栏背景，通常带透明度。',
  '--success': '成功色。影响已完成、连接成功和正向统计。',
  '--danger': '危险色。影响删除、清空、失败和警告按钮。',
  '--shadow-card': '卡片阴影。深色主题建议低透明黑影加细微高光，不要太重。',
};

export const THEME_VAR_KEYS = Object.keys(THEME_VAR_COMMENTS) as Array<keyof ThemeVars>;
const REQUIRED_IMPORTED_CSS_KEYS: Array<keyof ThemeVars> = ['--bg-body', '--bg-base', '--bg-card', '--text-primary', '--accent'];

export function generateThemeCss(themeId: string, vars: ThemeVars): string {
  const preset = THEME_PRESETS.find((theme) => theme.id === themeId);
  const preview = [
    `分组：${themeGroupLabel(themeId)}`,
    `名称：${preset?.name ?? themeId}`,
    `说明：${preset?.description ?? '自定义主题'}`,
    `预览：页面 ${vars['--bg-base']} / 卡片 ${vars['--bg-card']} / 强调 ${vars['--accent']} / 主文字 ${vars['--text-primary']} / 边框 ${vars['--border-light']}`,
  ];
  const lines = [
    '/*',
    `  P2M 主题样式：${themeId}`,
    '',
    ...preview.map((line) => `  ${line}`),
    '',
    '  这个文件可以直接覆盖到 :root 里使用，也可以按需复制其中的变量。',
    '',
    '  修改建议：',
    '  1. 先调 --bg-body / --bg-base / --bg-card，确定整体明暗层级。',
    '  2. 再调 --text-primary / --text-secondary / --text-muted，保证可读性。',
    '  3. 最后调 --accent / --accent-bg / --success / --danger，统一交互反馈。',
    '  4. 深色主题请避免突然出现纯白卡片，优先同步 --bg-card 和 --bg-elevated。',
    '*/',
    '',
    ':root {',
  ];

  (Object.keys(THEME_VAR_COMMENTS) as Array<keyof ThemeVars>).forEach((key) => {
    lines.push(`  /* ${THEME_VAR_COMMENTS[key]} */`);
    lines.push(`  ${key}: ${vars[key]};`);
  });

  lines.push(
    '}',
    '',
    '/*',
    '  覆盖范围说明：',
    '  - 页面底色：--bg-body、--bg-base',
    '  - 顶栏/侧栏/边框：--header-bg、--sidebar-bg、--border-light',
    '  - 卡片、弹窗、AI 面板：--bg-card、--bg-elevated、--shadow-card',
    '  - 视频列表和 AI 任务中心：--bg-card、--bg-accent、--border-light、--accent',
    '  - 输入框和设置页：--bg-elevated、--border-light、--text-primary、--accent',
    '  - 主按钮和进度条：--accent、--accent-hover、--accent-bg',
    '  - 成功/危险/失败/清空：--success、--danger',
    '*/',
    '',
    '',
    '/*',
    '  运行时工具类不随主题导出。',
    '  theme-card/theme-surface 等通用类保留在 src/index.css，导出的文件只负责变量和值，方便手工编辑和导入。',
    '*/',
    '',
    '/* 深色主题兜底，处理旧页面里写死的浅色背景 */',
    '[data-theme="night"] [class*="bg-white"],',
    '[data-theme="night"] [class*="bg-[#faf9f7"],',
    '[data-theme="night"] [class*="bg-[#f3f2ef"],',
    '[data-theme="night"] [class*="bg-[#fff7ed"],',
    '[data-theme="night"] [class*="bg-[#fef7ed"] {',
    '  background-color: var(--bg-card) !important;',
    '}',
    '',
    '[data-theme="night"] [class*="bg-[#eff6ff"],',
    '[data-theme="night"] [class*="bg-[#dcfce7"],',
    '[data-theme="night"] [class*="bg-[#fef2f2"] {',
    '  background-color: var(--bg-accent) !important;',
    '}',
    '',
    '[data-theme="night"] [class*="text-[#1a1a1a"] {',
    '  color: var(--text-primary) !important;',
    '}',
    '',
    '[data-theme="night"] [class*="text-[#6b7280"],',
    '[data-theme="night"] [class*="text-[#9ca3af"] {',
    '  color: var(--text-secondary) !important;',
    '}',
    '',
    '[data-theme="night"] [class*="border-[#e5e2dd"],',
    '[data-theme="night"] [class*="border-[#d1cdc6"] {',
    '  border-color: var(--border-light) !important;',
    '}',
    '',
    '/*',
    '  排查提示：',
    '  - 看到亮白块，优先搜索 bg-white、bg-[#faf9f7]、bg-[#f3f2ef]。',
    '  - 文字看不清，优先调整 --text-primary 和 --text-secondary。',
    '  - 分割线太硬，降低 --border-medium 或改用 --border-light。',
    '  - 选中态太刺眼，调低 --accent 或加深 --accent-bg。',
    '*/',
    ''
  );

  return lines.join('\n');
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'warm-wood',
    name: '暖木经典',
    description: '温暖木质纹理，经典风格。',
    vars: {
      '--bg-body': '#e8e4df',
      '--bg-base': '#f7f5f2',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#faf9f7',
      '--bg-accent': '#fef7ed',
      '--text-primary': '#1a1a1a',
      '--text-secondary': '#6b7280',
      '--text-muted': '#9ca3af',
      '--border-light': '#e5e2dd',
      '--border-medium': '#d1cdc6',
      '--accent': '#c87d2f',
      '--accent-hover': '#b06d20',
      '--accent-bg': '#fef7ed',
      '--paper-bg': '#faf9f7',
      '--scrollbar-thumb': '#d1cdc6',
      '--scrollbar-hover': '#b8b4ac',
      '--header-bg': 'rgba(250, 249, 247, 0.8)',
      '--sidebar-bg': 'rgba(250, 249, 247, 0.9)',
      '--success': '#16a34a',
      '--danger': '#dc3545',
      '--shadow-card': '1px 1px 0px rgba(232, 212, 160, 0.06)',
    },
  },
  {
    id: 'claude-paper',
    name: '木棉纸白',
    description: '暖纸、陶土橙、柔和棕灰，偏 Claude 的克制书写感。',
    vars: {
      '--bg-body': '#e7dccf',
      '--bg-base': '#f4eadc',
      '--bg-card': '#fffaf1',
      '--bg-elevated': '#eadcc9',
      '--bg-accent': '#f9dfcf',
      '--text-primary': '#2d2118',
      '--text-secondary': '#715948',
      '--text-muted': '#a68f7d',
      '--border-light': '#d8c4ad',
      '--border-medium': '#b99b80',
      '--accent': '#b75c3a',
      '--accent-hover': '#93472d',
      '--accent-bg': '#f9dfcf',
      '--paper-bg': '#fffaf1',
      '--scrollbar-thumb': '#b99b80',
      '--scrollbar-hover': '#98775f',
      '--header-bg': 'rgba(255, 250, 241, 0.92)',
      '--sidebar-bg': 'rgba(244, 234, 220, 0.94)',
      '--success': '#2f8f5b',
      '--danger': '#c2413a',
      '--shadow-card': '0 2px 10px rgba(92, 64, 38, 0.09)',
    },
  },
  {
    id: 'primer-light',
    name: 'Primer 云白',
    description: 'GitHub Primer 风格的干净白底，适合列表和代码信息密集页面。',
    vars: {
      '--bg-body': '#f6f8fa',
      '--bg-base': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#f6f8fa',
      '--bg-accent': '#ddf4ff',
      '--text-primary': '#1f2328',
      '--text-secondary': '#57606a',
      '--text-muted': '#8c959f',
      '--border-light': '#d0d7de',
      '--border-medium': '#afb8c1',
      '--accent': '#0969da',
      '--accent-hover': '#0550ae',
      '--accent-bg': '#ddf4ff',
      '--paper-bg': '#ffffff',
      '--scrollbar-thumb': '#d0d7de',
      '--scrollbar-hover': '#afb8c1',
      '--header-bg': 'rgba(255, 255, 255, 0.96)',
      '--sidebar-bg': 'rgba(246, 248, 250, 0.96)',
      '--success': '#1a7f37',
      '--danger': '#cf222e',
      '--shadow-card': '0 1px 3px rgba(31,35,40,0.08)',
    },
  },
  {
    id: 'editor-light',
    name: '编辑器冰蓝',
    description: '浅蓝灰编辑器面板，紫蓝强调，和暖纸/云白明显区分。',
    vars: {
      '--bg-body': '#dfe8f5',
      '--bg-base': '#eef5ff',
      '--bg-card': '#f8fbff',
      '--bg-elevated': '#e4eefb',
      '--bg-accent': '#e8e6ff',
      '--text-primary': '#18233d',
      '--text-secondary': '#4e5f7a',
      '--text-muted': '#8798b3',
      '--border-light': '#c8d8ef',
      '--border-medium': '#9fb8d8',
      '--accent': '#6257d8',
      '--accent-hover': '#4d43b8',
      '--accent-bg': '#e8e6ff',
      '--paper-bg': '#f8fbff',
      '--scrollbar-thumb': '#9fb8d8',
      '--scrollbar-hover': '#7696bd',
      '--header-bg': 'rgba(238, 245, 255, 0.94)',
      '--sidebar-bg': 'rgba(228, 238, 251, 0.96)',
      '--success': '#168a4a',
      '--danger': '#d13438',
      '--shadow-card': '0 2px 8px rgba(42, 78, 128, 0.09)',
    },
  },
  {
    id: 'morning',
    name: '晨光浅色',
    description: '清爽晨光色，浅底低噪，适合白天长时间使用。',
    vars: {
      '--bg-body': '#edf3f5',
      '--bg-base': '#f8fbfb',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#f2f7f7',
      '--bg-accent': '#eef7f3',
      '--text-primary': '#1c2a2d',
      '--text-secondary': '#52686d',
      '--text-muted': '#8aa0a5',
      '--border-light': '#dce8e8',
      '--border-medium': '#bfd1d2',
      '--accent': '#0f8f78',
      '--accent-hover': '#0b6f5f',
      '--accent-bg': '#e8f7f3',
      '--paper-bg': '#f8fbfb',
      '--scrollbar-thumb': '#bfd1d2',
      '--scrollbar-hover': '#91aaad',
      '--header-bg': 'rgba(248, 251, 251, 0.92)',
      '--sidebar-bg': 'rgba(248, 251, 251, 0.94)',
      '--success': '#16a34a',
      '--danger': '#dc2626',
      '--shadow-card': '0 2px 8px rgba(15, 143, 120, 0.07)',
    },
  },
  {
    id: 'corporate',
    name: '公司简约',
    description: '扁平白色底，蓝色线条，高效办公。',
    vars: {
      '--bg-body': '#f8fafc',
      '--bg-base': '#ffffff',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#f8fafc',
      '--bg-accent': '#eff6ff',
      '--text-primary': '#0f172a',
      '--text-secondary': '#475569',
      '--text-muted': '#94a3b8',
      '--border-light': '#e2e8f0',
      '--border-medium': '#cbd5e1',
      '--accent': '#2563eb',
      '--accent-hover': '#1d4ed8',
      '--accent-bg': '#eff6ff',
      '--paper-bg': '#ffffff',
      '--scrollbar-thumb': '#cbd5e1',
      '--scrollbar-hover': '#94a3b8',
      '--header-bg': 'rgba(255, 255, 255, 0.98)',
      '--sidebar-bg': 'rgba(255, 255, 255, 0.98)',
      '--success': '#059669',
      '--danger': '#dc2626',
      '--shadow-card': '0 1px 3px rgba(0,0,0,0.06)',
    },
  },
  {
    id: 'meadow',
    name: '英伦绿',
    description: '沉稳英式绿，优雅内敛。',
    vars: {
      '--bg-body': '#f0f5f1',
      '--bg-base': '#f5f8f6',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#f5f8f6',
      '--bg-accent': '#edf3ef',
      '--text-primary': '#1b3c2b',
      '--text-secondary': '#4a6b5a',
      '--text-muted': '#7a9b8a',
      '--border-light': '#c8d8cb',
      '--border-medium': '#a3b8a8',
      '--accent': '#2d6a4f',
      '--accent-hover': '#1b4332',
      '--accent-bg': '#e6f0e8',
      '--paper-bg': '#f5f8f6',
      '--scrollbar-thumb': '#a3b8a8',
      '--scrollbar-hover': '#7a9b8a',
      '--header-bg': 'rgba(245, 248, 246, 0.92)',
      '--sidebar-bg': 'rgba(245, 248, 246, 0.92)',
      '--success': '#2d6a4f',
      '--danger': '#dc2626',
      '--shadow-card': '0 2px 6px rgba(45, 106, 79, 0.08)',
    },
  },
  {
    id: 'lavender',
    name: '薰衣草',
    description: '优雅紫色调，温柔沉静。',
    vars: {
      '--bg-body': '#ede9fe',
      '--bg-base': '#f5f3ff',
      '--bg-card': '#ffffff',
      '--bg-elevated': '#f5f3ff',
      '--bg-accent': '#f3e8ff',
      '--text-primary': '#2e1065',
      '--text-secondary': '#6b5b8a',
      '--text-muted': '#9b8bb8',
      '--border-light': '#e0d4f5',
      '--border-medium': '#c4b5e0',
      '--accent': '#7c3aed',
      '--accent-hover': '#6d28d9',
      '--accent-bg': '#ede9fe',
      '--paper-bg': '#f5f3ff',
      '--scrollbar-thumb': '#c4b5e0',
      '--scrollbar-hover': '#a78bfa',
      '--header-bg': 'rgba(245, 243, 255, 0.92)',
      '--sidebar-bg': 'rgba(245, 243, 255, 0.92)',
      '--success': '#16a34a',
      '--danger': '#dc2626',
      '--shadow-card': '0 2px 6px rgba(124, 58, 237, 0.08)',
    },
  },
  {
    id: 'night',
    name: '曜石暖橙',
    description: '烟灰橙黑主题，参考代码编辑器深色配色，层级清楚且不刺眼。',
    vars: {
      '--bg-body': '#1c1b19',
      '--bg-base': '#242320',
      '--bg-card': '#2f2c28',
      '--bg-elevated': '#3a362f',
      '--bg-accent': '#3a2b17',
      '--text-primary': '#f4efe7',
      '--text-secondary': '#cdbfad',
      '--text-muted': '#978979',
      '--border-light': '#454036',
      '--border-medium': '#5c5346',
      '--accent': '#d98a2b',
      '--accent-hover': '#f0a44a',
      '--accent-bg': '#3a2b17',
      '--paper-bg': '#2f2c28',
      '--scrollbar-thumb': '#5c5346',
      '--scrollbar-hover': '#786a5a',
      '--header-bg': 'rgba(36, 35, 32, 0.96)',
      '--sidebar-bg': 'rgba(28, 27, 25, 0.96)',
      '--success': '#7ccf8a',
      '--danger': '#ef8377',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.04), 0 12px 26px rgba(0,0,0,0.30)',
    },
  },
  {
    id: 'claude-ink',
    name: '墨陶深棕',
    description: '温暖陶棕深色，低对比书写感，和曜石暖橙拉开。',
    vars: {
      '--bg-body': '#2a201a',
      '--bg-base': '#352a24',
      '--bg-card': '#423631',
      '--bg-elevated': '#4e3f39',
      '--bg-accent': '#4a332b',
      '--text-primary': '#f1e5d7',
      '--text-secondary': '#c9b39f',
      '--text-muted': '#9b826f',
      '--border-light': '#5a4a42',
      '--border-medium': '#756055',
      '--accent': '#d28a67',
      '--accent-hover': '#eba582',
      '--accent-bg': '#4a332b',
      '--paper-bg': '#423631',
      '--scrollbar-thumb': '#756055',
      '--scrollbar-hover': '#8f7a6b',
      '--header-bg': 'rgba(53, 42, 36, 0.96)',
      '--sidebar-bg': 'rgba(42, 32, 26, 0.96)',
      '--success': '#94c983',
      '--danger': '#ec8b78',
      '--shadow-card': '0 1px 0 rgba(255,244,225,0.04), 0 12px 28px rgba(38,22,14,0.34)',
    },
  },
  {
    id: 'primer-dark',
    name: 'Primer 暗幕',
    description: 'GitHub 暗色工作台风格，蓝色强调，信息密度友好。',
    vars: {
      '--bg-body': '#131820',
      '--bg-base': '#1c2128',
      '--bg-card': '#252b34',
      '--bg-elevated': '#2e3640',
      '--bg-accent': '#1a3a5c',
      '--text-primary': '#f0f6fc',
      '--text-secondary': '#b9c4d0',
      '--text-muted': '#8a94a0',
      '--border-light': '#3a4550',
      '--border-medium': '#545f6b',
      '--accent': '#4f9cf9',
      '--accent-hover': '#75b7ff',
      '--accent-bg': '#1a3a5c',
      '--paper-bg': '#252b34',
      '--scrollbar-thumb': '#545f6b',
      '--scrollbar-hover': '#6e7a87',
      '--header-bg': 'rgba(28, 33, 40, 0.96)',
      '--sidebar-bg': 'rgba(19, 24, 32, 0.96)',
      '--success': '#7ee787',
      '--danger': '#ff7b72',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.045), 0 14px 30px rgba(0,0,0,0.36)',
    },
  },
  {
    id: 'antigravity-dark',
    name: '反重力紫夜',
    description: '偏 AI IDE 的深紫黑科技感，紫蓝高光但保持低噪。',
    vars: {
      '--bg-body': '#1e1b29',
      '--bg-base': '#262336',
      '--bg-card': '#312c42',
      '--bg-elevated': '#3c3650',
      '--bg-accent': '#3d3360',
      '--text-primary': '#f2efff',
      '--text-secondary': '#c6bedf',
      '--text-muted': '#9a91b8',
      '--border-light': '#423a56',
      '--border-medium': '#5c5275',
      '--accent': '#9b87f5',
      '--accent-hover': '#beb2ff',
      '--accent-bg': '#3d3360',
      '--paper-bg': '#312c42',
      '--scrollbar-thumb': '#5c5275',
      '--scrollbar-hover': '#786b94',
      '--header-bg': 'rgba(38, 35, 54, 0.96)',
      '--sidebar-bg': 'rgba(30, 27, 41, 0.96)',
      '--success': '#86efac',
      '--danger': '#fb7185',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.045), 0 14px 32px rgba(0,0,0,0.38)',
    },
  },
  {
    id: 'blue-night',
    name: '深夜蓝',
    description: '偏 VS Code / Night Owl 的冷色深夜主题，适合暗光环境。',
    vars: {
      '--bg-body': '#151d2e',
      '--bg-base': '#1c2539',
      '--bg-card': '#263248',
      '--bg-elevated': '#30405b',
      '--bg-accent': '#1e4470',
      '--text-primary': '#edf6ff',
      '--text-secondary': '#c2d3ea',
      '--text-muted': '#93a8c4',
      '--border-light': '#3a4f6e',
      '--border-medium': '#556b8f',
      '--accent': '#6ab7ff',
      '--accent-hover': '#9ad0ff',
      '--accent-bg': '#1e4470',
      '--paper-bg': '#263248',
      '--scrollbar-thumb': '#556b8f',
      '--scrollbar-hover': '#7088ab',
      '--header-bg': 'rgba(28, 37, 57, 0.96)',
      '--sidebar-bg': 'rgba(21, 29, 46, 0.96)',
      '--success': '#74d99f',
      '--danger': '#ff8f99',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.055), 0 12px 28px rgba(0,0,0,0.32)',
    },
  },
];

export function applyTheme(themeId: string, vars: ThemeVars) {
  const root = document.documentElement;
  root.setAttribute('data-theme', themeId);
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

export function resetTheme() {
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  const preset = THEME_PRESETS[0];
  Object.keys(preset.vars).forEach((key) => {
    root.style.removeProperty(key);
  });
}
