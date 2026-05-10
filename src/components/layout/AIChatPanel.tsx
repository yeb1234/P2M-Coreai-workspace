import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, X, Trash2, Loader2, PlayCircle } from 'lucide-react';
import { useAIStore } from '../../stores';
import { buildAIRequestSystemPrompt } from '../../stores/aiStore';
import { searchSegments, type SegmentSearchResult } from '../../lib/videoApi';
import { useDragResize } from '../../hooks/useDragResize';

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const AIChatPanel: React.FC = () => {
  const {
    chatOpen, setChatOpen, endpoint, model, systemPrompt, promptTemplates, activeTemplateId,
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
  const unmountedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => { unmountedRef.current = true; };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const activeTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0],
    [activeTemplateId, promptTemplates]
  );

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

    // Search for relevant videos
    let videoContext = '';
    try {
      const results = await searchSegments(text, 5);
      if (results.length > 0) {
        setVideoResults(results);
        const uniqueVideos = new Map<number, { title: string; matches: string[] }>();
        for (const r of results) {
          const existing = uniqueVideos.get(r.video_id);
          if (existing) {
            existing.matches.push(r.text);
          } else {
            uniqueVideos.set(r.video_id, { title: r.video_title || `视频 ${r.video_id}`, matches: [r.text] });
          }
        }
        const lines = [...uniqueVideos.entries()].map(([id, v]) =>
          `- 《${v.title}》(ID:${id})：${v.matches.slice(0, 2).join('；')}`
        );
        videoContext = `\n\n用户视频库中找到以下相关视频：\n${lines.join('\n')}\n请根据这些视频内容回答用户问题，并推荐相关视频。`;
      }
    } catch {
      // Video search is best-effort
    }

    const assistantId = makeId();
    setStreamingId(assistantId);
    addMessage({ id: assistantId, role: 'assistant', content: '' });

    try {
      const payload = {
        model,
        messages: [
          { role: 'system', content: buildAIRequestSystemPrompt(systemPrompt, activeTemplate?.content ?? '') + videoContext },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: text },
        ],
        stream: true,
      };
      console.log('[AIChat] fetching', endpoint);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      console.log('[AIChat] response status', res.status, 'ok:', res.ok, 'body:', !!res.body);
      if (!res.ok || !res.body) throw new Error(`接口返回 ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      let chunkCount = 0;

      while (true) {
        if (unmountedRef.current) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        chunkCount++;
        if (chunkCount <= 3) console.log('[AIChat] chunk', chunkCount, ':', text.slice(0, 200));
        buffer += text;
        const chunks = buffer.split('\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line) continue;
          if (line === 'data: [DONE]') { console.log('[AIChat] stream DONE'); continue; }
          if (!line.startsWith('data:')) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            const delta = json?.choices?.[0]?.delta?.content || json?.message?.content || '';
            if (delta) {
              finalText += delta;
              setError('');
              useAIStore.setState((state) => ({
                messages: state.messages.map((message) =>
                  message.id === assistantId ? { ...message, content: finalText } : message
                ),
              }));
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }

      console.log('[AIChat] stream finished, total chunks:', chunkCount, 'finalText length:', finalText.length);
      if (!finalText.trim()) {
        useAIStore.setState((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistantId ? { ...message, content: '本地 AI 已返回，但没有可显示的文本。' } : message
          ),
        }));
      }
    } catch (err) {
      console.error('[AIChat] error:', err);
      setError(err instanceof Error ? err.message : '本地 AI 请求失败');
      useAIStore.setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: '请求失败，请检查 LM Studio 是否已启动。' } : message
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
        title="拖动调整 AI 助手宽度"
      >
        <span className="h-full w-px bg-[var(--border-light)]" />
        <span className="absolute h-12 w-1 rounded-full bg-[var(--border-medium)] opacity-60" />
      </button>
      <div className="h-14 px-3 border-b border-[var(--border-light)] flex items-center gap-2">
        <Bot size={17} className="text-[var(--accent)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">本地 AI 对话</p>
          <p className="text-[10px] text-[var(--text-muted)] truncate">{model}</p>
        </div>
        <button
          onClick={clearMessages}
          className="ml-auto p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
          title="清空对话"
        >
          <Trash2 size={14} />
        </button>
        <button
          onClick={() => setChatOpen(false)}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          title="关闭 AI 侧栏"
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
            这里会连接你的本地 AI。提示词模板现在统一放在 AI 助手页面里编辑。
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
            本地 AI 正在回复...
          </div>
        )}
        {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
        <div ref={messagesEndRef} />
        {videoResults.length > 0 && !loading && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-[var(--text-muted)]">相关视频</p>
            {[...new Map(videoResults.map((r) => [r.video_id, r])).values()].slice(0, 5).map((r) => (
              <button
                key={r.video_id}
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('p2m:play-video', { detail: { videoId: r.video_id } }));
                }}
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
