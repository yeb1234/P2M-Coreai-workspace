import React from 'react';
import { Bot, Send, Sparkles, Brain, Zap, Globe, Database, Code } from 'lucide-react';
import { PageTitle } from '../shared';
import { useAIStore } from '../../stores';

const MOCK_AGENTS = [
  { name: '代码助手', desc: '代码生成、审查、重构、调试', icon: <Code size={18} />, color: 'text-[#8b5cf6]' },
  { name: '知识检索', desc: '联网搜索、文档总结、问答', icon: <Globe size={18} />, color: 'text-[#2563eb]' },
  { name: '数据分析', desc: '数据清洗、可视化、洞察报告', icon: <Database size={18} />, color: 'text-[#16a34a]' },
  { name: '创意写作', desc: '文案、邮件、文档、翻译', icon: <Sparkles size={18} />, color: 'text-[#ec4899]' },
  { name: '逻辑推理', desc: '数学、逻辑、策略分析', icon: <Brain size={18} />, color: 'text-[#f59e0b]' },
  { name: '自动化', desc: '工作流编排、定时任务、API 调用', icon: <Zap size={18} />, color: 'text-[#c87d2f]' },
];

export const AIAgentPage: React.FC = () => {
  const { promptTemplates, activeTemplateId, setActiveTemplateId, updateTemplate, addTemplate, setChatOpen } = useAIStore();
  const activeTemplate = promptTemplates.find((template) => template.id === activeTemplateId) ?? promptTemplates[0];

  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="AI 助手"
        subtitle="这里连接你的本地 LM Studio，并统一管理提示词模板"
        icon={<Bot size={22} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {MOCK_AGENTS.map((agent) => (
          <div key={agent.name} className="bg-[var(--bg-card)] border border-[var(--border-light)] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={agent.color}>{agent.icon}</span>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{agent.name}</h3>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{agent.desc}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">提示词模板</p>
            <p className="text-xs text-[var(--text-muted)]">这些模板会被右侧本地 AI 对话面板直接读取。</p>
          </div>
          <button
            onClick={addTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-light)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          >
            新建模板
          </button>
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

      <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)] overflow-hidden">
        <div className="p-3 border-b border-[var(--border-light)] flex items-center gap-2">
          <Bot size={14} className="text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">本地对话入口</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-[var(--accent-bg)] text-[var(--accent)] rounded-full ml-auto">LM Studio</span>
        </div>
        <div className="p-4 text-xs text-[var(--text-muted)]">
          点击下面按钮会打开右侧 AI 对话栏，直接连接本机 LM Studio。
        </div>
        <div className="p-3 border-t border-[var(--border-light)]">
          <div className="flex justify-end">
            <button
              onClick={() => setChatOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] text-xs"
            >
              <Send size={14} />
              打开本地 AI 对话
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
