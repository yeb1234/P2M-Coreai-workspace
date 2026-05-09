import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, X, Trash2, Loader2 } from 'lucide-react';
import { useAIStore } from '../../stores';
import { buildAIRequestSystemPrompt } from '../../stores/aiStore';

const makeId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const AIChatPanel: React.FC = () => {
  const {
    chatOpen, setChatOpen, endpoint, model, systemPrompt, promptTemplates, activeTemplateId,
    chatWidth, setChatWidth, messages, addMessage, clearMessages,
  } = useAIStore();
  const resizeRef = useRef({ active: false, startX: 0, startWidth: 380 });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);

  const activeTemplate = useMemo(
    () => promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0],
    [activeTemplateId, promptTemplates]
  );

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!resizeRef.current.active) return;
      const delta = resizeRef.current.startX - event.clientX;
      setChatWidth(resizeRef.current.startWidth + delta);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const handleUp = () => {
      resizeRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [setChatWidth]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    resizeRef.current = { active: true, startX: event.clientX, startWidth: chatWidth };
  }, [chatWidth]);

  if (!chatOpen) return null;

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError('');
    setInput('');
    const userId = makeId();
    addMessage({ id: userId, role: 'user', content: text });
    setLoading(true);

    const assistantId = makeId();
    setStreamingId(assistantId);
    addMessage({ id: assistantId, role: 'assistant', content: '' });

    try {
      const payload = {
        model,
        messages: [
          { role: 'system', content: buildAIRequestSystemPrompt(systemPrompt, activeTemplate?.content ?? '') },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: text },
        ],
        stream: true,
      };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) throw new Error(`接口返回 ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line) continue;
          if (line === 'data: [DONE]') continue;
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

      if (!finalText.trim()) {
        useAIStore.setState((state) => ({
          messages: state.messages.map((message) =>
            message.id === assistantId ? { ...message, content: '本地 AI 已返回，但没有可显示的文本。' } : message
          ),
        }));
      }
    } catch (err) {
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
      style={{ width: `${chatWidth}px` }}
    >
      <button
        type="button"
        onMouseDown={startResize}
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
