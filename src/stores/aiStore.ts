import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../lib/idbStorage';
import {
  DEFAULT_AI_ENDPOINT,
  DEFAULT_AI_MODEL,
  DEFAULT_PROMPT_TEMPLATES,
  DEFAULT_SYSTEM_PROMPT,
} from '../lib/aiPromptDefaults';

export interface PromptTemplate {
  id: string;
  name: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface AIState {
  endpoint: string;
  model: string;
  systemPrompt: string;
  promptTemplates: PromptTemplate[];
  activeTemplateId: string;
  chatOpen: boolean;
  chatWidth: number;
  messages: ChatMessage[];
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
  addMessage: (message: ChatMessage) => void;
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
  if (!Array.isArray(templates)) return DEFAULT_PROMPT_TEMPLATES;
  const clean = templates.filter((item): item is PromptTemplate => {
    if (!item || typeof item !== 'object') return false;
    const t = item as Partial<PromptTemplate>;
    return !!t.id && !!t.name && !!t.content && !hasCorruptText(t.name) && !hasCorruptText(t.content);
  });
  return clean.length > 0 ? clean : DEFAULT_PROMPT_TEMPLATES;
}

export const useAIStore = create<AIState>()(
  persist(
    (set, get) => ({
      endpoint: DEFAULT_AI_ENDPOINT,
      model: DEFAULT_AI_MODEL,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      promptTemplates: DEFAULT_PROMPT_TEMPLATES,
      activeTemplateId: DEFAULT_PROMPT_TEMPLATES[0].id,
      chatOpen: false,
      chatWidth: 380,
      messages: [],
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
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      clearMessages: () => set({ messages: [] }),
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
          systemPrompt: hasCorruptText(state.systemPrompt) || !state.systemPrompt ? DEFAULT_SYSTEM_PROMPT : state.systemPrompt,
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
      }),
    }
  )
);
