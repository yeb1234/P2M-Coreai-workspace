import { useCallback, useRef } from 'react';

export function Slider({ value, min, max, step, onChange, className = '', dark = false }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  className?: string;
  dark?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const pct = ((value - min) / (max - min)) * 100;

  const getValue = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    return Math.round(raw / step) * step;
  }, [min, max, step]);

  const handleDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    onChange(getValue(e.clientX));
    const onMove = (ev: MouseEvent) => { if (dragging.current) onChange(getValue(ev.clientX)); };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getValue, onChange]);

  return (
    <div
      ref={trackRef}
      className={`relative h-[6px] rounded-full cursor-pointer group/slider ${dark ? 'bg-white/20' : 'bg-[#d1cdc6]'} ${className}`}
      onMouseDown={handleDown}
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${dark ? 'bg-white/70' : 'bg-[#c87d2f]'}`} style={{ width: `${pct}%` }} />
      <div
        className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-sm border-2 pointer-events-none opacity-0 group-hover/slider:opacity-100 transition-opacity ${dark ? 'bg-white border-white/50' : 'bg-[#c87d2f] border-white'}`}
        style={{ left: `calc(${pct}% - 6px)` }}
      />
    </div>
  );
}
