import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Brain,
  Code,
  Database,
  FileText,
  GitBranch,
  Globe,
  Info,
  Layers,
  ListChecks,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { PageTitle } from '../shared';
import { useAIStore } from '../../stores';
import { apiFetch } from '../../lib/videoApi';
import {
  ASSISTANT_INTENTS,
  INTENT_PRIORITY,
  PAGE_CONTEXT_FEATURES,
  MCP_NATIVE_TOOLS,
  MCP_TOTAL_SNAPSHOT,
  RUNTIME_PROMPT_LAYERS,
  SKILL_SNAPSHOT,
  TOOL_LABELS,
  TOOL_SNAPSHOT,
  type AssistantToolSnapshot,
} from '../../data/assistantCapabilities';

const SCENE_AGENTS = [
  { name: '代码助手', desc: '代码生成、审查、重构、调试', icon: <Code size={18} />, color: 'text-[#8b5cf6]' },
  { name: '知识检索', desc: '联网搜索、文档总结、问答', icon: <Globe size={18} />, color: 'text-[var(--info)]' },
  { name: '数据分析', desc: '数据清洗、可视化、洞察报告', icon: <Database size={18} />, color: 'text-[var(--success)]' },
  { name: '创意写作', desc: '文案、邮件、文档、翻译', icon: <Sparkles size={18} />, color: 'text-[#ec4899]' },
  { name: '逻辑推理', desc: '数学、逻辑、策略分析', icon: <Brain size={18} />, color: 'text-[var(--warn)]' },
  { name: '自动化', desc: '工作流编排、定时任务、API 调用', icon: <Zap size={18} />, color: 'text-[var(--accent)]' },
];

interface CapabilityToolDto extends AssistantToolSnapshot {
  tags?: string[];
  max_retries?: number;
}

interface CapabilitySkillDto {
  name: string;
  version: string;
  description: string;
  intents: string[];
  tools: string[];
  max_total_tool_calls: number;
  enabled?: boolean;
}

interface CapabilityResponse {
  base_prompt?: string;
  tools: CapabilityToolDto[];
  skills: CapabilitySkillDto[];
}

interface McpToolDto {
  name: string;
  description: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

interface McpManifest {
  tools: McpToolDto[];
}

type CapabilitySource = 'loading' | 'live' | 'partial' | 'snapshot';

const INITIAL_CAPABILITIES: CapabilityResponse = {
  tools: TOOL_SNAPSHOT,
  skills: SKILL_SNAPSHOT,
};

function intentNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export const AIAgentPage: React.FC = () => {
  const {
    systemPrompt, setSystemPrompt,
    promptTemplates, activeTemplateId, setActiveTemplateId, updateTemplate, addTemplate, setChatOpen,
  } = useAIStore();
  const activeTemplate = promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0];

  const [capabilities, setCapabilities] = useState<CapabilityResponse>(INITIAL_CAPABILITIES);
  const [mcpTools, setMcpTools] = useState<McpToolDto[]>([]);
  const [capabilitySource, setCapabilitySource] = useState<CapabilitySource>('loading');
  const [capabilityError, setCapabilityError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoaded, setLastLoaded] = useState('');

