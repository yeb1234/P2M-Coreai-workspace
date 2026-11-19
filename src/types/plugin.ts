import type { ComponentType, ReactNode } from 'react';

export type PluginSize = 'small' | 'large' | 'full';

export interface PluginMetadata {
  id: string;
  name: string;
  icon: ReactNode;
  description?: string;
  defaultPosition: number;
  color: string;
  defaultSize: PluginSize;
  summaryComponent: ComponentType;
}

/**
 * 工作台上的一个卡片插件。
 *
 * ## 为什么只有 metadata 了
 *
 * 原来还有 `panel: { component }` 和 `settings?: { component }`，
 * 5 个插件都把整页组件填进 panel —— 但**全项目零处读取**。
 *
 * 代价是实打实的：`registerAllPlugins()` 在 App.tsx 启动时执行，
 * 这几个静态 import 把 TodoPage / CalendarPage / PomodoroPage
 * 整个拉进主 bundle，而 `pageRegistry.tsx` 本来已经用 React.lazy
 * 把它们切出去了。两个设计互相抵消，懒加载等于白做。
 *
 * 真正被消费的只有 `metadata.summaryComponent`（PluginCard 渲染用）。
 */
export interface Plugin {
  metadata: PluginMetadata;
}
