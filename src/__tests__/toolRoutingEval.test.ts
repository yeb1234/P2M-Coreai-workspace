/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectIntent } from '../../prompts/clientPrompts';

type EvalCase = {
  id: string;
  query: string;
  intent: string | null;
};

const cases = JSON.parse(
  readFileSync(join(process.cwd(), 'backend/tests/eval/tool_routing_eval.json'), 'utf8'),
) as EvalCase[];

describe('工具路由评测集（前端意图识别）', () => {
  for (const item of cases) {
    it(`${item.id}「${item.query}」→ ${item.intent ?? '不识别'}`, () => {
      expect(detectIntent(item.query)).toBe(item.intent);
    });
  }
});
