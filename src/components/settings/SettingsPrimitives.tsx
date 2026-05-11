import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
  secondary: 'bg-[var(--text-primary)] text-white hover:bg-[color-mix(in_srgb,var(--text-primary)_88%,white)]',
  outline: 'border border-[color-mix(in_srgb,var(--accent)_32%,var(--border-light))] text-[var(--accent)] hover:bg-[var(--accent-bg)]',
  danger: 'theme-danger-button',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--bg-accent)] hover:text-[var(--accent)]',
};

interface SettingsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function SettingsButton({ variant = 'primary', className = '', children, ...props }: SettingsButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function SettingsSectionTitle({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <h4 className={`text-sm font-medium ${danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'}`}>
      {children}
    </h4>
  );
}

export function SettingsPanelTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{children}</h3>;
}

export function SettingsHint({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs text-[var(--text-muted)] ${className}`}>{children}</p>;
}

export function SettingsFieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{children}</label>;
}

export function SettingsTextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[var(--border-light)] bg-[var(--bg-elevated)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_12%,transparent)] ${props.className ?? ''}`}
    />
  );
}

export function ToggleSwitch({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-5 w-10 rounded-full transition-colors ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
