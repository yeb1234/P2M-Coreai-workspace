import type { Plugin } from '../types/plugin';

class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.metadata.id, plugin);
  }

  unregister(id: string): void {
    this.plugins.delete(id);
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values())
      .sort((a, b) => a.metadata.defaultPosition - b.metadata.defaultPosition);
  }
}

export const pluginRegistry = new PluginRegistry();
