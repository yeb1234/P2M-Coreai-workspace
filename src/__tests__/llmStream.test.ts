import { describe, expect, it } from 'vitest';
import { extractAssistantText, hasVisibleAssistantText, normalizeAssistantText, parseSSELines } from '../lib/llmStream';

describe('llmStream', () => {
  it('reads final assistant text from non-stream chat completion payloads', () => {
    const payload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '\n\n连接正常',
            reasoning_content: 'internal reasoning',
          },
        },
      ],
    };

    expect(extractAssistantText(payload)).toBe('\n\n连接正常');
    expect(normalizeAssistantText(extractAssistantText(payload))).toBe('连接正常');
    expect(hasVisibleAssistantText(payload)).toBe(true);
  });

  it('ignores reasoning-only stream chunks until visible content arrives', () => {
    const reasoningChunk = {
      choices: [
        {
          delta: {
            reasoning_content: '先思考一下',
          },
        },
      ],
    };
    const contentChunk = {
      choices: [
        {
          delta: {
            content: '最终回答',
          },
        },
      ],
    };

    expect(extractAssistantText(reasoningChunk)).toBe('');
    expect(hasVisibleAssistantText(reasoningChunk)).toBe(false);
    expect(extractAssistantText(contentChunk)).toBe('最终回答');
    expect(hasVisibleAssistantText(contentChunk)).toBe(true);
  });

  it('keeps the unfinished tail out of parsed SSE lines', () => {
    const sse = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":"世界"}}]}';
    const { lines, rest } = parseSSELines(sse);

    expect(lines).toEqual(['data: {"choices":[{"delta":{"content":"你好"}}]}', '']);
    expect(rest).toBe('data: {"choices":[{"delta":{"content":"世界"}}]}');
  });
});
