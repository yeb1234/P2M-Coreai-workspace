import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, renderMarkdown } from '../lib/markdown';

describe('markdown 颜色样式', () => {
  it('渲染时保留文字色和背景色', () => {
    const html = renderMarkdown('<span style="color:#dc2626;background-color:#fef08a">重点</span>');
    expect(html).toContain('style="color: #dc2626; background-color: #fef08a"');
    expect(html).toContain('重点');
  });

  it('富文本 HTML 转回 Markdown 时保留安全颜色', () => {
    const markdown = htmlToMarkdown('<p><span style="color: #dc2626">红色文字</span></p>');
    expect(markdown).toContain('<span style="color: #dc2626">红色文字</span>');
  });

  it('只保留颜色声明，丢弃定位与 url 等危险 style', () => {
    const html = renderMarkdown(
      '<span style="position:fixed;color:red;background:url(javascript:alert(1))">x</span>'
    );
    expect(html).toContain('style="color: red"');
    expect(html).not.toContain('position');
    expect(html).not.toContain('url');
  });

  it('无效颜色值不会进入 HTML 或 Markdown', () => {
    expect(renderMarkdown('<span style="color:url(javascript:alert(1))">x</span>')).not.toContain('style=');
    expect(htmlToMarkdown('<p><span style="color:url(javascript:alert(1))">x</span></p>')).not.toContain('style=');
  });
});
