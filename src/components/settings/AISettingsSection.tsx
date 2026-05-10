import { useState, useRef, useEffect } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { useAIStore } from '../../stores';
import { buildAIRequestSystemPrompt } from '../../stores/aiStore';

export function AISettings() {
  const endpoint = useAIStore((s) => s.endpoint);
  const model = useAIStore((s) => s.model);
  const systemPrompt = useAIStore((s) => s.systemPrompt);
  const promptTemplates = useAIStore((s) => s.promptTemplates);
  const activeTemplateId = useAIStore((s) => s.activeTemplateId);
  const setEndpoint = useAIStore((s) => s.setEndpoint);
  const setModel = useAIStore((s) => s.setModel);
  const setSystemPrompt = useAIStore((s) => s.setSystemPrompt);
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint);
  const [draftModel, setDraftModel] = useState(model);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);
  const [testInput, setTestInput] = useState('你好，简单回复一句，说明你已经连接成功。');
  const [testReply, setTestReply] = useState('');
  const [testError, setTestError] = useState('');
  const [testing, setTesting] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const [modelScannedAt, setModelScannedAt] = useState<string>('');
  const [hasScannedModels, setHasScannedModels] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const activeTemplate = promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0];

  useEffect(() => {
    setDraftEndpoint(endpoint);
    setDraftModel(model);
    setDraftSystemPrompt(systemPrompt);
  }, [endpoint, model, systemPrompt]);

  const modelListUrl = (() => {
    const trimmed = draftEndpoint.trim().replace(/\/+$/, '');
    if (trimmed.endsWith('/v1/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/models');
    if (trimmed.endsWith('/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/models');
    if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
    return `${trimmed}/v1/models`;
  })();

  const scanModels = async () => {
    if (modelLoading) return;
    setModelLoading(true);
    setModelError('');
    try {
      const res = await fetch(modelListUrl);
      if (!res.ok) throw new Error(`模型列表接口返回 ${res.status}`);
      const data = await res.json();
      const ids: string[] = Array.isArray(data?.data)
        ? data.data
            .map((item: unknown) => {
              if (!item || typeof item !== 'object') return '';
              const value = (item as { id?: unknown; name?: unknown }).id ?? (item as { name?: unknown }).name;
              return typeof value === 'string' ? value.trim() : '';
            })
            .filter((value: string): value is string => value.length > 0)
        : [];
      const unique: string[] = Array.from(new Set<string>(ids));
      setModelOptions(unique);
      setModelScannedAt(new Date().toLocaleTimeString('zh-CN'));
      setHasScannedModels(true);
      if (unique.length === 0) {
        setModelError('没有扫描到模型，请确认 LM Studio 已加载模型。');
      } else if (!draftModel || draftModel === 'local-model') {
        setDraftModel(unique[0]);
      }
    } catch (err) {
      setModelOptions([]);
      setHasScannedModels(true);
      setModelError(err instanceof Error ? err.message : '扫描模型失败，请检查 LM Studio 是否已启动。');
    } finally {
      setModelLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      void scanModels();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    setEndpoint(draftEndpoint);
    setModel(draftModel);
    setSystemPrompt(draftSystemPrompt);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestAI = async () => {
    const text = testInput.trim();
    if (!text || testing) return;
    setTesting(true);
    setTestReply('');
    setTestError('');

    try {
      const res = await fetch(draftEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: draftModel,
          stream: true,
          messages: [
            { role: 'system', content: buildAIRequestSystemPrompt(draftSystemPrompt, activeTemplate?.content ?? '') },
            { role: 'user', content: text },
          ],
        }),
      });
      if (!res.ok) throw new Error(`接口返回 ${res.status}`);

      if (!res.body) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || data?.message?.content || '';
        setTestReply(content || '本地 AI 已返回，但没有可显示的文本。');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        if (!mountedRef.current) { reader.cancel(); break; }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line || line === 'data: [DONE]' || !line.startsWith('data:')) continue;
          try {
            const json = JSON.parse(line.slice(5).trim());
            const delta = json?.choices?.[0]?.delta?.content || json?.choices?.[0]?.message?.content || json?.message?.content || '';
            if (delta) {
              finalText += delta;
              setTestReply(finalText);
            }
          } catch {
            // ignore malformed stream chunks
          }
        }
      }

      if (!finalText.trim()) setTestReply('本地 AI 已返回，但没有可显示的文本。');
    } catch (err) {
      setTestError(err instanceof Error ? err.message : '测试请求失败，请检查 LM Studio 是否已启动。');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4">
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">接口地址</label>
          <input value={draftEndpoint} onChange={(e) => setDraftEndpoint(e.target.value)} className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm" />
          <p className="text-[10px] text-[#9ca3af] mt-1">LM Studio 默认可用地址：<code>http://192.168.3.161:1234/v1/chat/completions</code></p>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label className="block text-xs font-medium text-[#6b7280]">模型名</label>
            <button
              onClick={() => void scanModels()}
              disabled={modelLoading}
              className="inline-flex items-center gap-1 text-xs text-[#6b7280] hover:text-[#c87d2f] disabled:opacity-50"
              title={`扫描 ${modelListUrl}`}
            >
              <RefreshCw size={12} className={modelLoading ? 'animate-spin' : ''} />
              {modelLoading ? '扫描中' : '扫描模型'}
            </button>
          </div>
          <select
            value={draftModel}
            onFocus={() => {
              if (!hasScannedModels && !modelLoading) void scanModels();
            }}
            onChange={(e) => setDraftModel(e.target.value)}
            className="w-full px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm"
          >
            {draftModel && !modelOptions.includes(draftModel) && <option value={draftModel}>{draftModel}</option>}
            {!draftModel && <option value="">请选择模型</option>}
            {modelOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <p className="text-[10px] text-[#9ca3af] mt-1">模型列表：<code>{modelListUrl}</code></p>
          {modelScannedAt && (
            <p className="text-[10px] text-[#9ca3af] mt-1">
              已扫描到 {modelOptions.length} 个模型，上次扫描 {modelScannedAt}。打开本页、聚焦下拉框或点击扫描时请求。
            </p>
          )}
          {modelOptions.length > 0 && draftModel && draftModel !== 'local-model' && !modelOptions.includes(draftModel) && (
            <p className="text-[10px] text-[#c87d2f] mt-1">当前模型不在扫描列表里，仍会保留你手动填写的模型名。</p>
          )}
          {modelError && <p className="text-[10px] text-[#dc3545] mt-1">{modelError}</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6b7280] mb-1.5">系统提示词</label>
          <textarea value={draftSystemPrompt} onChange={(e) => setDraftSystemPrompt(e.target.value)} className="w-full min-h-24 px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm resize-y" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] transition-colors">
          <Save size={14} /> 保存 AI 设置
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
      </div>

      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="text-sm font-medium text-[#1a1a1a] mb-2">当前提示词模板</h4>
        {activeTemplate ? (
          <div className="rounded-lg border border-[#e5e2dd] bg-[#faf9f7] p-3">
            <p className="text-sm font-medium text-[#1a1a1a]">{activeTemplate.name}</p>
            <p className="text-xs text-[#6b7280] mt-1 whitespace-pre-wrap">{activeTemplate.content}</p>
          </div>
        ) : (
          <p className="text-xs text-[#9ca3af]">暂无模板</p>
        )}
      </div>

      <div className="border-t border-[#e5e2dd] pt-4 space-y-3">
        <div>
          <h4 className="text-sm font-medium text-[#1a1a1a] mb-1">连接测试</h4>
          <p className="text-xs text-[#9ca3af]">这里不会保存对话，只用来确认本地 AI 接口是否能正常回复。</p>
        </div>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          className="w-full min-h-20 px-3 py-2 bg-[#faf9f7] border border-[#e5e2dd] rounded-lg text-sm resize-y"
          placeholder="输入一句测试消息"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleTestAI()}
            disabled={testing || !testInput.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-[#c87d2f] rounded-lg hover:bg-[#b06d24] disabled:opacity-50 transition-colors"
          >
            {testing ? '测试中...' : '发送测试'}
          </button>
          {testError && <span className="text-xs text-[#dc3545]">{testError}</span>}
        </div>
        {testReply && (
          <div className="rounded-lg border border-[#e5e2dd] bg-[#faf9f7] p-3 text-sm leading-6 text-[#1a1a1a] whitespace-pre-wrap">
            {testReply}
          </div>
        )}
      </div>
    </div>
  );
}
