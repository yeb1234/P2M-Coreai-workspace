import { describe, expect, it } from 'vitest';
import { rankShowcaseVideos, SHOWCASE_VIDEOS } from '../components/showcase/showcaseData';

describe('Lite 视频预览样例排序', () => {
  it('默认查询把 FastAPI 多 Agent 视频排第一', () => {
    const results = rankShowcaseVideos('FastAPI 多 Agent');
    expect(results[0]?.id).toBe('40676');
    expect(results.length).toBeGreaterThan(0);
  });

  it('RAG 召回查询命中 RAG 介绍，不返回无关视频', () => {
    const results = rankShowcaseVideos('RAG 召回');
    expect(results[0]?.id).toBe('50144');
    expect(results.every((video) => video.tags.includes('rag') || video.tags.includes('召回'))).toBe(true);
  });

  it('LangChain MCP 查询命中 MCP 演示', () => {
    const results = rankShowcaseVideos('LangChain MCP');
    expect(results[0]?.id).toBe('50182');
  });

  it('空查询展示全部样例，未知查询返回空态', () => {
    expect(rankShowcaseVideos('   ')).toHaveLength(SHOWCASE_VIDEOS.length);
    expect(rankShowcaseVideos('量子力学')).toHaveLength(0);
  });

  it('所有样例都有封面、命中时间和字幕段', () => {
    for (const video of SHOWCASE_VIDEOS) {
      expect(video.cover.startsWith('/demo-video/')).toBe(true);
      expect(video.hitAt).toMatch(/^\d{2}:\d{2}$/);
      expect(video.transcript.length).toBeGreaterThan(0);
      expect(video.advice.actions.length).toBeGreaterThan(0);
    }
  });
});
