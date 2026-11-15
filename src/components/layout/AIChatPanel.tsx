import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, X, Trash2, Loader2, PlayCircle, Wrench } from 'lucide-react';
import { useAIStore } from '../../stores';
import {
  fetchAssistantRuntimeSettings,
  streamAssistantChat,
  type AssistantRuntimeSettingsDto,
} from '../../lib/videoApi';
import { useDragResize } from '../../hooks/useDragResize';
import { getAssistantPageContext } from '../../lib/assistantPageContext';
import { buildAIRequestSystemPrompt } from '../../lib/aiPromptDefaults';
import { playInteractionSound } from '../../lib/sounds';
import { useAssistantPageContext } from '../../hooks/useAssistantPageContext';

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PENDING_RECOMMENDED_VIDEO_KEY = 'p2m_pending_recommended_video_id';
const PENDING_SEEK_KEY = 'p2m_pending_seek_sec';
const ASSISTANT_SETTINGS_CHANGED_EVENT = 'p2m:assistant-settings-changed';

interface ReferenceItem {
  video_id: number;
  video_title: string;
  start_sec: number;
  text: string;
  score?: number;
}

const TOOL_LABELS: Record<string, string> = {
  search_videos: '检索视频片段',
  search_video_titles: '查找课程',
  get_video_summary: '读取视频摘要',
  get_learning_profile: '读取学习画像',
  get_recent_activity: '查看近期学习',
  get_learning_goal: '读取学习目标',
  recommend_next_videos: '推荐下一步',
  search_notes: '检索笔记',
};

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

function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  // 超过一小时的视频按 h:mm:ss 显示，否则 mm:ss
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** 跳转到视频指定时间点：先把 seek 位置落到 localStorage，播放器加载后自会读取 */
function openVideoAt(videoId: number, startSec?: number) {
  localStorage.setItem(PENDING_RECOMMENDED_VIDEO_KEY, String(videoId));
  if (typeof startSec === 'number' && startSec > 0) {
    localStorage.setItem(PENDING_SEEK_KEY, String(startSec));
  }
  window.location.hash = '/video';
  window.dispatchEvent(new CustomEvent('p2m:play-video', { detail: { videoId, startSec } }));
  playInteractionSound('start');
}

