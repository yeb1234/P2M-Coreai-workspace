import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VideoPreviewPage } from '../components/showcase/VideoPreviewPage';

describe('Lite 视频检索演示页', () => {
  it('从检索结果进入静态观看页并展示学习建议', () => {
    render(<VideoPreviewPage />);

    expect(screen.getByText('视频检索')).toBeTruthy();
    const result = screen.getByText('8-3 多Agent系统可视化配置API设计与开发');
    fireEvent.click(result);

    expect(screen.getByText('返回检索结果')).toBeTruthy();
    expect(screen.getByText('Agent 学习建议')).toBeTruthy();
    expect(screen.getByText('字幕命中片段')).toBeTruthy();
    expect(screen.getByText('STATIC PREVIEW')).toBeTruthy();
  });

  it('切换到 RAG 样例后只保留相关结果', () => {
    render(<VideoPreviewPage />);

    fireEvent.click(screen.getByText('RAG 召回'));
    expect(screen.getByText('DAY02_14_RAG_介绍')).toBeTruthy();
    expect(screen.queryByText('DAY04_15_langchain使用MCP')).toBeNull();
  });
});
