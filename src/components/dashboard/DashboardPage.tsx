import React, { useState, useMemo, useCallback } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { pluginRegistry } from '../../plugins';
import { usePluginStore } from '../../stores';
import { PluginCard } from './PluginCard';
import { PageTitle } from '../shared';
import { ImportantDates } from './ImportantDates';

export const DashboardPage: React.FC = () => {
  const layout = usePluginStore((s) => s.layout);
  const swapPlugins = usePluginStore((s) => s.swapPlugins);
  const plugins = pluginRegistry.getAllPlugins();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const orderedPlugins = useMemo(() =>
    [...plugins].sort((a, b) => {
      const aLayout = layout.find((l) => l.id === a.metadata.id);
      const bLayout = layout.find((l) => l.id === b.metadata.id);
      return (aLayout?.position ?? 0) - (bLayout?.position ?? 0);
    }), [plugins, layout]);

  const enabledPlugins = useMemo(() =>
    orderedPlugins.filter((plugin) => {
      const pluginLayout = layout.find((l) => l.id === plugin.metadata.id);
      return pluginLayout?.enabled !== false;
    }), [orderedPlugins, layout]);

  const rowMap = useMemo(() => {
    const map: Record<string, number> = {};
    let row = 1;
    let col = 0;
    for (const plugin of enabledPlugins) {
      const span = 4;
      if (col + span > 12) {
        row++;
        col = 0;
      }
      map[plugin.metadata.id] = row;
      col += span;
    }
    return map;
  }, [enabledPlugins]);

  const handleDrop = useCallback((id: string) => {
    if (dragId && dragId !== id) {
      swapPlugins(dragId, id);
    }
    setDragId(null);
    setOverId(null);
  }, [dragId, swapPlugins]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setOverId(null);
  }, []);

  return (
    <div className="w-full pt-2">
      <PageTitle title="工作台" subtitle="拖动卡片调整位置，点击放大切换宽度" icon={<LayoutDashboard size={22} />} />
      <ImportantDates />
      <div className="dashboard-grid">
        {enabledPlugins.map((plugin) => (
          <PluginCard
            key={plugin.metadata.id}
            plugin={plugin}
            dragId={dragId}
            overId={overId}
            gridRow={rowMap[plugin.metadata.id]}
            onDragStart={setDragId}
            onDragOver={setOverId}
            onDragLeave={() => setOverId(null)}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  );
};
