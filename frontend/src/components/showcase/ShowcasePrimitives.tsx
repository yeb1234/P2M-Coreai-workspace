import React from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';

export const ShowcaseBadge: React.FC<{ children: React.ReactNode; tone?: 'accent' | 'warn' | 'muted' }> = ({
  children,
  tone = 'accent',
}) => {
  const className = tone === 'warn'
    ? 'border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[var(--warn-bg)] text-[var(--warn)]'
    : tone === 'muted'
      ? 'border-[var(--border-light)] bg-[var(--bg-elevated)] text-[var(--text-muted)]'
      : 'border-[color-mix(in_srgb,var(--accent)_28%,transparent)] bg-[var(--accent-bg)] text-[var(--accent)]';

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
};

export const ShowcasePageHeader: React.FC<{
  kicker: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ kicker, title, description, action }) => (
  <div className="mb-4 flex flex-col gap-3 border-b border-[color-mix(in_srgb,var(--border-light)_72%,transparent)] pb-4 pt-1 sm:flex-row sm:items-end sm:justify-between md:pt-0">
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
        <Sparkles size={13} />
        {kicker}
      </div>
      <h2 className="text-[1.35rem] font-semibold leading-tight text-[var(--text-primary)] md:text-[1.55rem]">{title}</h2>
      <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-[var(--text-secondary)] md:text-sm">{description}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const SectionHeading: React.FC<{
  index?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ index, title, description, action }) => (
  <div className="mb-3 flex items-end justify-between gap-3">
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {index && (
          <span className="font-mono text-[11px] font-semibold text-[var(--accent)]">{index}</span>
        )}
        <h3 className="text-sm font-semibold text-[var(--text-primary)] md:text-base">{title}</h3>
      </div>
      {description && <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">{description}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const MetricCard: React.FC<{
  value: string;
  label: string;
  detail?: string;
}> = ({ value, label, detail }) => (
  <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-3">
    <div className="font-mono text-xl font-semibold tracking-tight text-[var(--text-primary)]">{value}</div>
    <div className="mt-1 text-xs font-medium text-[var(--text-secondary)]">{label}</div>
    {detail && <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{detail}</div>}
  </div>
);

export const TextLink: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'accent' | 'muted';
}> = ({ onClick, children, tone = 'accent' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
      tone === 'accent'
        ? 'text-[var(--accent)] hover:text-[var(--accent-hover)]'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
    }`}
  >
    {children}
    <ArrowRight size={13} />
  </button>
);
