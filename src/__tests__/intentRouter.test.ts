import { describe, expect, it } from 'vitest';
import { detectIntent, getTemplateIdForIntent } from '../lib/intentRouter';

const videoCtx = { kind: 'video' as const, label: '视频', promptContext: '' };
const noneCtx = { kind: 'none' as const, label: '无', promptContext: '' };
const notesCtx = { kind: 'notes' as const, label: '笔记', promptContext: '' };

const templates = [
  { id: 'video-search', name: '内容搜索' },
  { id: 'content-summary', name: '总结提炼' },
  { id: 'qa-question', name: '知识问答' },
  { id: 'learning-plan', name: '学习路线' },
];

describe('detectIntent', () => {
  describe('search', () => {
    it('explicit search keywords', () => {
      expect(detectIntent('搜Python', noneCtx).type).toBe('search');
      expect(detectIntent('帮我找电商网站的视频', noneCtx).type).toBe('search');
      expect(detectIntent('查找相关资料', noneCtx).type).toBe('search');
      expect(detectIntent('有没有AI教程', noneCtx).type).toBe('search');
    });
  });

  describe('summary', () => {
    it('summary keywords on video page', () => {
      expect(detectIntent('总结一下', videoCtx).type).toBe('summary');
      expect(detectIntent('提炼要点', videoCtx).type).toBe('summary');
      expect(detectIntent('复盘一下', videoCtx).type).toBe('summary');
      expect(detectIntent('讲讲这个视频', videoCtx).type).toBe('summary');
      expect(detectIntent('这里讲了什么', videoCtx).type).toBe('summary');
    });

    it('does NOT trigger on non-video pages', () => {
      expect(detectIntent('总结一下', noneCtx).type).not.toBe('summary');
      expect(detectIntent('总结一下', notesCtx).type).not.toBe('summary');
    });

    it('does NOT trigger for generic short input on video page', () => {
      expect(detectIntent('这个不错', videoCtx).type).not.toBe('summary');
      expect(detectIntent('写个函数', videoCtx).type).not.toBe('summary');
      expect(detectIntent('Python', videoCtx).type).not.toBe('summary');
    });
  });

  describe('learning_plan', () => {
    it('learning path keywords', () => {
      expect(detectIntent('前端学习路线', noneCtx).type).toBe('learning_plan');
      expect(detectIntent('Python怎么学', noneCtx).type).toBe('learning_plan');
      expect(detectIntent('零基础怎么学编程', noneCtx).type).toBe('learning_plan');
      expect(detectIntent('推荐学习React的课程', noneCtx).type).toBe('learning_plan');
      expect(detectIntent('学习计划', noneCtx).type).toBe('learning_plan');
      expect(detectIntent('learning roadmap for backend', noneCtx).type).toBe('learning_plan');
    });
  });

  describe('chat (default)', () => {
    it('greetings', () => {
      expect(detectIntent('你好', noneCtx).type).toBe('chat');
      expect(detectIntent('谢谢', videoCtx).type).toBe('chat');
    });

    it('questions', () => {
      expect(detectIntent('什么是闭包', noneCtx).type).toBe('search');
      expect(detectIntent('怎么配置webpack', noneCtx).type).toBe('search');
      expect(detectIntent('为什么Python这么火', noneCtx).type).toBe('chat');
    });

    it('ambiguous input defaults to chat', () => {
      expect(detectIntent('随便说说', noneCtx).type).toBe('chat');
      expect(detectIntent('Python', noneCtx).type).toBe('chat');
      expect(detectIntent('今天天气不错', noneCtx).type).toBe('chat');
    });
  });

  describe('intent_hint', () => {
    it('returns intent_hint matching type', () => {
      expect(detectIntent('搜Python', noneCtx).intent_hint).toBe('search');
      expect(detectIntent('总结一下', videoCtx).intent_hint).toBe('summary');
      expect(detectIntent('你好', noneCtx).intent_hint).toBe('chat');
      expect(detectIntent('学习路线', noneCtx).intent_hint).toBe('learning_plan');
    });
  });
});

describe('getTemplateIdForIntent', () => {
  it('resolves exact IDs', () => {
    expect(getTemplateIdForIntent('search', templates)).toBe('video-search');
    expect(getTemplateIdForIntent('summary', templates)).toBe('content-summary');
    expect(getTemplateIdForIntent('chat', templates)).toBe('qa-question');
    expect(getTemplateIdForIntent('learning_plan', templates)).toBe('learning-plan');
  });
});
