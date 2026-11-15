import React from 'react';

type SettingsSection = {
  id: string;
  label: string;
  icon: React.ReactNode;
};

interface SettingsNavProps<TSectionId extends string> {
  sections: readonly (SettingsSection & { id: TSectionId })[];
  activeSection: TSectionId;
  onSelect: (sectionId: TSectionId) => void;
}

export function SettingsNav<TSectionId extends string>({ sections, activeSection, onSelect }: SettingsNavProps<TSectionId>) {
  return (
    <div className="settings-nav-scroll -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:w-48 md:flex-col md:overflow-x-visible md:px-0 md:pb-0">
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => onSelect(section.id)}
          className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-all md:shrink ${
            activeSection === section.id
              ? 'bg-[var(--bg-accent)] text-[var(--accent)] font-medium'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]'
          }`}
        >
          {section.icon}
          <span>{section.label}</span>
        </button>
      ))}
    </div>
  );
}
