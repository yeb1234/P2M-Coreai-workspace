import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, X, Trash2, Loader2, PlayCircle } from 'lucide-react';
import { useAIStore } from '../../stores';
import {
  fetchAssistantRuntimeSettings,
  sendAssistantChat,
  type AssistantRuntimeSettingsDto,
  type SegmentSearchResult,
} from '../../lib/videoApi';
import { useDragResize } from '../../hooks/useDragResize';
import { getAssistantPageContext, type AssistantPageContext } from '../../lib/assistantPageContext';
import { buildAIRequestSystemPrompt } from '../../lib/aiPromptDefaults';
import { playInteractionSound } from '../../lib/sounds';

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PENDING_RECOMMENDED_VIDEO_KEY = 'p2m_pending_recommended_video_id';
const ASSISTANT_SETTINGS_CHANGED_EVENT = 'p2m:assistant-settings-changed';

function shortProviderModel(provider: 'local' | 'external', modelName: string) {
  const label = provider === 'local' ? '本地' : '外部';
  return `${label} ${modelName.trim() || '未设置'}`;
}

function getRuntimeModelLabel(settings: AssistantRuntimeSettingsDto) {
  const local = shortProviderModel('local', settings.local_model);
  const external = shortProviderModel('external', settings.external_model);
  switch (settings.llm_usage_policy) {
    case 'external_first':
      return `先${external}，后${local}`;
    case 'local_only':
      return `只用${local}`;
    case 'external_only':
      return `只用${external}`;
    case 'local_first':
    default:
      return `先${local}，后${external}`;
  }
}

function openRecommendedVideo(videoId: number) {
  localStorage.setItem(PENDING_RECOMMENDED_VIDEO_KEY, String(videoId));
  window.location.hash = '/video';
  window.dispatchEvent(new CustomEvent('p2m:play-video', { detail: { videoId } }));
  playInteractionSound('start');
}

