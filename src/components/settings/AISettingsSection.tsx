import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Save, Trash2, Plus, Pencil, X, RotateCcw } from 'lucide-react';
import { useAIStore } from '../../stores';
import { buildAIRequestSystemPrompt, DEFAULT_PROMPT_TEMPLATES } from '../../lib/aiPromptDefaults';
import {
  ApiError,
  MASKED_SECRET,
  fetchAssistantLlmHealth,
  fetchAssistantModels,
  fetchAssistantRuntimeSettings,
  saveAssistantRuntimeSettings,
  testAssistantConnection,
  type AssistantLlmHealth,
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

/** 把异常拆成「主文案 + request_id」，request_id 只放小字，不占主位。 */
function describeError(err: unknown, fallback: string): { text: string; requestId?: string } {
  if (err instanceof ApiError) return { text: err.message, requestId: err.requestId };
  if (err instanceof Error) return { text: err.message };
  return { text: fallback };
}

function modelListUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/models');
  if (trimmed.endsWith('/chat/completions')) return trimmed.replace(/\/chat\/completions$/, '/models');
  if (trimmed.endsWith('/v1')) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
}

/** 后端跑在容器里：localhost 指的是容器自己，写它必然连不上。 */
function localHostWarning(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';
  try {
    const host = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
      return '后端在容器里，容器内的 localhost 是容器自己而不是你的电脑。本地模型请改成 host.docker.internal 加端口（例如 http://host.docker.internal:1234/v1）。';
    }
  } catch {
    return '';
  }
  return '';
}

/** localhost / 127.0.0.1 → host.docker.internal，端口和路径原样保留。 */
function toDockerHostUrl(baseUrl: string): string {
  try {
    const withScheme = baseUrl.trim().includes('://') ? baseUrl.trim() : `http://${baseUrl.trim()}`;
    const parsed = new URL(withScheme);
    parsed.hostname = 'host.docker.internal';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return baseUrl;
  }
}

type Target = 'local' | 'external';

