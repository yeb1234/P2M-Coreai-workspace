import React, { forwardRef, useState } from 'react';
import { Clock3, Coffee, Repeat2, Settings2, TimerReset, Volume2, X } from 'lucide-react';
import { usePomodoroStore } from '../../stores';
import { playInteractionSound } from '../../lib/sounds';

const WORK_PRESETS = [25, 30, 35, 45, 60];
const BREAK_PRESETS = [5, 10, 15, 20];
const LONG_BREAK_PRESETS = [15, 20, 25, 30];

interface PomodoroSettingsButtonProps {
  onClick: () => void;
}

export const PomodoroSettingsButton = forwardRef<HTMLButtonElement, PomodoroSettingsButtonProps>(
  ({ onClick }, ref) => (
    <button
      ref={ref}
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent-bg)] px-2.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_16%,var(--bg-card))]"
    >
      <Settings2 size={14} />
      参数
    </button>
  )
);

PomodoroSettingsButton.displayName = 'PomodoroSettingsButton';

interface PomodoroSettingsProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideClosed?: boolean;
  compact?: boolean;
}

export const PomodoroSettings: React.FC<PomodoroSettingsProps> = ({ open, onOpenChange, hideClosed = false, compact = false }) => {
  const { config, updateConfig } = usePomodoroStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const ambientMode = config.ambientPlaybackMode ?? 'manual';
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const openSettings = () => { setOpen(true); playInteractionSound('tap'); };
  const closeSettings = () => { setOpen(false); playInteractionSound('tap'); };

  if (!isOpen) {
    if (hideClosed) return null;
    return <PomodoroSettingsButton onClick={openSettings} />;
  }

  return (
    <div className={`${compact ? 'absolute inset-x-3 bottom-3 z-20' : ''} rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-card)_94%,var(--accent-bg))] px-3 py-2.5 shadow-lg backdrop-blur-sm space-y-2.5`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5">
          <Settings2 size={14} className="text-[var(--accent)]" />
          专注参数
        </h3>
        <button
          onClick={closeSettings}
          className="grid h-6 w-6 place-items-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
          title="关闭参数面板"
        >
          <X size={13} />
        </button>
      </div>

      {/* Work duration */}
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Clock3 size={12} />
          专注
        </label>
        <div className="grid grid-cols-5 gap-1">
          {WORK_PRESETS.map((min) => (
            <button
              key={min}
              onClick={() => { updateConfig({ workDuration: min }); playInteractionSound('save'); }}
              className={`h-7 text-xs rounded-md border transition-all ${
                config.workDuration === min
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'
              }`}
            >
              {min}
            </button>
          ))}
        </div>
      </div>

      {/* Short break duration */}
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Coffee size={12} />
          短休
        </label>
        <div className="grid grid-cols-4 gap-1">
          {BREAK_PRESETS.map((min) => (
            <button
              key={min}
              onClick={() => { updateConfig({ shortBreakDuration: min }); playInteractionSound('save'); }}
              className={`h-7 text-xs rounded-md border transition-all ${
                config.shortBreakDuration === min
                  ? 'bg-[var(--success)] text-white border-[var(--success)] shadow-sm'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--success)]'
              }`}
            >
              {min}
            </button>
          ))}
        </div>
      </div>

      {/* Long break duration */}
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <TimerReset size={12} />
          长休
        </label>
        <div className="grid grid-cols-4 gap-1">
          {LONG_BREAK_PRESETS.map((min) => (
            <button
              key={min}
              onClick={() => { updateConfig({ longBreakDuration: min }); playInteractionSound('save'); }}
              className={`h-7 text-xs rounded-md border transition-all ${
                config.longBreakDuration === min
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'
              }`}
            >
              {min}
            </button>
          ))}
        </div>
      </div>

      {/* Long break interval */}
      <div className="grid grid-cols-[64px_1fr] items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Repeat2 size={12} />
          间隔
        </label>
        <div className="grid grid-cols-4 gap-1">
          {[3, 4, 5, 6].map((n) => (
            <button
              key={n}
              onClick={() => { updateConfig({ longBreakInterval: n }); playInteractionSound('save'); }}
              className={`h-7 text-xs rounded-md border transition-all ${
                config.longBreakInterval === n
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border)] hover:border-[var(--accent)]'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Volume2 size={12} />
          环境音策略
        </label>
        <div className="grid grid-cols-2 gap-1">
          {[
            { value: 'manual' as const, label: '手动控制', desc: '由底部开关独立控制' },
            { value: 'focus' as const, label: '随专注计时', desc: '仅专注阶段自动播放' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => { updateConfig({ ambientPlaybackMode: item.value }); playInteractionSound('save'); }}
              className={`rounded-md border px-2.5 py-1.5 text-left transition-all ${
                ambientMode === item.value
                  ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
              }`}
            >
              <p className="text-xs font-medium">{item.label}</p>
              <p className="mt-0.5 text-xs leading-4">{item.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
