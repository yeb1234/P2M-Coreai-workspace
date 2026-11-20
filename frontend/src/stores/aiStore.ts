import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import {
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  DEFAULT_PROMPT_TEMPLATES,
  DEFAULT_SYSTEM_PROMPT,
  LITE_PROMPT_TEMPLATES,
  LITE_SYSTEM_PROMPT,
} from '../lib/aiPromptDefaults';
import { IS_LITE } from '../config/appProfile';

const ACTIVE_PROMPT_TEMPLATES = IS_LITE ? LITE_PROMPT_TEMPLATES : DEFAULT_PROMPT_TEMPLATES;
const ACTIVE_SYSTEM_PROMPT = IS_LITE ? LITE_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
}

export interface ChatReference {
  video_id: number;
  video_title: string;
  /** 相对文件夹层级（后端已清洗，不含系统路径） */
  folder_path?: string;
  start_sec: number;
  text: string;
  score?: number;
}

export interface ChatMentionedVideo {
  text: string;
  video_id: number;
}

export interface ChatHitlOption {
  id: string;
  label: string;
  description?: string;
}

export interface ChatHitl {
  runId: string;
  interruptId: string;
  kind: 'clarify' | 'supplement' | 'confirm' | string;
  question: string;
  options: ChatHitlOption[];
  allowCustom: boolean;
  context?: string;
  intent?: string | null;
  originalMessage?: string;
  status: 'pending' | 'answered' | 'cancelled';
  selected?: string;
  selectedLabel?: string;
  customText?: string;
}

export interface ChatAction {
  id: string;
  action_type: 'note' | 'calendar' | 'todo' | string;
  status: 'applied' | 'failed' | 'undone' | string;
  title: string;
  summary?: string | null;
  target_id?: string | null;
  created_at?: string | null;
  undone_at?: string | null;
  can_undo?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 该回答引用的视频片段，点击可跳转到对应时间点 */
  references?: ChatReference[];
  /** Agent 实际调用过的工具名，让用户知道答案不是凭空编的 */
  steps?: string[];
  /** 正文里提到的视频：《标题》→ video_id，渲染成可点链接 */
  mentioned_videos?: ChatMentionedVideo[];
  /** 这条回答是降级到备用 LLM 产出的（主通道挂了）。有值就显示提示。 */
  degraded_from?: string;
  /** 这条回答用的意图模板 id —— 存消息上，刷新后还能看出当时的策略 */
  intent?: string;
  /** 本轮真正落库的笔记/日历/Todo 动作，下面渲染执行回执与撤回按钮 */
  actions?: ChatAction[];
  /** 流式输出中，用于显示光标 */
  streaming?: boolean;
  /** 等待用户选择/补充/确认的 HITL 卡片 */
  hitl?: ChatHitl;
}

interface AIState {
  endpoint: string;
  model: string;
  systemPrompt: string;
  promptTemplates: PromptTemplate[];
  activeTemplateId: string;
  chatOpen: boolean;
  chatWidth: number;
  /** 题目详情等入口预填到输入框的一次性草稿，不持久化。 */
  pendingPrompt: string;
  messages: ChatMessage[];
  /** 后端会话 id，刷新页面后仍能接着上次聊 */
  sessionId: string;
  setSessionId: (id: string) => void;
  setEndpoint: (endpoint: string) => void;
  setModel: (model: string) => void;
  setSystemPrompt: (prompt: string) => void;
  setActiveTemplateId: (id: string) => void;
  updateTemplate: (id: string, updates: Partial<PromptTemplate>) => void;
  addTemplate: () => void;
  removeTemplate: (id: string) => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  setChatWidth: (width: number) => void;
  setPendingPrompt: (prompt: string) => void;
  consumePendingPrompt: () => string;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setMessages: (messages: ChatMessage[]) => void;
  clearMessages: () => void;
}

function hasCorruptText(value: unknown): boolean {
  return typeof value === 'string' && /[�锟]|[\u00c0-\u00ff]{2,}/.test(value);
}

function normalizeEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string' || hasCorruptText(endpoint)) return DEFAULT_AI_ENDPOINT;
  if (endpoint === 'http://127.0.0.1:1234' || endpoint === 'http://localhost:1234') return DEFAULT_AI_ENDPOINT;
  if (endpoint === 'http://192.168.3.161:1234' || endpoint === 'http://192.168.3.161:1234/') return DEFAULT_AI_ENDPOINT;
  if (endpoint.endsWith('/v1/chat/completions')) return endpoint;
  if (endpoint.endsWith('/')) return `${endpoint}v1/chat/completions`;
  return endpoint;
}

function clampChatWidth(width: number | undefined): number {
  return Math.max(300, Math.min(640, Math.round(width || 380)));
}

