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
  '--bg-body': '最外层背景。主要影响应用框架外侧、木质边框背后的大底色。',
  '--bg-base': '主工作区背景。影响页面主体、路由内容区、三栏布局的大面积底色。',
  '--bg-card': '默认卡片面。影响插件卡片、设置面板、视频信息卡、列表项、弹窗、表单容器。',
  '--bg-elevated': '抬高一级的表面。影响工具条、二级卡片、输入框、轻量面板、悬浮菜单。',
  '--bg-accent': '弱强调背景。影响选中项、筛选器、标签、当前播放项、浅色提示块。',
  '--text-primary': '主文字。标题、正文、列表主文本都依赖它，必须和 --bg-card 有足够对比度。',
  '--text-secondary': '次级文字。说明、表单标签、按钮次级状态、侧栏普通文字。',
  '--text-muted': '弱文字。时间、占位提示、空状态、禁用提示、历史数据说明。',
  '--border-light': '默认细边框。影响卡片、输入框、表格、日历格子、视频右侧栏分隔线。',
  '--border-medium': '更明显的边框。影响 hover 边框、拖拽宽度手柄、强调分割线。',
  '--accent': '主强调色。影响主按钮、当前选中、进度条、焦点环、链接和重要图标。',
  '--accent-hover': '主强调色悬停/按下状态。建议比 --accent 略深或略亮。',
  '--accent-bg': '强调色浅背景。影响选中标签、提示块、当前项目背景；深色主题不要用纯白。',
  '--paper-bg': '纸面/内容板背景。影响带 paper-surface 的插件和日历区域。',
  '--scrollbar-thumb': '滚动条滑块颜色。',
  '--scrollbar-hover': '滚动条滑块悬停颜色。',
  '--header-bg': '顶部栏背景，通常带透明度。',
  '--sidebar-bg': '左侧栏背景，通常带透明度。',
  '--success': '成功色。影响已完成、连接成功、正向统计。',
  '--danger': '危险色。影响删除、清空、失败、警告按钮。',
  '--shadow-card': '卡片阴影。深色主题建议使用低透明黑影和细微高光，不要太重。',
};

export function generateThemeCss(themeId: string, vars: ThemeVars): string {
  const lines = [
    '/*',
    `  P2M 主题导出：${themeId}`,
    '',
    '  这个文件是“可改说明书”，不是必须完整复制进项目。',
    '  你最常改的是下面 :root 里的变量；后面的语义类和深色兜底用于解释这些变量会控制哪里。',
    '',
    '  快速改色建议：',
    '  1. 先改 --bg-body / --bg-base / --bg-card，确定整体明暗和层次。',
    '  2. 再改 --text-primary / --text-secondary / --text-muted，保证文字清楚。',
    '  3. 最后改 --accent / --accent-bg / --success / --danger，统一按钮、进度条、状态色。',
    '  4. 深色主题不要让 --bg-card 或 --accent-bg 接近纯白，否则会出现刺眼白块。',
    '*/',
    '',
    '/*',
    '  区域映射：',
    '  - 应用外框与页面底色：--bg-body、--bg-base',
    '  - 顶部栏/左侧栏：--header-bg、--sidebar-bg、--border-light',
    '  - 工作台插件卡片：--bg-card、--bg-elevated、--border-light、--shadow-card',
    '  - 设置页/表单/弹窗：--bg-card、--bg-elevated、--text-primary、--border-light',
    '  - 待办、日历、笔记、视频列表：--bg-card、--bg-accent、--accent、--success、--danger',
    '  - 视频播放器外层、右侧列表、AI 总结：--bg-card、--bg-elevated、--border-medium',
    '  - 进度条、选中态、主按钮、焦点环：--accent、--accent-hover、--accent-bg',
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
    '  语义类：项目里逐步用这些类替代硬编码 Tailwind 颜色。',
    '  如果某个页面出现“突然冒出来一块亮色/黑色”，优先看它有没有使用这些类，',
    '  或者有没有硬编码 bg-[#faf9f7]、bg-white、text-[#1a1a1a] 之类颜色。',
    '*/',
    '.theme-surface {',
    '  background: var(--bg-card);',
    '  border-color: var(--border-light);',
    '  color: var(--text-primary);',
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
    '/* 成功/危险状态：用于已完成、失败、删除、清空等操作。 */',
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
    '/* 表单：输入框、选择框、文本域都会吃这些颜色。 */',
    'input, textarea, select {',
    '  background: var(--bg-elevated);',
    '  border-color: var(--border-light);',
    '  color: var(--text-primary);',
    '}',
    '',
    'input:focus, textarea:focus, select:focus {',
    '  border-color: var(--accent);',
    '  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);',
    '}',
    '',
    '/*',
    '  深色主题兜底示例：',
    '  老页面里仍有一些硬编码浅色，例如 bg-white、bg-[#eff6ff]、bg-[#dcfce7]。',
    '  下面这些规则负责把它们压回当前主题色，避免深色模式出现刺眼白块。',
    '  如果你做的是浅色主题，可以删掉这段；如果是深色主题，建议保留并按你的配色微调。',
    '*/',
    '[data-theme="night"] [class*="bg-white"],',
    '[data-theme="night"] [class*="bg-[#faf9f7"],',
    '[data-theme="night"] [class*="bg-[#f3f2ef"],',
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
    ''
  );

  return lines.join('\n');
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'warm-wood',
    name: '暖木经典',
    description: '温暖木质纹理，经典风格',
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
    description: '深邃星空暗色主题，护眼舒适',
    vars: {
      '--bg-body': '#101722',
      '--bg-base': '#151f2e',
      '--bg-card': '#1b2636',
      '--bg-elevated': '#202d41',
      '--bg-accent': '#243046',
      '--text-primary': '#e8eef7',
      '--text-secondary': '#a7b3c5',
      '--text-muted': '#7f8ea3',
      '--border-light': '#2f4055',
      '--border-medium': '#445870',
      '--accent': '#d69b55',
      '--accent-hover': '#c8873f',
      '--accent-bg': '#33291f',
      '--paper-bg': '#182233',
      '--scrollbar-thumb': '#3f5068',
      '--scrollbar-hover': '#586b85',
      '--header-bg': 'rgba(15, 22, 33, 0.96)',
      '--sidebar-bg': 'rgba(15, 22, 33, 0.96)',
      '--success': '#6dd79a',
      '--danger': '#f38b8f',
      '--shadow-card': '0 1px 0 rgba(255,255,255,0.03), 0 8px 24px rgba(0,0,0,0.18)',
    },
  },
  {
    id: 'corporate',
    name: '公司简约',
    description: '扁平白色底，蓝色线条，高效办公',
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
    description: '沉稳英式绿，优雅内敛',
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
    description: '优雅紫色调，温柔沉静',
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
