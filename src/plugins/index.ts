import { pluginRegistry } from './registry';
import { todoPlugin } from './todoPlugin';
import { calendarPlugin } from './calendarPlugin';
import { pomodoroPlugin } from './pomodoroPlugin';
import { quickStatsPlugin } from './quickStatsPlugin';
import { recentNotesPlugin } from './recentNotesPlugin';

export const registerAllPlugins = () => {
  pluginRegistry.register(todoPlugin);
  pluginRegistry.register(calendarPlugin);
  pluginRegistry.register(pomodoroPlugin);
  pluginRegistry.register(quickStatsPlugin);
  pluginRegistry.register(recentNotesPlugin);
};

export { pluginRegistry } from './registry';
