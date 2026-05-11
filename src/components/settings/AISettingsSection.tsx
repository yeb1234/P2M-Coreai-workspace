import { useEffect, useState } from 'react';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { useAIStore } from '../../stores';
import { buildAIRequestSystemPrompt } from '../../lib/aiPromptDefaults';
import {
  fetchAssistantModels,
  fetchAssistantRuntimeSettings,
  saveAssistantRuntimeSettings,
  testAssistantConnection,
  type AssistantRuntimeSettingsDto,
  type LlmUsagePolicy,
} from '../../lib/videoApi';
import { playInteractionSound } from '../../lib/sounds';

const POLICY_OPTIONS: Array<{ value: LlmUsagePolicy; label: string }> = [
  { value: 'local_first', label: '先本地，失败后外部' },
  { value: 'external_first', label: '先外部，失败后本地' },
  { value: 'local_only', label: '只用本地' },
  { value: 'external_only', label: '只用外部' },
];

function emptySettings(): AssistantRuntimeSettingsDto {
  return {
    local_base_url: '',
    local_api_key: '',
    local_model: '',
    external_base_url: '',
    external_api_key: '',
    external_model: '',
    llm_usage_policy: 'local_first',
  };
}

function modelListUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/models');
  if (trimmed.endsWith('/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/models');
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

type Target = 'local' | 'external';

export function AISettings() {
  const systemPrompt = useAIStore((s) => s.systemPrompt);
  const promptTemplates = useAIStore((s) => s.promptTemplates);
  const activeTemplateId = useAIStore((s) => s.activeTemplateId);
  const setEndpoint = useAIStore((s) => s.setEndpoint);
  const setModel = useAIStore((s) => s.setModel);
  const setSystemPrompt = useAIStore((s) => s.setSystemPrompt);
  const [form, setForm] = useState<AssistantRuntimeSettingsDto>(emptySettings);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [testInput, setTestInput] = useState('你好，简单回复一句，说明你已经连接成功。');
  const [testTarget, setTestTarget] = useState<Target>('local');
  const [testReply, setTestReply] = useState('');
  const [testError, setTestError] = useState('');
  const [testing, setTesting] = useState(false);
  const [modelOptions, setModelOptions] = useState<Record<Target, string[]>>({ local: [], external: [] });
  const [modelLoading, setModelLoading] = useState<Target | null>(null);
  const [modelError, setModelError] = useState<Record<Target, string>>({ local: '', external: '' });
  const activeTemplate = promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0];

  useEffect(() => {
    setDraftSystemPrompt(systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    void loadSettings();
  }, []);

  const updateForm = (updates: Partial<AssistantRuntimeSettingsDto>) => {
    setForm((current) => ({ ...current, ...updates }));
      setStatus('有未保存的灵境小助手设置。');
  };

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await fetchAssistantRuntimeSettings();
      setForm(data);
      setEndpoint(data.local_base_url);
      setModel(data.local_model);
      setStatus('');
    } catch (err) {
      setStatus(err instanceof Error ? `读取后端灵境小助手设置失败：${err.message}` : '读取后端灵境小助手设置失败。');
    } finally {
      setLoading(false);
    }
  };

  const scanModels = async (target: Target) => {
    const baseUrl = target === 'local' ? form.local_base_url : form.external_base_url;
    const apiKey = target === 'local' ? form.local_api_key : form.external_api_key;
    if (!baseUrl.trim() || modelLoading) return;
    setModelLoading(target);
    setModelError((current) => ({ ...current, [target]: '' }));
    try {
      const unique = await fetchAssistantModels(baseUrl, apiKey);
      setModelOptions((current) => ({ ...current, [target]: unique }));
      if (unique.length === 0) {
        setModelError((current) => ({ ...current, [target]: '没有扫描到模型。' }));
      } else if (!(target === 'local' ? form.local_model : form.external_model)) {
        updateForm(target === 'local' ? { local_model: unique[0] } : { external_model: unique[0] });
      }
    } catch (err) {
      setModelOptions((current) => ({ ...current, [target]: [] }));
      setModelError((current) => ({ ...current, [target]: err instanceof Error ? err.message : '扫描模型失败。' }));
    } finally {
      setModelLoading(null);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const savedSettings = await saveAssistantRuntimeSettings(form);
      setForm(savedSettings);
      setEndpoint(savedSettings.local_base_url);
      setModel(savedSettings.local_model);
      setSystemPrompt(draftSystemPrompt);
      window.dispatchEvent(new Event('p2m:assistant-settings-changed'));
      playInteractionSound('save');
      setSaved(true);
      setStatus('灵境小助手设置已保存到后端。');
      setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      playInteractionSound('error');
      setStatus(err instanceof Error ? `保存失败：${err.message}` : '保存失败。');
    } finally {
      setLoading(false);
    }
  };

  const clearExternal = () => {
    updateForm({ external_base_url: '', external_api_key: '', external_model: '' });
    setModelOptions((current) => ({ ...current, external: [] }));
    setModelError((current) => ({ ...current, external: '' }));
  };

  const handleTestAI = async () => {
    const text = testInput.trim();
    if (!text || testing) return;
    const isExternal = testTarget === 'external';
    const baseUrl = isExternal ? form.external_base_url : form.local_base_url;
    const apiKey = isExternal ? form.external_api_key : form.local_api_key;
    const model = isExternal ? form.external_model : form.local_model;
    setTesting(true);
    setTestReply('');
    setTestError('');
    try {
      const data = await testAssistantConnection({
        baseUrl,
        apiKey,
        model,
        message: text,
        systemPrompt: buildAIRequestSystemPrompt(draftSystemPrompt, activeTemplate?.content ?? ''),
      });
      playInteractionSound('success');
      setTestReply(data.answer?.trim() || '灵境小助手已返回，但没有可显示的文本。');
    } catch (err) {
      playInteractionSound('error');
      setTestError(err instanceof Error ? err.message : '测试请求失败。');
    } finally {
      setTesting(false);
    }
  };

  const renderEndpointGroup = (target: Target) => {
    const isLocal = target === 'local';
    const title = isLocal ? '本地 LLM' : '外部 LLM';
    const baseKey = isLocal ? 'local_base_url' : 'external_base_url';
    const apiKey = isLocal ? 'local_api_key' : 'external_api_key';
    const modelKey = isLocal ? 'local_model' : 'external_model';
    const options = modelOptions[target];

    return (
      <div className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[#1a1a1a]">{title}</p>
            <p className="mt-0.5 text-[11px] text-[#8a8178]">{isLocal ? 'LM Studio / 本地 OpenAI 兼容服务。' : '网络 OpenAI 兼容服务，用于兜底或优先处理。'}</p>
          </div>
          {!isLocal && (
            <button type="button" onClick={clearExternal} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#dc3545] hover:bg-[#fef2f2]" title="清空外部 LLM 设置">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="grid gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#6b7280]">接口地址</label>
            <input
              value={form[baseKey]}
              onChange={(e) => updateForm({ [baseKey]: e.target.value } as Partial<AssistantRuntimeSettingsDto>)}
              className="w-full rounded-lg border border-[#e5e2dd] bg-white px-3 py-2 text-sm"
              placeholder={isLocal ? 'http://127.0.0.1:1234/v1' : 'https://example.com/v1'}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#6b7280]">API Key</label>
            <input
              type="password"
              value={form[apiKey]}
              onChange={(e) => updateForm({ [apiKey]: e.target.value } as Partial<AssistantRuntimeSettingsDto>)}
              className="w-full rounded-lg border border-[#e5e2dd] bg-white px-3 py-2 text-sm"
              placeholder={isLocal ? 'lm-studio' : '外部服务 API Key'}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-[#6b7280]">模型名</label>
              <button
                type="button"
                onClick={() => void scanModels(target)}
                disabled={modelLoading !== null || !form[baseKey].trim()}
                className="inline-flex items-center gap-1 text-xs text-[#6b7280] hover:text-[#c87d2f] disabled:opacity-50"
                title={modelListUrl(form[baseKey])}
              >
                <RefreshCw size={12} className={modelLoading === target ? 'animate-spin' : ''} />
                扫描模型
              </button>
            </div>
            <select
              value={form[modelKey]}
              onChange={(e) => updateForm({ [modelKey]: e.target.value } as Partial<AssistantRuntimeSettingsDto>)}
              className="w-full rounded-lg border border-[#e5e2dd] bg-white px-3 py-2 text-sm"
            >
              {form[modelKey] && !options.includes(form[modelKey]) && <option value={form[modelKey]}>{form[modelKey]}</option>}
              {!form[modelKey] && <option value="">请选择模型</option>}
              {options.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {modelListUrl(form[baseKey]) && <p className="mt-1 text-[10px] text-[#9ca3af]">模型列表：<code>{modelListUrl(form[baseKey])}</code></p>}
            {modelError[target] && <p className="mt-1 text-[10px] text-[#dc3545]">{modelError[target]}</p>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="auto-grid-wide">
        {renderEndpointGroup('local')}
        {renderEndpointGroup('external')}
      </div>

      <div className="rounded-xl border border-[#e5e2dd] bg-[#faf9f7] p-3">
        <label className="mb-1.5 block text-xs font-medium text-[#6b7280]">兜底方案</label>
        <select
          value={form.llm_usage_policy}
          onChange={(e) => updateForm({ llm_usage_policy: e.target.value as LlmUsagePolicy })}
          className="w-full rounded-lg border border-[#e5e2dd] bg-white px-3 py-2 text-sm"
        >
          {POLICY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <p className="mt-1 text-[10px] text-[#9ca3af]">影响灵境小助手对话、视频总结和字幕校对。保存后新请求生效。</p>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-[#6b7280]">系统提示词</label>
        <textarea value={draftSystemPrompt} onChange={(e) => setDraftSystemPrompt(e.target.value)} className="min-h-24 w-full resize-y rounded-lg border border-[#e5e2dd] bg-[#faf9f7] px-3 py-2 text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void handleSave()} disabled={loading} className="flex items-center gap-1.5 rounded-lg bg-[#c87d2f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#b06d24] disabled:opacity-50">
          <Save size={14} /> 保存小助手设置
        </button>
        <button onClick={() => void loadSettings()} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-[#e5e2dd] px-4 py-2 text-sm font-medium text-[#5f5a52] transition-colors hover:border-[#c87d2f] hover:text-[#c87d2f] disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新读取
        </button>
        {saved && <span className="text-xs text-[#16a34a]">已保存</span>}
        {status && <span className="text-xs text-[#c87d2f]">{status}</span>}
      </div>

      <div className="border-t border-[#e5e2dd] pt-4">
        <h4 className="mb-2 text-sm font-medium text-[#1a1a1a]">当前提示词模板</h4>
        {activeTemplate ? (
          <div className="rounded-lg border border-[#e5e2dd] bg-[#faf9f7] p-3">
            <p className="text-sm font-medium text-[#1a1a1a]">{activeTemplate.name}</p>
            <p className="mt-1 whitespace-pre-wrap text-xs text-[#6b7280]">{activeTemplate.content}</p>
          </div>
        ) : (
          <p className="text-xs text-[#9ca3af]">暂无模板</p>
        )}
      </div>

      <div className="space-y-3 border-t border-[#e5e2dd] pt-4">
        <div>
          <h4 className="mb-1 text-sm font-medium text-[#1a1a1a]">连接测试</h4>
          <p className="text-xs text-[#9ca3af]">这里不会保存对话，只用来确认所选接口是否能正常回复。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={testTarget} onChange={(e) => setTestTarget(e.target.value as Target)} className="rounded-lg border border-[#e5e2dd] bg-[#faf9f7] px-3 py-2 text-sm">
            <option value="local">测试本地 LLM</option>
            <option value="external">测试外部 LLM</option>
          </select>
        </div>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          className="min-h-20 w-full resize-y rounded-lg border border-[#e5e2dd] bg-[#faf9f7] px-3 py-2 text-sm"
          placeholder="输入一句测试消息"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleTestAI()}
            disabled={testing || !testInput.trim()}
            className="rounded-lg bg-[#c87d2f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#b06d24] disabled:opacity-50"
          >
            {testing ? '测试中...' : '发送测试'}
          </button>
          {testError && <span className="text-xs text-[#dc3545]">{testError}</span>}
        </div>
        {testReply && (
          <div className="whitespace-pre-wrap rounded-lg border border-[#e5e2dd] bg-[#faf9f7] p-3 text-sm leading-6 text-[#1a1a1a]">
            {testReply}
          </div>
        )}
      </div>
    </div>
  );
}
