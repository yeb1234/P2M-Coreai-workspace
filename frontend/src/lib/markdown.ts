import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form',
  'textarea', 'select', 'button', 'noscript', 'template',
]);

const COLOR_STYLE_PROPS = new Set(['color', 'background-color']);
const COLOR_STYLE_RE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i;

/**
 * 只保留文字颜色和背景色两类内联样式。
 * 其余 style（定位、url()、expression、字体等）一律丢弃，避免把用户粘贴的
 * HTML 变成可执行或可覆盖全页的内容。
 */
export function sanitizeInlineColorStyle(style: string): string {
  return (style || '')
    .split(';')
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return '';
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (!COLOR_STYLE_PROPS.has(property)) return '';
      if (!COLOR_STYLE_RE.test(value) || /url|expression|javascript/i.test(value)) return '';
      return `${property}: ${value}`;
    })
    .filter(Boolean)
    .join('; ');
}

function safeUrl(value: string, attribute: string): boolean {
  const trimmed = value.trim();
  if (/^\s*javascript:/i.test(trimmed) || /^\s*vbscript:/i.test(trimmed)) return false;
  if (attribute === 'src' && /^\s*data:/i.test(trimmed)) {
    return /^\s*data:image\//i.test(trimmed);
  }
  if (attribute === 'href' && /^\s*data:text\/html/i.test(trimmed)) return false;
  return true;
}

/**
 * 笔记是用户自己的内容，但仍要清掉脚本、事件属性和 javascript: 链接。
 * 预览和富文本编辑器都走同一套清洗，避免把 HTML 直接当可执行内容。
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll(Array.from(BLOCKED_TAGS).join(',')).forEach((node) => node.remove());

  doc.querySelectorAll('*').forEach((element) => {
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (name.startsWith('on') || name === 'srcdoc') {
        element.removeAttribute(attr.name);
        continue;
      }
      if (name === 'style') {
        const safeStyle = sanitizeInlineColorStyle(value);
        if (safeStyle) element.setAttribute('style', safeStyle);
        else element.removeAttribute(attr.name);
        continue;
      }
      if ((name === 'href' || name === 'src') && !safeUrl(value, name)) {
        element.removeAttribute(attr.name);
      }
    }
  });

  doc.querySelectorAll('input').forEach((input) => {
    if (input.getAttribute('type') !== 'checkbox') {
      input.remove();
      return;
    }
    input.setAttribute('disabled', 'disabled');
  });

  doc.querySelectorAll('a').forEach((link) => {
    link.setAttribute('rel', 'noreferrer noopener');
  });

  return doc.body.innerHTML;
}

export function renderMarkdown(markdown: string): string {
  const html = marked.parse(markdown || '') as string;
  // 表格在窄屏会被强行压成逐字换行，套一层横向滚动容器，保留表格列语义。
  return sanitizeHtml(html)
    .replace(/<table>/g, '<div class="md-table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});
turndown.use(gfm);
turndown.addRule('coloredSpan', {
  filter: (node) => node.nodeName === 'SPAN'
    && Boolean(sanitizeInlineColorStyle((node as HTMLElement).getAttribute('style') || '')),
  replacement: (content, node) => {
    const style = sanitizeInlineColorStyle((node as HTMLElement).getAttribute('style') || '');
    return style ? `<span style="${style}">${content}</span>` : content;
  },
});
turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
});
turndown.addRule('keepMarks', {
  filter: ['mark'],
  replacement: (content, node) => {
    const style = sanitizeInlineColorStyle((node as HTMLElement).getAttribute('style') || '');
    return style ? `<span style="${style}">${content}</span>` : `<mark>${content}</mark>`;
  },
});

export function htmlToMarkdown(html: string): string {
  // contentEditable 会留下空段落，Turndown 会把它们变成一串空行。
  // 先去掉纯空段落，再按“先清行尾空格、再压空行”的顺序收干净。
  const cleanedHtml = (html || '')
    .replace(/<p[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/<div[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, '');
  return turndown.turndown(cleanedHtml)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function plainText(markdown: string): string {
  return (markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>*+\-\d.\s]+/gm, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function markdownStats(markdown: string): { chars: number; words: number; lines: number } {
  const text = plainText(markdown);
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.match(/[a-zA-Z0-9_]+/g) || []).length;
  return {
    chars: text.replace(/\s/g, '').length,
    words: cjk + words,
    lines: (markdown || '').split('\n').length,
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
