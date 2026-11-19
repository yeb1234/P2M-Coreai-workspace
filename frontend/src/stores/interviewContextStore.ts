import { create } from 'zustand';
import type { InterviewQuestion } from '../data/interview/types';

/**
 * 面试页给灵境小助手看的轻量上下文。
 *
 * 不把 350 道题的 JSON 再挂到全局：页面打开题目时只把当前这一道题的
 * 对象放进来，聊天请求按需取；离开页面由面试页清空。
 */
interface InterviewContextState {
  tab: string;
  activeQuestion: InterviewQuestion | null;
  setTab: (tab: string) => void;
  setActiveQuestion: (question: InterviewQuestion | null) => void;
}

export const useInterviewContextStore = create<InterviewContextState>()((set) => ({
  tab: 'all',
  activeQuestion: null,
  setTab: (tab) => set({ tab }),
  setActiveQuestion: (activeQuestion) => set({ activeQuestion }),
}));
