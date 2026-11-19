import rawBank from './questions.json';
import type { InterviewBank } from './types';

/** 完整题库只在模拟面试等需要答案/rubric 的场景按需加载。 */
export const INTERVIEW_BANK = rawBank as unknown as InterviewBank;
export const QUESTIONS = INTERVIEW_BANK.questions;
