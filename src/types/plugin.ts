import type { ComponentType, ReactNode } from 'react';

export type PluginSize = 'small' | 'large' | 'full';

export interface PluginMetadata {
  id: string;
  name: string;
  icon: ReactNode;
  description?: string;
  defaultPosition: number;
  color: string;
  defaultSize: PluginSize;
  summaryComponent: ComponentType;
}

export interface Plugin {
  metadata: PluginMetadata;
  panel: { component: ComponentType };
  settings?: { component: ComponentType };
}
