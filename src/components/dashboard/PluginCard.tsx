import React, { useState, useMemo, useCallback } from 'react';
import type { Plugin } from '../../types/plugin';
import { useUIStore, usePluginStore } from '../../stores';
import type { ActiveView } from '../../stores/uiStore';
import { Maximize2, Minimize2 } from 'lucide-react';

interface PluginCardProps {
  plugin: Plugin;
  dragId?: string | null;
  overId?: string | null;
  gridRow?: number;
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
  gridRow,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) => {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const pluginLayout = usePluginStore((s) => s.layout.find((l) => l.id === plugin.metadata.id));
  const setPluginSize = usePluginStore((s) => s.setPluginSize);
  const [isExpanded, setIsExpanded] = useState(false);

  const currentSize = pluginLayout?.size || 'small';
  const SummaryComponent = plugin.metadata.summaryComponent;

  const handleZoom = useCallback(() => {
    const newSize = currentSize === 'small' ? 'large' : 'small';
    setPluginSize(plugin.metadata.id, newSize);
    setIsExpanded(newSize === 'large');
  }, [currentSize, plugin.metadata.id, setPluginSize]);

  const handleNavigate = useCallback(() => {
    setActiveView(plugin.metadata.id as ActiveView);
  }, [plugin.metadata.id, setActiveView]);

  const isDragging = dragId === plugin.metadata.id;
  const isDropTarget = overId === plugin.metadata.id && dragId !== plugin.metadata.id;

  const gridStyle = useMemo(() => ({ gridRow: gridRow || 'auto' }), [gridRow]);

  return (
    <div
      className={`plugin-card ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-[#c87d2f] ring-offset-2 rounded-2xl' : ''} ${isExpanded ? 'plugin-expanded' : ''}`}
      data-size={currentSize}
      style={gridStyle}
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
      <div className="bg-[#faf9f7] rounded-2xl md:rounded-xl border border-[#e5e2dd] shadow-sm overflow-hidden flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2.5 md:px-3 md:py-2 border-b border-[#f3f2ef]">
          <div className="flex items-center gap-2">
            <span className={plugin.metadata.color}>{plugin.metadata.icon}</span>
            <h3 className="font-semibold text-[#1a1a1a] text-sm">{plugin.metadata.name}</h3>
          </div>
          <button
            onClick={handleZoom}
            className="p-1.5 text-[#b8b4ac] hover:text-[#6b7280] hover:bg-[#f3f2ef] rounded-md transition-colors"
            title={currentSize === 'large' ? '缩小' : '放大'}
          >
            {currentSize === 'large' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>

        <div
          className="p-3 md:p-2 cursor-pointer flex-1 overflow-auto"
          onClick={handleNavigate}
        >
          <SummaryComponent />
        </div>

        <div className="px-4 py-1.5 md:hidden border-t border-[#f3f2ef]">
          <button
            onClick={handleNavigate}
            className="w-full text-[10px] text-[#b8b4ac] hover:text-[#c87d2f] text-center py-0.5 rounded hover:bg-[#fef7ed] transition-all"
          >
            打开{plugin.metadata.name} &rarr;
          </button>
        </div>
      </div>
    </div>
  );
});
