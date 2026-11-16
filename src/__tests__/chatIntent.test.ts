import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_TEMPLATES, detectIntent } from '../../prompts/clientPrompts';

describe('聊天意图识别', () => {
  const cases: Array<[string, string | null]> = [
    ['有没有适合AI产品开发的课程', 'course-recommend'],
    ['推荐几个讲 FastAPI 的视频', 'course-recommend'],
    ['哪个视频讲过依赖注入', 'course-recommend'],
    ['我接下来该怎么学', 'learning-path'],
    ['给我一个学习路径', 'learning-path'],
    ['帮我总结一下这节课', 'study-summary'],
    ['回顾一下刚才讲的内容', 'study-summary'],
    ['这段代码为什么报错', 'coding-helper'],
    ['写个 FastAPI 接口', 'coding-helper'],
    ['把目标拆成今日待办', 'task-planning'],
    ['讲过 watch_events 吗', 'knowledge-qa'],
    ['这个函数是什么原理', 'knowledge-qa'],
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
});
