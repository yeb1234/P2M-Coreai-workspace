import type { ActiveView } from '../stores/uiStore';

export type PluginStage = 'stable' | 'beta' | 'dev';

export interface PluginVersionMeta {
  version: string;
  updatedAt: string;
  group: '日常' | '学习' | '工具';
  stage: PluginStage;
  summary: string;
}

/**
 * 内部插件版本台账。
 *
 * 这里记录的是「页面插件」的版本，不是配置资产版本：
 * - 版本号随代码提交，发布时以这份台账为准；
 * - 不引入运行时安装/回滚，避免把前端模块变成不可复现的热插拔；
 * - 每改一个插件，同步 bump 版本、日期和一句话变更摘要。
 */
export const PLUGIN_VERSIONS: Record<ActiveView, PluginVersionMeta> = {
  dashboard: { version: '1.1.0', updatedAt: '2026-11-18', group: '日常', stage: 'stable', summary: '工作台聚合视图与今日概览' },
  todo: { version: '1.2.0', updatedAt: '2026-11-18', group: '日常', stage: 'stable', summary: '重复规则、日历联动与提醒回执' },
  calendar: { version: '1.1.0', updatedAt: '2026-11-17', group: '日常', stage: 'stable', summary: '月视图与待办/日程叠加' },
  calendar2: { version: '1.1.0', updatedAt: '2026-11-17', group: '日常', stage: 'stable', summary: '周视图拖拽排期' },
  notes: { version: '1.0.0', updatedAt: '2026-11-16', group: '日常', stage: 'stable', summary: '便签墙与颜色分组' },
  mdnotes: { version: '1.2.0', updatedAt: '2026-11-20', group: '日常', stage: 'stable', summary: '独立窗口、三栏拖拽、编辑/预览可折叠' },
  pomodoro: { version: '1.1.0', updatedAt: '2026-11-17', group: '日常', stage: 'stable', summary: '番茄计时与跨页保持' },
  timecenter: { version: '1.1.0', updatedAt: '2026-11-17', group: '日常', stage: 'stable', summary: '时间中心统一收口待办与日程' },
  video: { version: '1.1.0', updatedAt: '2026-11-18', group: '学习', stage: 'stable', summary: '视频检索、播放与转写入口' },
  learning: { version: '1.1.1', updatedAt: '2026-11-20', group: '学习', stage: 'stable', summary: '每日投入上限扩到 10 小时' },
  journey: { version: '1.0.0', updatedAt: '2026-11-16', group: '学习', stage: 'stable', summary: '学习轨迹与阶段复盘' },
  transcriber: { version: '1.1.1', updatedAt: '2026-11-20', group: '学习', stage: 'stable', summary: '单 worker 默认、自适应轮询与轻负载' },
  health: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: '健康记录占位页' },
  compare: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: '产品对比占位页' },
  shop: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: '电商中心占位页' },
  esports: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: '赛事数据占位页' },
  stats: { version: '1.0.0', updatedAt: '2026-11-17', group: '工具', stage: 'stable', summary: '待办/番茄/笔记统计' },
  reader: { version: '0.1.0', updatedAt: '2026-11-16', group: '学习', stage: 'dev', summary: '阅读器占位页' },
  snippets: { version: '0.1.0', updatedAt: '2026-11-16', group: '学习', stage: 'dev', summary: '代码片段占位页' },
  habits: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: '习惯追踪占位页' },
  flashcards: { version: '0.1.0', updatedAt: '2026-11-16', group: '学习', stage: 'dev', summary: '闪卡记忆占位页' },
  bookmarks: { version: '1.0.0', updatedAt: '2026-11-17', group: '学习', stage: 'stable', summary: '书签收藏与入口前移' },
  tokens: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: 'Token 用量占位页' },
  leetcode: { version: '0.1.0', updatedAt: '2026-11-16', group: '学习', stage: 'dev', summary: 'LeetCode 占位页' },
  interview: { version: '1.1.0', updatedAt: '2026-11-18', group: '学习', stage: 'stable', summary: '题库摘要、按题详情与模拟面试' },
  codenav: { version: '0.1.0', updatedAt: '2026-11-16', group: '学习', stage: 'dev', summary: '编程导航占位页' },
  aiagent: { version: '1.2.0', updatedAt: '2026-11-18', group: '工具', stage: 'stable', summary: '灵境小助手 SSE、页面上下文与 HITL' },
  openclaw: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: 'OpenClaw 占位页' },
  hermes: { version: '0.1.0', updatedAt: '2026-11-16', group: '工具', stage: 'dev', summary: 'Hermes 占位页' },
  settings: { version: '1.1.1', updatedAt: '2026-11-20', group: '工具', stage: 'stable', summary: '插件栏位置、插件版本台账与权限列' },
};

export const PLUGIN_STAGE_LABEL: Record<PluginStage, string> = {
  stable: '稳定',
  beta: '公测',
  dev: '开发中',
};

export function isPluginVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}
