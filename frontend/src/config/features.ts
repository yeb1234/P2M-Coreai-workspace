/**
 * 功能开关。
 *
 * 这里的开关只决定「显不显示」，不删代码：组件、接口、后端返回都还在，
 * 想恢复把值改回 true、重新构建即可。
 */

import { IS_LITE } from './appProfile';

type FeatureFlags = {
  /** 回答下方的「相关片段」卡片。 */
  chatVideoReferences: boolean;
};

export const FEATURES: FeatureFlags = {
  /**
   * 2026-11-17：重新打开，但只在「问题解答」意图下渲染。
   *
   * 背景：正文里的《视频标题》已经自带可点链接，全局挂卡片偏重；
   * 但用户问代码/技术概念时，回答本身来自通用知识，底部一组
   * 站内视频卡片正好作为「想继续看」的延伸入口。其他意图仍然隐藏。
   */
  chatVideoReferences: !IS_LITE,
};

/** 相关视频卡片只属于「问题解答」和明确要视频的「面试题讲解」。 */
export function canShowChatVideoReferences(intent?: string | null): boolean {
  return FEATURES.chatVideoReferences && (intent === 'question-answer' || intent === 'interview-question');
}