function sanitizeTemplates(templates: unknown): PromptTemplate[] {
  if (!Array.isArray(templates)) return ACTIVE_PROMPT_TEMPLATES;
  const clean = templates.filter((item): item is PromptTemplate => {
    if (!item || typeof item !== 'object') return false;
    const t = item as Partial<PromptTemplate>;
    return !!t.id && !!t.name && !!t.content && !hasCorruptText(t.name) && !hasCorruptText(t.content);
  });
  if (clean.length === 0) return ACTIVE_PROMPT_TEMPLATES;

  // 合并新增的默认模板。老用户 localStorage 里只有原来那 3 个
  // （学习总结 / 代码助手 / 任务拆解），不补的话自动识别到
  // course-recommend 时找不到模板，UI 只能显示 id 字符串。
  // 用户自己改过的同名模板不动，也不删除用户自建的模板。
  const existingIds = new Set(clean.map((t) => t.id));
  const missing = ACTIVE_PROMPT_TEMPLATES.filter((t) => !existingIds.has(t.id));
  return [...clean, ...missing];
}

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      endpoint: DEFAULT_AI_ENDPOINT,
      model: DEFAULT_AI_MODEL,
      systemPrompt: ACTIVE_SYSTEM_PROMPT,
      promptTemplates: ACTIVE_PROMPT_TEMPLATES,
      activeTemplateId: ACTIVE_PROMPT_TEMPLATES[0].id,
      chatOpen: false,
      chatWidth: 380,
      pendingPrompt: '',
      messages: [],
      sessionId: '',
      setEndpoint: (endpoint) => set({ endpoint: normalizeEndpoint(endpoint) }),
      setModel: (model) => set({ model }),
      setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
      setActiveTemplateId: (activeTemplateId) => set({ activeTemplateId }),
      updateTemplate: (id, updates) => set((state) => ({
        promptTemplates: state.promptTemplates.map((template) =>
          template.id === id ? { ...template, ...updates } : template
        ),
      })),
      addTemplate: () => {
        const id = `template-${Date.now()}`;
        set((state) => ({
          promptTemplates: [
            ...state.promptTemplates,
            { id, name: '新模板', content: '请在这里写提示词模板。' },
          ],
          activeTemplateId: id,
        }));
      },
      removeTemplate: (id) => {
        const templates = get().promptTemplates;
        if (templates.length <= 1) return;
        const next = templates.filter((template) => template.id !== id);
        set({
          promptTemplates: next,
          activeTemplateId: next.some((template) => template.id === get().activeTemplateId)
            ? get().activeTemplateId
            : next[0].id,
        });
      },
      toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
      setChatOpen: (chatOpen) => set({ chatOpen }),
      setChatWidth: (chatWidth) => set({ chatWidth: clampChatWidth(chatWidth) }),
      setPendingPrompt: (pendingPrompt) => set({ pendingPrompt }),
      consumePendingPrompt: () => {
        const pendingPrompt = get().pendingPrompt;
        if (pendingPrompt) set({ pendingPrompt: '' });
        return pendingPrompt;
      },
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      // 流式结束后把富内容补写回消息本身。
      // 原来这些只存在 AIChatPanel 的 useState 里 —— 刷新/换页面就全丢，
      // 只剩纯文字历史，链接和视频推荐框都没了。
      updateMessage: (id, updates) =>
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
        })),
      // 切换历史会话时整批替换（不是追加）
      setMessages: (messages) => set({ messages }),
      clearMessages: () => set({ messages: [], sessionId: '' }),
      setSessionId: (sessionId) => set({ sessionId }),
    }),
    {
      name: 'p2m-ai-storage',
      storage: createJSONStorage(() => idbStorage),
      version: 3,
      migrate: (persistedState: unknown) => {
        const state = persistedState as Partial<AIState>;
        const promptTemplates = sanitizeTemplates(state.promptTemplates);
        const activeTemplateId = promptTemplates.some((template) => template.id === state.activeTemplateId)
          ? state.activeTemplateId!
          : promptTemplates[0].id;
        return {
          ...state,
          endpoint: normalizeEndpoint(state.endpoint),
          model: hasCorruptText(state.model) || !state.model ? DEFAULT_AI_MODEL : state.model,
          systemPrompt: hasCorruptText(state.systemPrompt) || !state.systemPrompt ? ACTIVE_SYSTEM_PROMPT : state.systemPrompt,
          promptTemplates,
          activeTemplateId,
          chatWidth: clampChatWidth(state.chatWidth),
        } as AIState;
      },
      partialize: (state) => ({
        endpoint: state.endpoint,
        model: state.model,
        systemPrompt: state.systemPrompt,
        promptTemplates: state.promptTemplates,
        activeTemplateId: state.activeTemplateId,
        chatOpen: state.chatOpen,
        chatWidth: state.chatWidth,
        messages: state.messages.slice(-50),
        sessionId: state.sessionId,
      }),
    }
  )
);
