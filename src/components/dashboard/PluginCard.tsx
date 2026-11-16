import React, { useCallback } from 'react';
import type { Plugin } from '../../types/plugin';
import { useUIStore, usePluginStore } from '../../stores';
import { VIEW_PATH } from '../../config/pageRegistry';
import type { ActiveView } from '../../stores/uiStore';
import { Maximize2, Minimize2, X } from 'lucide-react';

interface PluginCardProps {
  plugin: Plugin;
  dragId?: string | null;
  overId?: string | null;
  onDragStart?: (id: string) => void;
  onDragOver?: (id: string) => void;
  onDragLeave?: () => void;
  onDrop?: (id: string) => void;
  onDragEnd?: () => void;
}

export const PluginCard: React.FC<PluginCardProps> = React.memo(({
  plugin,
  dragId,
  overId,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) => {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const pluginLayout = usePluginStore((s) => s.layout.find((l) => l.id === plugin.metadata.id));
  const setPluginSize = usePluginStore((s) => s.setPluginSize);
  const togglePlugin = usePluginStore((s) => s.togglePlugin);

  const currentSize = pluginLayout?.size || 'small';
  const SummaryComponent = plugin.metadata.summaryComponent;

  const handleZoom = useCallback(() => {
    const newSize = currentSize === 'small' ? 'large' : 'small';
    setPluginSize(plugin.metadata.id, newSize);
  }, [currentSize, plugin.metadata.id, setPluginSize]);

  const handleNavigate = useCallback(() => {
    const path = VIEW_PATH[plugin.metadata.id as ActiveView];
    if (path !== undefined) {
      setActiveView(plugin.metadata.id as ActiveView);
    } else {
      setActiveView('dashboard');
    }
  }, [plugin.metadata.id, setActiveView]);

  const isDragging = dragId === plugin.metadata.id;
  const isDropTarget = overId === plugin.metadata.id && dragId !== plugin.metadata.id;

  return (
    <div
      className={`plugin-card ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-[var(--accent)] ring-offset-2 rounded-2xl' : ''}`}
      data-size={currentSize}
      draggable
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', plugin.metadata.id);
        onDragStart?.(plugin.metadata.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver?.(plugin.metadata.id);
      }}
      onDragLeave={() => onDragLeave?.()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.(plugin.metadata.id);
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className="bg-[var(--bg-card)] rounded-[var(--r-2)] border border-[var(--border-light)] shadow-[var(--shadow-1)] hover:shadow-[var(--shadow-2)] overflow-hidden flex flex-col h-full transition-shadow">
        <div className="flex items-center justify-between px-4 py-2.5 md:px-3 md:py-2 border-b border-[var(--border-light)]">
          <div className="flex items-center gap-2 min-w-0">
            <span className={plugin.metadata.color}>{plugin.metadata.icon}</span>
            <h3 className="font-semibold text-[var(--text-primary)] text-sm truncate">{plugin.metadata.name}</h3>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleZoom}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] rounded-lg transition-colors"
              title={currentSize === 'large' ? '缩小' : '放大'}
            >
              {currentSize === 'large' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
            <button
              onClick={() => togglePlugin(plugin.metadata.id)}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] rounded-lg transition-colors"
              title="隐藏此组件"
            >
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 cursor-pointer flex-col overflow-auto p-3 md:p-2" onClick={handleNavigate}>
          <SummaryComponent />
        </div>

        <div className="px-4 py-1.5 md:hidden border-t border-[var(--border-light)]">
          <button
            onClick={handleNavigate}
            className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--accent)] text-center py-0.5 rounded hover:bg-[var(--accent-bg)] transition-all"
          >
            打开 {plugin.metadata.name} →
          </button>
        </div>
      </div>
    </div>
  );
});