export const AIChatPanel: React.FC = () => {
  const {
    chatOpen, setChatOpen, model, systemPrompt, promptTemplates, activeTemplateId,
    chatWidth, setChatWidth, messages, addMessage, clearMessages,
  } = useAIStore();
  const { width: liveChatWidth, startResize } = useDragResize({
    initialWidth: chatWidth,
    minWidth: 300,
    maxWidth: 640,
    side: 'left',
    onWidthChange: setChatWidth,
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [videoResults, setVideoResults] = useState<SegmentSearchResult[]>([]);
  const [pageContext, setPageContext] = useState<AssistantPageContext>(() => getAssistantPageContext());
  const [runtimeModelLabel, setRuntimeModelLabel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const activeTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0],
    [activeTemplateId, promptTemplates]
  );
  const visibleVideoResults = useMemo(
    () => [...new Map(videoResults.filter((item) => item.score_hint > 0).map((item) => [item.video_id, item])).values()].slice(0, 5),
    [videoResults]
  );

  useEffect(() => {
    if (!chatOpen) return;
    const refreshContext = () => setPageContext(getAssistantPageContext());
    refreshContext();
    const timer = window.setInterval(refreshContext, 1500);
    return () => window.clearInterval(timer);
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;
    let cancelled = false;
    const refreshRuntimeSettings = async () => {
      try {
        const settings = await fetchAssistantRuntimeSettings();
        if (!cancelled) setRuntimeModelLabel(getRuntimeModelLabel(settings));
      } catch {
        if (!cancelled) setRuntimeModelLabel('');
      }
    };
    void refreshRuntimeSettings();
    window.addEventListener('focus', refreshRuntimeSettings);
    window.addEventListener(ASSISTANT_SETTINGS_CHANGED_EVENT, refreshRuntimeSettings);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshRuntimeSettings);
      window.removeEventListener(ASSISTANT_SETTINGS_CHANGED_EVENT, refreshRuntimeSettings);
    };
  }, [chatOpen]);

  if (!chatOpen) return null;

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError('');
    setInput('');
    setVideoResults([]);
    const userId = makeId();
    addMessage({ id: userId, role: 'user', content: text });
    setLoading(true);
    playInteractionSound('start');

    const assistantId = makeId();
    setStreamingId(assistantId);
    addMessage({ id: assistantId, role: 'assistant', content: '' });

    try {
      const context = getAssistantPageContext();
      setPageContext(context);
      const requestSystemPrompt = buildAIRequestSystemPrompt(systemPrompt, activeTemplate?.content ?? '');
      const data = await sendAssistantChat(text, 5, context.promptContext, requestSystemPrompt);
      const finalText = data.answer?.trim() || '灵境小助手已返回，但没有可显示的文本。';
      setVideoResults(data.references.filter((item) => item.score_hint > 0) as SegmentSearchResult[]);
      setError('');
      playInteractionSound('success');
      useAIStore.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: finalText } : message
        ),
      }));
      if (!finalText.trim()) {
        setVideoResults([]);
        useAIStore.setState((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistantId ? { ...message, content: '灵境小助手已返回，但没有可显示的文本。' } : message
          ),
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '灵境小助手请求失败');
      playInteractionSound('error');
      setVideoResults([]);
      useAIStore.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: '请求失败，请检查灵境小助手的模型服务是否已启动。' } : message
        ),
      }));
    } finally {
      setLoading(false);
      setStreamingId(null);
    }
  };

  return (
    <aside
      className="relative shrink-0 border-l border-[var(--border-light)] bg-[var(--bg-card)] flex flex-col"
      style={{ width: `${liveChatWidth}px` }}
    >
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); startResize(e.clientX); }}
        onTouchStart={(e) => { e.preventDefault(); startResize(e.touches[0].clientX); }}
        className="absolute -left-3 top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent)]"
        title="拖动调整灵境小助手宽度"
      >
        <span className="h-full w-px bg-[var(--border-light)]" />
        <span className="absolute h-12 w-1 rounded-full bg-[var(--border-medium)] opacity-60" />
      </button>
      <div className="h-14 px-3 border-b border-[var(--border-light)] flex items-center gap-2">
        <Bot size={17} className="text-[var(--accent)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">灵境小助手</p>
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={runtimeModelLabel || model}>
            {runtimeModelLabel || model}
          </p>
        </div>
        <button
          onClick={() => { clearMessages(); playInteractionSound('delete'); }}
          className="ml-auto p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
          title="清空对话"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={() => setChatOpen(false)}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          title="关闭灵境小助手"
        >
          <X size={15} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-[var(--border-light)] bg-[var(--bg-elevated)]">
        <p className="text-[10px] text-[var(--text-muted)]">当前模板</p>
        <p className="text-xs font-medium text-[var(--text-primary)] truncate">{activeTemplate?.name ?? '默认模板'}</p>
        <p className={`mt-1 text-[10px] truncate ${pageContext.kind === 'none' ? 'text-[var(--text-muted)]' : 'text-[var(--accent)]'}`}>
          {pageContext.label}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs leading-6 text-[var(--text-muted)]">
            这里会连接灵境小助手。提示词模板现在统一放在灵境小助手页面里编辑。
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-xs leading-6 whitespace-pre-wrap ${
                message.role === 'user'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-light)]'
              }`}
            >
              {message.content || (streamingId === message.id ? '...' : '')}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={13} className="animate-spin" />
            灵境小助手正在回复...
          </div>
        )}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div ref={messagesEndRef} />
        {visibleVideoResults.length > 0 && !loading && !error && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-[var(--text-muted)]">相关视频</p>
            {visibleVideoResults.map((r) => (
              <button
                key={r.video_id}
                type="button"
                onClick={() => openRecommendedVideo(r.video_id)}
                className="flex w-full items-start gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-bg)]"
              >
                <PlayCircle size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate">{r.video_title || `视频 ${r.video_id}`}</p>
                  <p className="text-[10px] text-[var(--text-muted)] line-clamp-2">{r.text}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-[var(--border-light)]">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="输入消息..."
            className="min-h-[42px] max-h-28 flex-1 resize-none text-xs bg-[var(--bg-elevated)]"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={loading || !input.trim()}
            className="self-end p-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            title="发送"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
};