export const AIChatPanel: React.FC = () => {
  const {
    chatOpen, setChatOpen, model, systemPrompt, promptTemplates, activeTemplateId,
    chatWidth, setChatWidth, messages, addMessage, clearMessages, sessionId, setSessionId,
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
  const [toolHint, setToolHint] = useState('');
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [, setPageContext] = useAssistantPageContext(chatOpen);
  const [runtimeModelLabel, setRuntimeModelLabel] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const activeTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0],
    [activeTemplateId, promptTemplates]
  );

  // 同一视频只保留相关度最高的一条，避免刷屏
  const visibleReferences = useMemo(() => {
    const best = new Map<number, ReferenceItem>();
    for (const item of references) {
      const existing = best.get(item.video_id);
      if (!existing || (item.score ?? 0) > (existing.score ?? 0)) best.set(item.video_id, item);
    }
    return [...best.values()].slice(0, 5);
  }, [references]);

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

  /** 按动画帧合并流式 token，避免每个字都触发一次 React 重渲染 */
  const scheduleFlush = (assistantId: string) => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const text = bufferRef.current;
      useAIStore.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: text } : message
        ),
      }));
    });
  };

  const patchMessage = (assistantId: string, patch: Record<string, unknown>) => {
    useAIStore.setState((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantId ? { ...message, ...patch } : message
      ),
    }));
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setToolHint('');
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError('');
    setInput('');
    setReferences([]);
    setToolHint('');

    addMessage({ id: makeId(), role: 'user', content: text });
    setLoading(true);
    playInteractionSound('start');

    const assistantId = makeId();
    bufferRef.current = '';
    addMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const controller = new AbortController();
    abortRef.current = controller;
    const usedTools: string[] = [];
    let streamError = '';

    try {
      const context = getAssistantPageContext();
      setPageContext(context);
      const requestSystemPrompt = buildAIRequestSystemPrompt(systemPrompt, activeTemplate?.content ?? '');

      await streamAssistantChat(text, {
        sessionId,
        pageContext: context.promptContext,
        systemPrompt: requestSystemPrompt,
        onEvent: (event) => {
          switch (event.type) {
            case 'token':
              bufferRef.current += event.text;
              scheduleFlush(assistantId);
              break;
            case 'tool_start':
              usedTools.push(event.tool);
              setToolHint(TOOL_LABELS[event.tool] ?? event.tool);
              break;
            case 'tool_end':
              setToolHint('');
              break;
            case 'done':
              setToolHint('');
              if (event.session_id && event.session_id !== sessionId) {
                setSessionId(event.session_id);
              }
              if (event.references?.length) setReferences(event.references);
              break;
            case 'error':
              streamError = event.message;
              setError(event.message);
              break;
            default:
              break;
          }
        },
        signal: controller.signal,
      });

      const finalText = bufferRef.current.trim();
      if (finalText) playInteractionSound('success');
      patchMessage(assistantId, {
        content: finalText || streamError || '（没有返回内容，请重试）',
        streaming: false,
        steps: usedTools,
      });
      if (finalText) setError('');
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      const message = aborted
        ? '已停止生成'
        : err instanceof Error
          ? err.message
          : '对话请求失败';
      if (!aborted) {
        setError(
          /Failed to fetch|NetworkError/i.test(message)
            ? '连不上后端，请确认服务是否已启动'
            : message
        );
        playInteractionSound('error');
      }
      patchMessage(assistantId, {
        content: bufferRef.current.trim() || (aborted ? '已停止生成。' : '请求失败，请检查后端与模型服务。'),
        streaming: false,
      });
    } finally {
      abortRef.current = null;
      setLoading(false);
      setToolHint('');
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
        {sessionId && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--accent-bg)] text-[var(--accent)]"
            title={`会话 ${sessionId}`}
          >
            续聊中
          </span>
        )}
        <button
          onClick={() => { clearMessages(); setReferences([]); playInteractionSound('delete'); }}
          className="ml-auto p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
          title="清空对话（同时开启新会话）"
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
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs leading-6 text-[var(--text-muted)]">
            可以问我：库里有讲 X 的视频吗 / 我最近学得怎么样 / 下一步该学什么。
            回答会带上视频名与时间点，点一下直接跳到那一秒。
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
              {message.content || (message.streaming ? '…' : '')}
              {message.streaming && message.content && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[var(--accent)] align-middle" />
              )}
              {message.role === 'assistant' && message.steps && message.steps.length > 0 && (
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <Wrench size={10} />
                  调用了 {message.steps.length} 次工具
                </p>
              )}
            </div>
          </div>
        ))}
        {toolHint && (
          <div className="flex items-center gap-2 text-[10px] text-[var(--accent)]">
            <Loader2 size={11} className="animate-spin" />
            {toolHint}…
          </div>
        )}
        {loading && !toolHint && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 size={13} className="animate-spin" />
            灵境小助手正在思考...
          </div>
        )}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div ref={messagesEndRef} />
        {visibleReferences.length > 0 && !loading && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-[var(--text-muted)]">相关片段（点击跳转）</p>
            {visibleReferences.map((item) => (
              <button
                key={`${item.video_id}-${item.start_sec}`}
                type="button"
                onClick={() => openVideoAt(item.video_id, item.start_sec)}
                className="flex w-full items-start gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-2.5 py-2 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-bg)]"
              >
                <PlayCircle size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                    {item.video_title || `视频 ${item.video_id}`}
                  </p>
                  <p className="text-[10px] text-[var(--accent)]">{formatTimestamp(item.start_sec)}</p>
                  <p className="text-[10px] text-[var(--text-muted)] line-clamp-2">{item.text}</p>
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
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            className="min-h-[42px] max-h-28 flex-1 resize-none text-xs bg-[var(--bg-elevated)]"
          />
          {loading ? (
            <button
              onClick={stopStreaming}
              className="self-end p-2 rounded-lg border border-[var(--danger)] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
              title="停止生成"
            >
              <X size={15} />
            </button>
          ) : (
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim()}
              className="self-end p-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              title="发送"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};
