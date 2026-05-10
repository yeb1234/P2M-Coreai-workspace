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

export function generateThemeCss(themeId: string, vars: ThemeVars): string {
  const lines = [
    '/*',
    `  P2M 主题样式：${themeId}`,
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
    '/* 通用主题表面，用来覆盖 Tailwind 写死的颜色 */',
    '.theme-surface {',
    '  background: var(--bg-card);',
    '  border-color: var(--border-light);',
    '  color: var(--text-primary);',
    '  box-shadow: var(--shadow-card);',
    '}',
    '',
    '.theme-elevated {',
    '  background: var(--bg-elevated);',
    '  border-color: var(--border-light);',
    '  color: var(--text-primary);',
    '}',
    '',
    '.theme-accent-soft {',
    '  background: var(--accent-bg);',
    '  color: var(--accent);',
    '  border-color: color-mix(in srgb, var(--accent) 35%, var(--border-light));',
    '}',
    '',
    '.theme-success-soft {',
    '  background: color-mix(in srgb, var(--success) 14%, transparent);',
    '  border: 1px solid color-mix(in srgb, var(--success) 42%, var(--border-light));',
    '  color: var(--success);',
    '}',
    '',
    '.theme-danger-button {',
    '  background: color-mix(in srgb, var(--danger) 12%, transparent);',
    '  border: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);',
    '  color: var(--danger);',
    '}',
    '',
    '.theme-danger-button:hover {',
    '  background: color-mix(in srgb, var(--danger) 20%, transparent);',
    '}',
    '',
    '/* 表单和按钮 */',
    'input, textarea, select {',
    '  background: var(--bg-elevated);',
    '  border-color: var(--border-light);',
    '  color: var(--text-primary);',
    '}',
    '',
    'input::placeholder, textarea::placeholder {',
    '  color: var(--text-muted);',
    '}',
    '',
    'input:focus, textarea:focus, select:focus {',
    '  border-color: var(--accent);',
    '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);',
    '}',
    '',
    'button.primary, .theme-primary-button {',
    '  background: var(--accent);',
    '  color: #fff;',
    '}',
    '',
    'button.primary:hover, .theme-primary-button:hover {',
    '  background: var(--accent-hover);',
    '}',
    '',
    '/* 视频站和 AI 任务中心 */',
    '.video-page-shell, .video-list-shell, .ai-job-center {',
    '  background: var(--bg-base);',
    '  color: var(--text-primary);',
    '}',
    '',
    '.video-card, .video-playlist-item, .ai-job-card {',
    '  background: var(--bg-card);',
    '  border: 1px solid var(--border-light);',
    '  color: var(--text-primary);',
    '}',
    '',
    '.video-card:hover, .video-playlist-item:hover {',
    '  border-color: var(--accent);',
    '  background: var(--bg-accent);',
    '}',
    '',
    '.video-progress, .batch-progress {',
    '  background: var(--accent);',
    '}',
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
    id: 'night',
    name: '夜间模式',
    description: '烟灰橙黑主题，避免纯黑刺眼，同时保留清晰层级和高可读性。',
    vars: {
      '--bg-body': '#121212',
      '--bg-base': '#181512',
      '--bg-card': '#211d18',
      '--bg-elevated': '#2b261f',
      '--bg-accent': '#3a2816',
      '--text-primary': '#f2eee8',
      '--text-secondary': '#d6c9ba',
      '--text-muted': '#b8a998',
      '--border-light': '#4b4034',
      '--border-medium': '#6a5947',
      '--accent': '#f59e0b',
      '--accent-hover': '#fbbf24',
      '--accent-bg': '#3a2816',
      '--paper-bg': '#211d18',
      '--scrollbar-thumb': '#6a5947',
      '--scrollbar-hover': '#8a735c',
      '--header-bg': 'rgba(24, 21, 18, 0.96)',
      '--sidebar-bg': 'rgba(18, 18, 18, 0.96)',
      '--success': '#7bd88f',
      '--danger': '#ff8a80',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.05), 0 12px 28px rgba(0,0,0,0.30)',
    },
  },
  {
    id: 'blue-night',
    name: '蓝夜模式',
    description: '蓝灰深色背景，偏冷色调，保留夜间模式的对比度和层级。',
    vars: {
      '--bg-body': '#0d1320',
      '--bg-base': '#111827',
      '--bg-card': '#172033',
      '--bg-elevated': '#1f2a40',
      '--bg-accent': '#17325a',
      '--text-primary': '#eef6ff',
      '--text-secondary': '#c6d7ee',
      '--text-muted': '#96abc6',
      '--border-light': '#314057',
      '--border-medium': '#485b78',
      '--accent': '#60a5fa',
      '--accent-hover': '#93c5fd',
      '--accent-bg': '#17325a',
      '--paper-bg': '#172033',
      '--scrollbar-thumb': '#485b78',
      '--scrollbar-hover': '#647b9d',
      '--header-bg': 'rgba(17, 24, 39, 0.96)',
      '--sidebar-bg': 'rgba(13, 19, 32, 0.96)',
      '--success': '#74d99f',
      '--danger': '#ff8f99',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.055), 0 12px 28px rgba(0,0,0,0.32)',
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