export function AISettings() {
  const systemPrompt = useAIStore((s) => s.systemPrompt);
  const promptTemplates = useAIStore((s) => s.promptTemplates);
  const activeTemplateId = useAIStore((s) => s.activeTemplateId);
  const updateTemplate = useAIStore((s) => s.updateTemplate);
  const addTemplate = useAIStore((s) => s.addTemplate);
  const removeTemplate = useAIStore((s) => s.removeTemplate);
  const setActiveTemplateId = useAIStore((s) => s.setActiveTemplateId);
  const setEndpoint = useAIStore((s) => s.setEndpoint);
  const setModel = useAIStore((s) => s.setModel);
  const setSystemPrompt = useAIStore((s) => s.setSystemPrompt);
  const [form, setForm] = useState<AssistantRuntimeSettingsDto>(emptySettings);
  const [draftSystemPrompt, setDraftSystemPrompt] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState('');
  const [statusRequestId, setStatusRequestId] = useState('');
  const [loading, setLoading] = useState(false);
  const [testInput, setTestInput] = useState('你好，简单回复一句，说明你已经连接成功。');
  const [testTarget, setTestTarget] = useState<Target>('local');
  const [testReply, setTestReply] = useState('');
  const [testError, setTestError] = useState('');
  const [testErrorRequestId, setTestErrorRequestId] = useState('');
  const [testing, setTesting] = useState(false);
  const [modelOptions, setModelOptions] = useState<Record<Target, string[]>>({ local: [], external: [] });
  const [modelLoading, setModelLoading] = useState<Target | null>(null);
  const [modelError, setModelError] = useState<Record<Target, string>>({ local: '', external: '' });
  const [modelErrorRequestId, setModelErrorRequestId] = useState<Record<Target, string>>({ local: '', external: '' });
  const [modelHint, setModelHint] = useState<Record<Target, string>>({ local: '', external: '' });
  // 后端 GET 返回的是掩码占位而不是明文。输入框留空 + placeholder 提示「已保存」，
  // 保存时把占位原样回传表示「不修改」；用户重新输入才覆盖。
  const [storedKeys, setStoredKeys] = useState<Record<Target, boolean>>({ local: false, external: false });
  const [keyTouched, setKeyTouched] = useState<Record<Target, boolean>>({ local: false, external: false });
  const [activeConfig, setActiveConfig] = useState<AssistantLlmHealth | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const activeTemplate = promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0];

  const updateForm = (updates: Partial<AssistantRuntimeSettingsDto>) => {
    setForm((current) => ({ ...current, ...updates }));
    setStatus('有未保存的灵境小助手设置。');
  };

  const refreshActiveConfig = useCallback(async () => {
    try {
      setActiveConfig(await fetchAssistantLlmHealth());
    } catch {
      // 自检失败不影响主流程，页面上少一行信息而已
      setActiveConfig(null);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setStatus('');
    setStatusRequestId('');
    try {
      const data = await fetchAssistantRuntimeSettings();
      const localKeyStored = Boolean(data.local_api_key);
      const externalKeyStored = Boolean(data.external_api_key);
      setStoredKeys({ local: localKeyStored, external: externalKeyStored });
      setKeyTouched({ local: false, external: false });
      // 掩码占位不进输入框：密码框里显示一串 "__MASKED__" 只会让人以为 key 就是这个
      setForm({
        ...data,
        local_api_key: data.local_api_key === MASKED_SECRET ? '' : data.local_api_key,
        external_api_key: data.external_api_key === MASKED_SECRET ? '' : data.external_api_key,
      });
      setEndpoint(data.local_base_url);
      setModel(data.local_model);
      setModelOptions({ local: [], external: [] });
      setModelError({ local: '', external: '' });
      setModelErrorRequestId({ local: '', external: '' });
      setModelHint({ local: '', external: '' });
      // 顺手读一次「实际生效」配置，让用户能确认保存有没有被吃到
      void refreshActiveConfig();
    } catch (err) {
      const info = describeError(err, '读取后端灵境小助手设置失败。');
      setStatus(`读取后端灵境小助手设置失败：${info.text}`);
      setStatusRequestId(info.requestId ?? '');
    } finally {
      setLoading(false);
    }
  }, [setEndpoint, setModel, refreshActiveConfig]);

  useEffect(() => {
    setDraftSystemPrompt(systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const scanModels = async (target: Target) => {
    const baseUrl = target === 'local' ? form.local_base_url : form.external_base_url;
    // 掩码占位不发出去：后端会按地址自动用库里存的 key
    const apiKey = (target === 'local' ? form.local_api_key : form.external_api_key) || '';
    if (modelLoading) return;
    if (!baseUrl.trim()) {
      setModelError((current) => ({ ...current, [target]: '请先填写接口地址，再扫描模型。' }));
      setModelErrorRequestId((current) => ({ ...current, [target]: '' }));
      return;
    }

    setModelLoading(target);
    setModelError((current) => ({ ...current, [target]: '' }));
    setModelErrorRequestId((current) => ({ ...current, [target]: '' }));
    setModelHint((current) => ({ ...current, [target]: '' }));
    const url = modelListUrl(baseUrl);
    try {
      const unique = await fetchAssistantModels(baseUrl, apiKey);
      setModelOptions((current) => ({ ...current, [target]: unique }));
      if (unique.length === 0) {
        setModelError((current) => ({ ...current, [target]: `${url} 能打开，但里面没有模型。本地服务通常是模型还没加载完。` }));
      } else {
        setModelHint((current) => ({ ...current, [target]: `从 ${url} 扫到 ${unique.length} 个模型。` }));
        if (!(target === 'local' ? form.local_model : form.external_model)) {
          updateForm(target === 'local' ? { local_model: unique[0] } : { external_model: unique[0] });
        }
      }
    } catch (err) {
      const info = describeError(err, '扫描模型失败。');
      setModelOptions((current) => ({ ...current, [target]: [] }));
      setModelError((current) => ({ ...current, [target]: info.text }));
      setModelErrorRequestId((current) => ({ ...current, [target]: info.requestId ?? '' }));
    } finally {
      setModelLoading(null);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setStatusRequestId('');
    // 没动过的 key 回传掩码占位，让后端保留库里那份真值；
    // 只有用户真的编辑过才覆盖（清空也代表清空，是有意的）
    const payload: AssistantRuntimeSettingsDto = {
      ...form,
      local_api_key: keyTouched.local ? form.local_api_key : storedKeys.local ? MASKED_SECRET : form.local_api_key,
      external_api_key: keyTouched.external ? form.external_api_key : storedKeys.external ? MASKED_SECRET : form.external_api_key,
    };
    try {
      const savedSettings = await saveAssistantRuntimeSettings(payload);
      setStoredKeys({
        local: Boolean(savedSettings.local_api_key),
        external: Boolean(savedSettings.external_api_key),
      });
      setKeyTouched({ local: false, external: false });
      setForm({
        ...savedSettings,
        local_api_key: savedSettings.local_api_key === MASKED_SECRET ? '' : savedSettings.local_api_key,
        external_api_key: savedSettings.external_api_key === MASKED_SECRET ? '' : savedSettings.external_api_key,
      });
      setEndpoint(savedSettings.local_base_url);
      setModel(savedSettings.local_model);
      setSystemPrompt(draftSystemPrompt);
      window.dispatchEvent(new Event('p2m:assistant-settings-changed'));
      // 读回「实际生效」的配置：保存成功不等于生效，这里能当场看见
      await refreshActiveConfig();
      playInteractionSound('save');
      setSaved(true);
      setStatus('灵境小助手设置已保存。');
      setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      playInteractionSound('error');
      const info = describeError(err, '保存失败。');
      setStatus(`保存失败：${info.text}`);
      setStatusRequestId(info.requestId ?? '');
    } finally {
      setLoading(false);
    }
  };

  const clearExternal = () => {
    updateForm({ external_base_url: '', external_api_key: '', external_model: '' });
    setKeyTouched((current) => ({ ...current, external: true }));
    setModelOptions((current) => ({ ...current, external: [] }));
    setModelError((current) => ({ ...current, external: '' }));
    setModelErrorRequestId((current) => ({ ...current, external: '' }));
    setModelHint((current) => ({ ...current, external: '' }));
  };

  const handleTestAI = async () => {
    const text = testInput.trim();
    if (!text || testing) return;
    const isExternal = testTarget === 'external';
    const baseUrl = isExternal ? form.external_base_url : form.local_base_url;
    const apiKey = (isExternal ? form.external_api_key : form.local_api_key) || '';
    const model = isExternal ? form.external_model : form.local_model;
    setTesting(true);
    setTestReply('');
    setTestError('');
    setTestErrorRequestId('');
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
      const info = describeError(err, '测试请求失败。');
      setTestError(info.text);
      setTestErrorRequestId(info.requestId ?? '');
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
    const hostWarning = localHostWarning(form[baseKey]);

    return (
      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{isLocal ? 'LM Studio / 本地 OpenAI 兼容服务。' : '网络 OpenAI 兼容服务，用于兜底或优先处理。'}</p>
          </div>
          {!isLocal && (
            <button type="button" onClick={clearExternal} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--danger)] hover:bg-[var(--danger-bg)]" title="清空外部 LLM 设置">
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="grid gap-3">
          <div>
            <label htmlFor={`ai-${target}-base`} className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">接口地址</label>
            <input id={`ai-${target}-base`}
              value={form[baseKey]}
              onChange={(e) => updateForm({ [baseKey]: e.target.value } as Partial<AssistantRuntimeSettingsDto>)}
              className="w-full rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-sm"
              placeholder={isLocal ? 'http://host.docker.internal:1234/v1' : 'https://example.com/v1'}
            />
            {hostWarning && (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-[var(--warn)]">{hostWarning}</p>
                <button
                  type="button"
                  onClick={() => updateForm({ [baseKey]: toDockerHostUrl(form[baseKey]) } as Partial<AssistantRuntimeSettingsDto>)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  一键改成 {toDockerHostUrl(form[baseKey])}
                </button>
              </div>
            )}
          </div>
          <div>
            <label htmlFor={`ai-${target}-key`} className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">API Key</label>
            <input id={`ai-${target}-key`}
              type="password"
              value={form[apiKey]}
              onChange={(e) => {
                setKeyTouched((current) => ({ ...current, [target]: true }));
                updateForm({ [apiKey]: e.target.value } as Partial<AssistantRuntimeSettingsDto>);
              }}
              className="w-full rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-sm"
              placeholder={storedKeys[target] ? '已保存，留空表示不修改' : isLocal ? 'lm-studio（可不填）' : '外部服务 API Key'}
            />
            {storedKeys[target] && !keyTouched[target] && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">已保存密钥（出于安全不回显），要替换请直接输入新的。</p>
            )}
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-[var(--text-secondary)]">模型名</label>
              <button
                type="button"
                onClick={() => void scanModels(target)}
                disabled={modelLoading !== null || !form[baseKey].trim()}
                className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-50"
                title={modelListUrl(form[baseKey]) || '先填接口地址'}
              >
                <RefreshCw size={12} className={modelLoading === target ? 'animate-spin' : ''} />
                {modelLoading === target ? '扫描中…' : '扫描模型'}
              </button>
            </div>
            <select
              value={form[modelKey]}
              onChange={(e) => updateForm({ [modelKey]: e.target.value } as Partial<AssistantRuntimeSettingsDto>)}
              className="w-full rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-sm"
            >
              {form[modelKey] && !options.includes(form[modelKey]) && <option value={form[modelKey]}>{form[modelKey]}</option>}
              {!form[modelKey] && <option value="">请选择模型</option>}
              {options.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {modelListUrl(form[baseKey]) && <p className="mt-1 text-xs text-[var(--text-muted)]">模型列表：<code>{modelListUrl(form[baseKey])}</code></p>}
            {modelHint[target] && <p className="mt-1 text-xs text-[var(--success)]">{modelHint[target]}</p>}
            {modelError[target] && <p className="mt-1 text-xs leading-5 text-[var(--danger)]">{modelError[target]}</p>}
            {modelErrorRequestId[target] && (
              <p className="mt-0.5 text-[10px] text-[var(--text-muted)]" title="反馈问题时附上这个 ID，可在后端日志里查到完整堆栈">
                请求 ID：{modelErrorRequestId[target]}
              </p>
            )}
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

      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3">
        <label htmlFor="f-76ae17" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">兜底方案</label>
        <select id="f-76ae17"
          value={form.llm_usage_policy}
          onChange={(e) => updateForm({ llm_usage_policy: e.target.value as LlmUsagePolicy })}
          className="w-full rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-sm"
        >
          {POLICY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <p className="mt-1 text-xs text-[var(--text-muted)]">影响灵境小助手对话、视频总结和字幕校对。保存后新请求生效。</p>
      </div>

      <div>
        <label htmlFor="f-cbdb6b" className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">系统提示词</label>
        <textarea id="f-cbdb6b" value={draftSystemPrompt} onChange={(e) => setDraftSystemPrompt(e.target.value)} className="min-h-24 w-full resize-y rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2 text-sm" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void handleSave()} disabled={loading} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#b06d24] disabled:opacity-50">
          <Save size={14} /> 保存小助手设置
        </button>
        <button onClick={() => void loadSettings()} disabled={loading} className="flex items-center gap-1.5 rounded-lg border border-[var(--border-light)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新读取
        </button>
        {saved && <span className="text-xs text-[var(--success)]">已保存</span>}
        {status && <span className="text-xs text-[var(--accent)]">{status}</span>}
        {statusRequestId && (
          <span className="text-[10px] text-[var(--text-muted)]" title="反馈问题时附上这个 ID">请求 ID：{statusRequestId}</span>
        )}
      </div>

      {activeConfig && (
        <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-base)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
          <p className="mb-1 font-medium text-[var(--text-primary)]">当前实际生效（保存后以此为准）</p>
          <p>
            兜底方案：
            {POLICY_OPTIONS.find((item) => item.value === activeConfig.policy)?.label ?? activeConfig.policy}
          </p>
          <p>
            外部：{activeConfig.external.base_url || '未填写'} / {activeConfig.external.model || '未选模型'}
            {activeConfig.external.configured ? '' : '（配置不完整）'}
          </p>
          <p>
            本地：{activeConfig.local.base_url || '未填写'} / {activeConfig.local.model || '未选模型'}
            {activeConfig.local.configured ? '' : '（配置不完整）'}
          </p>
          <button
            type="button"
            onClick={() => void refreshActiveConfig()}
            className="mt-1 text-[var(--accent)] hover:underline"
          >
            刷新
          </button>
        </div>
      )}

      <div className="border-t border-[var(--border-light)] pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-medium text-[var(--text-primary)]">提示词模板</h4>
          <button
            type="button"
            onClick={addTemplate}
            className="inline-flex items-center gap-1 rounded-lg bg-[var(--success)] px-2.5 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#15803d]"
          >
            <Plus className="h-3.5 w-3.5" />
            新建模板
          </button>
        </div>

        <div className="space-y-2">
          {promptTemplates.map((template) => {
            const isActive = activeTemplateId === template.id;
            const isEditing = editingId === template.id;
            return (
              <div
                key={template.id}
                className={`rounded-lg border p-3 transition-colors ${
                  isActive
                    ? 'border-[#16a34a] bg-[var(--success-bg)]'
                    : 'border-[var(--border-medium)] bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 rounded-lg border border-[var(--border-medium)] px-2 py-1 text-sm outline-none focus:border-[#16a34a]"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveTemplateId(template.id)}
                      className="flex-1 text-left text-sm font-medium text-[#292524] hover:text-[var(--success)]"
                    >
                      {template.name}
                      {isActive && (
                        <span className="ml-2 text-xs text-[var(--success)]">(当前)</span>
                      )}
                    </button>
                  )}

                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            updateTemplate(template.id, { name: editName, content: editContent });
                            setEditingId(null);
                          }}
                          className="rounded-lg p-1 text-[var(--success)] hover:bg-[#dcfce7]"
                          title="保存"
                        >
                          <Save className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
                          title="取消"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(template.id);
                            setEditName(template.name);
                            setEditContent(template.content);
                          }}
                          className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-base)]"
                          title="编辑"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {promptTemplates.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeTemplate(template.id)}
                            className="rounded-lg p-1 text-[#dc2626] hover:bg-red-50"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={6}
                    className="mt-2 w-full rounded-lg border border-[var(--border-medium)] bg-white px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-[#16a34a]"
                    placeholder="在这里写提示词模板内容..."
                  />
                )}

                {!isEditing && (
                  <div className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                    {template.content}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            const confirmed = window.confirm('确定重置为默认提示词模板吗？所有自定义模板将被清除。');
            if (!confirmed) return;
            const defaultIds = new Set(DEFAULT_PROMPT_TEMPLATES.map((t) => t.id));
            promptTemplates.forEach((t) => {
              if (!defaultIds.has(t.id)) removeTemplate(t.id);
            });
            DEFAULT_PROMPT_TEMPLATES.forEach((t) => {
              updateTemplate(t.id, { name: t.name, content: t.content });
            });
            if (!defaultIds.has(activeTemplateId) && DEFAULT_PROMPT_TEMPLATES.length > 0) {
              setActiveTemplateId(DEFAULT_PROMPT_TEMPLATES[0].id);
            }
          }}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[#e7e5e4]"
        >
          <RotateCcw className="h-4 w-4" />
          重置为默认模板
        </button>
      </div>

      <div className="space-y-3 border-t border-[var(--border-light)] pt-4">
        <div>
          <h4 className="mb-1 text-sm font-medium text-[var(--text-primary)]">连接测试</h4>
          <p className="text-xs text-[var(--text-muted)]">这里不会保存对话，只用来确认所选接口是否能正常回复。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={testTarget} onChange={(e) => setTestTarget(e.target.value as Target)} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2 text-sm">
            <option value="local">测试本地 LLM</option>
            <option value="external">测试外部 LLM</option>
          </select>
        </div>
        <textarea
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
          className="min-h-20 w-full resize-y rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
          placeholder="输入一句测试消息"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleTestAI()}
            disabled={testing || !testInput.trim()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#b06d24] disabled:opacity-50"
          >
            {testing ? '测试中...' : '发送测试'}
          </button>
          {testError && <span className="text-xs text-[var(--danger)]">{testError}</span>}
        </div>
        {testErrorRequestId && (
          <p className="text-[10px] text-[var(--text-muted)]" title="反馈问题时附上这个 ID">请求 ID：{testErrorRequestId}</p>
        )}
        {testReply && (
          <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] p-3 text-sm leading-6 text-[var(--text-primary)]">
            {testReply}
          </div>
        )}
      </div>
    </div>
  );
}
