import React from 'react';
import { Bot, Send, Sparkles, Brain, Zap, Globe, Database, Code } from 'lucide-react';
import { PageTitle } from '../shared';

const MOCK_AGENTS = [
  { name: '代码助手', desc: '代码生成、审查、重构、调试', icon: <Code size={18} />, color: 'text-[#8b5cf6]', status: 'active' },
  { name: '知识检索', desc: '联网搜索、文档总结、问答', icon: <Globe size={18} />, color: 'text-[#2563eb]', status: 'active' },
  { name: '数据分析', desc: '数据清洗、可视化、洞察报告', icon: <Database size={18} />, color: 'text-[#16a34a]', status: 'idle' },
  { name: '创意写作', desc: '文案、邮件、文档、翻译', icon: <Sparkles size={18} />, color: 'text-[#ec4899]', status: 'active' },
  { name: '逻辑推理', desc: '数学、逻辑、策略分析', icon: <Brain size={18} />, color: 'text-[#f59e0b]', status: 'idle' },
  { name: '自动化', desc: '工作流编排、定时任务、API 调用', icon: <Zap size={18} />, color: 'text-[#c87d2f]', status: 'active' },
];

const MOCK_HISTORY = [
  { role: 'user', content: '帮我写一个 React useDebounce hook' },
  { role: 'assistant', content: '好的，这是一个 TypeScript 版本的 useDebounce hook：\n\n```tsx\nfunction useDebounce<T>(value: T, delay: number): T {\n  const [debounced, setDebounced] = useState(value);\n  useEffect(() => {\n    const timer = setTimeout(() => setDebounced(value), delay);\n    return () => clearTimeout(timer);\n  }, [value, delay]);\n  return debounced;\n}\n```' },
  { role: 'user', content: '再加一个取消功能' },
  { role: 'assistant', content: '可以返回一个 cancel 函数：\n\n```tsx\nfunction useDebounce<T>(value: T, delay: number) {\n  const [debounced, setDebounced] = useState(value);\n  const timerRef = useRef<ReturnType<typeof setTimeout>>();\n  const cancel = () => clearTimeout(timerRef.current);\n  useEffect(() => {\n    timerRef.current = setTimeout(() => setDebounced(value), delay);\n    return cancel;\n  }, [value, delay]);\n  return [debounced, cancel] as const;\n}\n```' },
];

export const AIAgentPage: React.FC = () => {
  return (
    <div className="w-full pt-2 space-y-6">
      <PageTitle
        title="AI 超级智能体"
        subtitle="多模型协同，智能任务编排"
        icon={<Bot size={22} />}
      />

      {/* Agent cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {MOCK_AGENTS.map((agent) => (
          <div key={agent.name} className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl p-4 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-center gap-2 mb-2">
              <span className={agent.color}>{agent.icon}</span>
              <h3 className="text-sm font-semibold text-[#1a1a1a]">{agent.name}</h3>
              <span className={`ml-auto w-2 h-2 rounded-full ${agent.status === 'active' ? 'bg-[#16a34a]' : 'bg-[#d1cdc6]'}`} />
            </div>
            <p className="text-xs text-[#6b7280]">{agent.desc}</p>
          </div>
        ))}
      </div>

      {/* Chat preview */}
      <div className="bg-[#faf9f7] border border-[#e5e2dd] rounded-xl overflow-hidden">
        <div className="p-3 border-b border-[#e5e2dd] flex items-center gap-2">
          <Bot size={14} className="text-[#8b5cf6]" />
          <span className="text-xs font-medium text-[#1a1a1a]">对话预览</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-[#f0fdf4] text-[#16a34a] rounded-full ml-auto">Claude 3.5 Sonnet</span>
        </div>
        <div className="p-4 space-y-4 max-h-64 overflow-y-auto">
          {MOCK_HISTORY.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-3 py-2 text-xs ${
                msg.role === 'user' ? 'bg-[#c87d2f] text-white' : 'bg-[#f3f2ef] text-[#1a1a1a]'
              }`}>
                <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-[#e5e2dd]">
          <div className="flex gap-2">
            <input type="text" placeholder="输入消息..." className="flex-1 text-xs bg-transparent outline-none" />
            <button className="p-1.5 bg-[#8b5cf6] text-white rounded-lg hover:bg-[#7c3aed]"><Send size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  );
};
