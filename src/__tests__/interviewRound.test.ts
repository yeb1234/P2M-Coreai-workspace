import { describe, expect, it } from 'vitest';
import {
  FIRST_ROUND_CONFIG,
  SECOND_ROUND_CONFIG,
  buildRoundQuestions,
  roundConfigSummary,
  roundConfigTotal,
} from '../lib/interviewRound';
import { QUESTIONS } from '../data/interview/bankData';

const fixedRandom = () => 0.37;

describe('interviewRound', () => {
  it('keeps the designed one/two round defaults at six questions', () => {
    expect(roundConfigTotal(FIRST_ROUND_CONFIG)).toBe(6);
    expect(roundConfigTotal(SECOND_ROUND_CONFIG)).toBe(6);
    expect(roundConfigSummary(FIRST_ROUND_CONFIG)).toContain('Agent / RAG 2');
    expect(roundConfigSummary(SECOND_ROUND_CONFIG)).toContain('项目深挖 2');
  });

  it('draws the requested count without duplicate questions', () => {
    const questions = buildRoundQuestions(FIRST_ROUND_CONFIG, QUESTIONS, fixedRandom);
    expect(questions).toHaveLength(6);
    expect(new Set(questions.map((question) => question.id)).size).toBe(6);
  });

  it('fills from the whole bank when a small category runs out', () => {
    const questions = buildRoundQuestions(
      { agent: 99, llm: 0, backend: 0, delivery: 0, bonus: 0, project: 0 },
      QUESTIONS.slice(0, 8),
      fixedRandom,
    );
    expect(questions).toHaveLength(8);
    expect(new Set(questions.map((question) => question.id)).size).toBe(8);
  });
});
