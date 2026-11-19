import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_TEMPLATES, detectIntent } from '../../prompts/clientPrompts';
import { canShowChatVideoReferences } from '../config/features';

describe('聊天意图识别', () => {
  const cases: Array<[string, string | null]> = [
    ['有没有适合AI产品开发的课程', 'course-recommend'],
    ['推荐几个讲 FastAPI 的视频', 'course-recommend'],
    ['哪个视频讲过依赖注入', 'course-recommend'],
    ['我接下来该怎么学', 'learning-path'],
    ['给我一个学习路径', 'learning-path'],
    ['帮我总结一下这节课', 'study-summary'],
    ['回顾一下刚才讲的内容', 'study-summary'],
    // 「学得怎么样」这类口语问法必须归到总结，不能兜底成知识问答 ——
    // 否则会触发相关片段检索，甩出三条不相关视频
    ['总结我学得怎么样', 'study-summary'],
    ['我这段时间学得如何', 'study-summary'],
    ['看看我的学习进展', 'study-summary'],
    ['最近学习情况怎么样', 'study-summary'],
    ['这段代码为什么报错', 'coding-helper'],
    ['写个 FastAPI 接口', 'coding-helper'],
    ['把目标拆成今日待办', 'task-planning'],
    // 笔记写操作：保存原文 / 总结后另存，不能被普通总结或兜底意图吃掉
    ['把刚才的笔记保存一下', 'note-save'],
    ['总结这篇笔记然后保存', 'note-save'],
    ['帮我总结后存到笔记里', 'note-save'],
    // 具体的代码/技术概念题走「问题解答」，不再走只依据视频库的知识问答
    ['Python的装饰器是什么', 'question-answer'],
    ['这个函数是什么原理', 'question-answer'],
    ['FastAPI 怎么用', 'question-answer'],
    ['什么是GC算法', 'question-answer'],
    // 明确在找站内视频/课程时，仍然交给库内问答或课程推荐
    ['讲过 watch_events 吗', 'knowledge-qa'],
    ['有没有好的视频推荐', 'course-recommend'],
    ['你好', null],
    ['', null],
  ];

  for (const [input, expected] of cases) {
    it(`「${input || '(空)'}」→ ${expected ?? '不识别'}`, () => {
      expect(detectIntent(input)).toBe(expected);
    });
  }

  it('识别出的意图都有对应模板', () => {
    const ids = new Set(DEFAULT_PROMPT_TEMPLATES.map((t) => t.id));
    for (const [input, expected] of cases) {
      if (expected) {
        expect(ids.has(expected), `${input} → ${expected} 没有对应模板`).toBe(true);
      }
    }
  });

  it('相关视频卡片只在问题解答/面试题讲解意图下显示', () => {
    expect(canShowChatVideoReferences('question-answer')).toBe(true);
    expect(canShowChatVideoReferences('interview-question')).toBe(true);
    expect(canShowChatVideoReferences('course-recommend')).toBe(false);
    expect(canShowChatVideoReferences('knowledge-qa')).toBe(false);
    expect(canShowChatVideoReferences('coding-helper')).toBe(false);
    expect(canShowChatVideoReferences(null)).toBe(false);
  });

  it('面试题库页上的短追问走面试题讲解，不抢路径规划', () => {
    expect(detectIntent('这题怎么答', 'interview')).toBe('interview-question');
    expect(detectIntent('展开讲讲', 'interview')).toBe('interview-question');
    expect(detectIntent('推荐相关视频', 'interview')).toBe('interview-question');
    expect(detectIntent('继续', 'interview')).toBe('interview-question');
    expect(detectIntent('我想知道下一步怎么学', 'interview')).toBe('learning-path');
    expect(detectIntent('把这篇笔记保存一下', 'interview')).toBe('note-save');
    // 非面试页上同样的「继续」不能误判
    expect(detectIntent('继续', 'video')).toBeNull();
  });
});