  const loadCapabilities = useCallback(async () => {
    setRefreshing(true);
    let errorMessage = '';
    const [capsResult, mcpResult] = await Promise.allSettled([
      apiFetch<CapabilityResponse>('/api/assistant/capabilities', { timeoutMs: 15000 }),
      apiFetch<McpManifest>('/api/mcp/tools', { timeoutMs: 15000 }),
    ]);

    let capsOk = false;
    let mcpOk = false;
    if (capsResult.status === 'fulfilled' && Array.isArray(capsResult.value.tools) && Array.isArray(capsResult.value.skills)) {
      setCapabilities(capsResult.value);
      capsOk = true;
    } else if (capsResult.status === 'rejected') {
      errorMessage = capsResult.reason instanceof Error ? capsResult.reason.message : '能力注册表读取失败';
    }

    if (mcpResult.status === 'fulfilled' && Array.isArray(mcpResult.value.tools)) {
      setMcpTools(mcpResult.value.tools);
      mcpOk = true;
    } else if (mcpResult.status === 'rejected' && !errorMessage) {
      errorMessage = mcpResult.reason instanceof Error ? mcpResult.reason.message : 'MCP 清单读取失败';
    }

    setCapabilityError(errorMessage);
    setCapabilitySource(capsOk && mcpOk ? 'live' : capsOk || mcpOk ? 'partial' : 'snapshot');
    setLastLoaded(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void loadCapabilities();
  }, [loadCapabilities]);

  const skillByName = useMemo(
    () => new Map(capabilities.skills.map((skill) => [skill.name, skill])),
    [capabilities.skills],
  );

  const skillByIntent = useMemo(() => {
    const map = new Map<string, CapabilitySkillDto>();
    for (const skill of capabilities.skills) {
      for (const intent of skill.intents) map.set(intent, skill);
    }
    return map;
  }, [capabilities.skills]);

  const intentRows = useMemo(
    () => ASSISTANT_INTENTS.map((intent) => ({
      intent,
      skill: skillByIntent.get(intent.id) ?? skillByName.get(intent.skill),
    })),
    [skillByIntent, skillByName],
  );

  const toolRows = useMemo(() => {
    const map = new Map(capabilities.tools.map((tool) => [tool.name, tool]));
    const ordered = TOOL_SNAPSHOT.map((tool) => tool.name);
    const extra = capabilities.tools.map((tool) => tool.name).filter((name) => !ordered.includes(name));
    return [...ordered, ...extra].map((name) => map.get(name)).filter((tool): tool is CapabilityToolDto => Boolean(tool));
  }, [capabilities.tools]);

  const nativeMcpRows = useMemo(
    () => MCP_NATIVE_TOOLS.map((copy) => {
      const live = mcpTools.find((tool) => tool.name === copy.name);
      return {
        ...copy,
        title: live?.annotations?.title || copy.title,
        description: live?.description || copy.description,
        readOnly: live?.annotations?.readOnlyHint ?? copy.readOnly,
        destructive: live?.annotations?.destructiveHint ?? copy.destructive,
      };
    }),
    [mcpTools],
  );

  const mcpTotal = mcpTools.length > 0 ? mcpTools.length : MCP_TOTAL_SNAPSHOT;
  const mcpReadOnlyCount = Math.max(0, mcpTotal - MCP_NATIVE_TOOLS.length);

  const sourceLabel =
    capabilitySource === 'loading' ? '读取注册表…'
      : capabilitySource === 'live' ? '后端注册表实时'
        : capabilitySource === 'partial' ? '部分实时'
          : '内置快照';

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="灵境小助手"
        subtitle="统一管理灵境小助手的系统提示词和场景模板"
        icon={<Bot size={22} />}
      />

      <div className="auto-grid-cards">
        {SCENE_AGENTS.map((agent) => (
          <div key={agent.name} className="bg-[var(--bg-card)] border border-[var(--border-light)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={agent.color}>{agent.icon}</span>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{agent.name}</h3>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{agent.desc}</p>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        上面 6 张是场景入口，保留展示。下面开始才是右侧小助手真正接线、真正会调工具的部分。
      </p>

      <section className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <GitBranch size={16} className="text-[var(--accent)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">小助手实际在做什么</h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">
                {capabilitySource === 'live' && <CheckCircle2 size={10} className="text-[var(--success)]" />}
                {sourceLabel}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {capabilities.skills.length} 个能力包 · {capabilities.tools.length} 个 Agent 工具 · {mcpTotal} 个 MCP 工具
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastLoaded && <span className="text-[10px] text-[var(--text-muted)]">更新于 {lastLoaded}</span>}
            <button
              onClick={() => void loadCapabilities()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-light)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
          <span className="rounded-md bg-[var(--bg-card)] px-2 py-1">用户输入</span>
          <ArrowRight size={12} className="text-[var(--text-muted)]" />
          <span className="rounded-md bg-[var(--bg-card)] px-2 py-1">detectIntent() 意图</span>
          <ArrowRight size={12} className="text-[var(--text-muted)]" />
          <span className="rounded-md bg-[var(--bg-card)] px-2 py-1">resolve_skill() 能力包</span>
          <ArrowRight size={12} className="text-[var(--text-muted)]" />
          <span className="rounded-md bg-[var(--bg-card)] px-2 py-1">工具 / 零工具</span>
          <ArrowRight size={12} className="text-[var(--text-muted)]" />
          <span className="rounded-md bg-[var(--bg-card)] px-2 py-1">回答 · 引用 · 写操作</span>
        </div>

        {capabilityError && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/5 px-3 py-2 text-[11px] text-[var(--warn)]">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>实时清单读取失败，当前展示内置快照：{capabilityError}</span>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {intentRows.map(({ intent, skill }, index) => (
            <div key={`${intent.id}-${index}`} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border-light)] bg-[var(--bg-card)] font-mono text-[10px]"
                    style={{ color: intent.accent }}
                  >
                    {intentNumber(index)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{intent.label}</p>
                    <code className="text-[10px] text-[var(--text-muted)]">{intent.id}</code>
                  </div>
                </div>
                {intent.write && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--warn)]/40 px-1.5 py-0.5 text-[9px] text-[var(--warn)]">
                    <Lock size={9} />
                    写操作
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">{intent.summary}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
                触发：{intent.triggers.join(' / ')}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">输出：{intent.output}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {skill?.tools.length ? skill.tools.map((tool) => (
                  <span
                    key={tool}
                    title={tool}
                    className="rounded-md border border-[var(--border-light)] bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--text-secondary)]"
                  >
                    {TOOL_LABELS[tool] ?? tool}
                  </span>
                )) : (
                  <span className="rounded-md border border-[var(--border-light)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                    零工具 · 只用通用知识
                  </span>
                )}
              </div>
              <p className="mt-2 text-[9px] text-[var(--text-muted)]">
                {skill?.name ?? intent.skill} · v{skill?.version ?? '1.0.0'} · 单轮最多 {skill?.max_total_tool_calls ?? 0} 次工具
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ListChecks size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">意图分支优先级</h2>
          <span className="rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
            detectIntent()
          </span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          <code className="text-[var(--text-secondary)]">detectIntent()</code> 是一个按顺序短路的分流器。先判写操作，再判路径、课程和复盘；都不是才走通用问答。下面就是实际顺序，不是产品文案。
        </p>
        <div className="space-y-2">
          {INTENT_PRIORITY.map((rule, index) => (
            <div
              key={`${rule.id}-${index}`}
              className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                rule.id === 'null'
                  ? 'border-dashed border-[var(--border-light)] bg-[var(--bg-hover)]'
                  : 'border-[var(--border-light)] bg-[var(--bg-hover)]'
              }`}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-light)] bg-[var(--bg-card)] font-mono text-[10px] text-[var(--text-muted)]">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-[10px] text-[var(--text-secondary)]">{rule.id}</code>
                  <span className="text-xs font-medium text-[var(--text-primary)]">{rule.label}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">→ {rule.skill}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">{rule.condition}</p>
                {rule.note && <p className="mt-1 text-[10px] leading-relaxed text-[var(--warn)]">{rule.note}</p>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Database size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">页面上下文与功能</h2>
          <span className="rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
            assistantPageContext
          </span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          右侧助手不是只认聊天框。打开这些页面时，它会带上当前对象的状态，再按页面能力回答；没有上下文的页面不会假装知道。
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {PAGE_CONTEXT_FEATURES.map((item) => (
            <div key={item.page} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] px-3 py-2.5">
              <p className="text-xs font-medium text-[var(--text-primary)]">{item.page}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">上下文：{item.context}</p>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">能做：{item.actions}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">对话提示词</p>
            <p className="text-xs text-[var(--text-muted)]">系统提示词和当前模板会一起发送给右侧灵境小助手。</p>
          </div>
          <button
            onClick={addTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-light)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          >
            新建模板
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="f-cbdb6b" className="text-xs font-medium text-[var(--text-secondary)]">系统提示词</label>
            <span className="rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              运行时第 2 层
            </span>
          </div>
          <textarea id="f-cbdb6b"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full min-h-28 text-sm resize-y"
            placeholder="控制 AI 的整体身份、语气、语言和回答边界"
          />
          <div className="flex items-start gap-2 rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
            <Info size={13} className="mt-0.5 shrink-0 text-[var(--info)]" />
            <span>
              这个输入框只是「用户自定义要求」层。右侧助手每一轮实际看到的是基础人设 + 这一层 + 画像、设定、记忆、学习路径、页面上下文和意图规则，完整顺序见下一块。
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {promptTemplates.map((template) => (
            <button
              key={template.id}
              onClick={() => setActiveTemplateId(template.id)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                activeTemplateId === template.id
                  ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
              }`}
            >
              {template.name}
            </button>
          ))}
        </div>

        {activeTemplate && (
          <div className="space-y-2">
            <input
              value={activeTemplate.name}
              onChange={(e) => updateTemplate(activeTemplate.id, { name: e.target.value })}
              className="w-full text-sm"
              placeholder="模板名称"
            />
            <textarea
              value={activeTemplate.content}
              onChange={(e) => updateTemplate(activeTemplate.id, { content: e.target.value })}
              className="w-full min-h-32 text-sm resize-y"
              placeholder="在这里写提示词模板"
            />
          </div>
        )}
      </div>

      <section className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Layers size={16} className="text-[var(--accent)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">运行时实际提示词</h2>
          <span className="rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            8 层拼装
          </span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          右侧助手每一轮不是只拿上面那段提示词。后端会依次拼装下面 8 层，页面上的输入框只是其中第 2 层——这也是为什么页面看起来和真实回答策略不完全是一回事。
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {RUNTIME_PROMPT_LAYERS.map((layer, index) => (
            <div key={layer.title} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--bg-card)] font-mono text-[10px] text-[var(--accent)]">
                  L{index + 1}
                </span>
                <p className="text-xs font-semibold text-[var(--text-primary)]">{layer.title}</p>
                <code className="text-[10px] text-[var(--text-muted)]">{layer.source}</code>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{layer.description}</p>
            </div>
          ))}
        </div>
        {capabilities.base_prompt && (
          <details className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-[var(--text-secondary)]">
              展开后端基础人设 BASE_PROMPT（只读 · {capabilities.base_prompt.length} 字）
            </summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-light)] bg-[var(--bg-card)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">{capabilities.base_prompt}</pre>
          </details>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Wrench size={16} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">真实工具清单</h2>
            <span className="rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              {toolRows.length} 个 · 注册表
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-light)] px-2 py-0.5">
              <ShieldCheck size={10} className="text-[var(--success)]" />
              只读优先
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-light)] px-2 py-0.5">
              <Lock size={10} className="text-[var(--warn)]" />
              写操作有确认
            </span>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          权限 scope、超时、单轮调用上限都是后端 <code>ToolSpec</code> 里的真实值；不是这里编的展示文案。
        </p>
        <div className="overflow-x-auto rounded-lg border border-[var(--border-light)]">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="bg-[var(--bg-hover)] text-[10px] text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">工具</th>
                <th className="px-3 py-2 font-medium">用途</th>
                <th className="px-3 py-2 font-medium">权限</th>
                <th className="px-3 py-2 font-medium">运行约束</th>
              </tr>
            </thead>
            <tbody>
              {toolRows.map((tool) => (
                <tr key={tool.name} className="border-t border-[var(--border-light)]">
                  <td className="px-3 py-2.5 align-top">
                    <p className="font-mono text-[11px] text-[var(--text-primary)]">{tool.name}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{TOOL_LABELS[tool.name] ?? tool.name}</p>
                  </td>
                  <td className="max-w-[360px] px-3 py-2.5 align-top text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {tool.description || '—'}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap gap-1">
                      <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                        tool.read_only
                          ? 'border-[var(--success)]/30 text-[var(--success)]'
                          : 'border-[var(--warn)]/40 text-[var(--warn)]'
                      }`}>
                        {tool.read_only ? '只读' : '写操作'}
                      </span>
                      {tool.requires_login && (
                        <span className="rounded-md border border-[var(--border-light)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                          需登录
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">{tool.scopes.join(' · ')}</p>
                  </td>
                  <td className="px-3 py-2.5 align-top text-[10px] leading-relaxed text-[var(--text-muted)]">
                    <p>{tool.timeout_s}s 超时</p>
                    <p>单轮最多 {tool.max_calls_per_turn} 次</p>
                    {tool.enabled === false && <p className="text-[var(--warn)]">当前未启用</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={16} className="text-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">MCP 出口</h2>
            <span className="rounded-full border border-[var(--border-light)] bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              {mcpTotal} 个工具
            </span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--warn)]/40 px-2 py-0.5 text-[10px] text-[var(--warn)]">
            <Lock size={10} />
            写操作必须 confirm=true
          </span>
        </div>
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          同一套笔记/待办/日程能力也暴露给桌面端和外部客户端：HTTP JSON-RPC 走 <code>POST /api/mcp</code>，本地 stdio 走 <code>scripts/mcp_stdio.py</code>。这里只展开原生 AI/写操作，其余 {mcpReadOnlyCount} 个只读 Agent 工具也会出现在 MCP 清单里。
        </p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {nativeMcpRows.map((tool) => (
            <div key={tool.name} className="rounded-lg border border-[var(--border-light)] bg-[var(--bg-hover)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--text-primary)]">{tool.title}</p>
                  <code className="text-[10px] text-[var(--text-muted)]">{tool.name}</code>
                </div>
                <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] ${
                  tool.readOnly
                    ? 'border-[var(--success)]/30 text-[var(--success)]'
                    : 'border-[var(--warn)]/40 text-[var(--warn)]'
                }`}>
                  {tool.readOnly ? '只读' : '写操作'}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">{tool.description}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] text-[var(--text-muted)]">
          <span className="rounded-md border border-[var(--border-light)] px-2 py-1 font-mono">POST /api/mcp</span>
          <span className="rounded-md border border-[var(--border-light)] px-2 py-1 font-mono">stdio: scripts/mcp_stdio.py</span>
          <span className="rounded-md border border-[var(--border-light)] px-2 py-1">{MCP_NATIVE_TOOLS.length} 个原生 AI/写操作</span>
          <span className="rounded-md border border-[var(--border-light)] px-2 py-1">{mcpReadOnlyCount} 个只读 Agent 工具</span>
        </div>
      </section>

      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] overflow-hidden">
        <div className="p-3 border-b border-[var(--border-light)] flex items-center gap-2">
          <Bot size={14} className="text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">灵境小助手入口</span>
          <span className="text-xs px-1.5 py-0.5 bg-[var(--accent-bg)] text-[var(--accent)] rounded-full ml-auto">LM Studio</span>
        </div>
        <div className="p-4 text-xs text-[var(--text-muted)]">
          点击下面按钮会打开右侧灵境小助手对话栏，直接连接当前配置的模型服务。
        </div>
        <div className="p-3 border-t border-[var(--border-light)]">
          <div className="flex justify-end">
            <button
              onClick={() => setChatOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] text-xs"
            >
              <Send size={14} />
              打开灵境小助手
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
