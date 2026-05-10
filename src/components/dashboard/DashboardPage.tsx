import React, { useState, useMemo, useCallback } from 'react';
import { LayoutDashboard, Maximize2, Minimize2, Settings2, Eye, EyeOff } from 'lucide-react';
import { pluginRegistry } from '../../plugins';
import { usePluginStore } from '../../stores';
import { PluginCard } from './PluginCard';
import { PageTitle } from '../shared';
import { ImportantDates } from './ImportantDates';

export const DashboardPage: React.FC = () => {
  const layout = usePluginStore((s) => s.layout);
  const swapPlugins = usePluginStore((s) => s.swapPlugins);
  const setAllPluginSize = usePluginStore((s) => s.setAllPluginSize);
  const togglePlugin = usePluginStore((s) => s.togglePlugin);

  const plugins = pluginRegistry.getAllPlugins();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [showManager, setShowManager] = useState(false);

  const allFull = useMemo(() => layout.length > 0 && layout.every((l) => l.size === 'full'), [layout]);

  const orderedPlugins = useMemo(
    () =>
      [...plugins].sort((a, b) => {
        const aLayout = layout.find((l) => l.id === a.metadata.id);
        const bLayout = layout.find((l) => l.id === b.metadata.id);
        return (aLayout?.position ?? 0) - (bLayout?.position ?? 0);
      }),
    [plugins, layout]
  );

  const enabledPlugins = useMemo(
    () =>
      orderedPlugins.filter((plugin) => {
        const pluginLayout = layout.find((l) => l.id === plugin.metadata.id);
        return pluginLayout?.enabled !== false;
      }),
    [orderedPlugins, layout]
  );

  const hiddenCount = orderedPlugins.length - enabledPlugins.length;

  const handleDrop = useCallback(
    (id: string) => {
      if (dragId && dragId !== id) swapPlugins(dragId, id);
      setDragId(null);
      setOverId(null);
    },
    [dragId, swapPlugins]
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  return (
    <div className="w-full pt-2 space-y-3">
      <PageTitle
        title="工作台"
        subtitle="拖动卡片调整位置，点一下可以放大或缩小"
        icon={<LayoutDashboard size={22} />}
      />

      <ImportantDates />

      <div className="flex items-center justify-start gap-2">
        <button
          onClick={() => setShowManager(!showManager)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors"
          style={{
            color: showManager ? 'var(--accent)' : 'var(--text-secondary)',
            borderColor: showManager ? 'var(--accent)' : 'var(--border-light)',
            backgroundColor: 'var(--bg-card)',
          }}
        >
          <Settings2 size={13} />
          管理组件{hiddenCount > 0 && ` (${hiddenCount} 个已隐藏)`}
        </button>
        {enabledPlugins.length > 0 && (
          <button
            onClick={() => setAllPluginSize(allFull ? 'small' : 'full')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors"
            style={{
              color: 'var(--text-secondary)',
              borderColor: 'var(--border-light)',
              backgroundColor: 'var(--bg-card)',
            }}
          >
            {allFull ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {allFull ? '全部缩小' : '全部展开'}
          </button>
        )}
      </div>

      {showManager && (
        <div className="mb-4 p-3 rounded-xl border border-[var(--border-light)] bg-[var(--bg-card)]">
          <div className="flex flex-wrap gap-2">
            {orderedPlugins.map((plugin) => {
              const pLayout = layout.find((l) => l.id === plugin.metadata.id);
              const enabled = pLayout?.enabled !== false;
              return (
                <button
                  key={plugin.metadata.id}
                  onClick={() => togglePlugin(plugin.metadata.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors"
                  style={{
                    color: enabled ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderColor: enabled ? 'var(--accent)' : 'var(--border-light)',
                    backgroundColor: enabled ? 'var(--accent-bg)' : 'var(--bg-elevated)',
                  }}
                >
                  {plugin.metadata.icon}
                  {plugin.metadata.name}
                  {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        {enabledPlugins.map((plugin) => (
          <PluginCard
            key={plugin.metadata.id}
            plugin={plugin}
            dragId={dragId}
            overId={overId}
            onDragStart={setDragId}
            onDragOver={setOverId}
            onDragLeave={() => setOverId(null)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {enabledPlugins.length === 0 && !showManager && (
        <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>
          <EyeOff size={32} className="mx-auto mb-3 opacity-40" />
          <p>所有组件都被隐藏了</p>
          <button
            onClick={() => setShowManager(true)}
            className="mt-2 text-xs underline"
            style={{ color: 'var(--accent)' }}
          >
            点这里打开管理面板恢复
          </button>
        </div>
      )}
    </div>
  );
};
