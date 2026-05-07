import { pluginRegistry } from './registry';
import { todoPlugin } from './todoPlugin';
import { calendarPlugin } from './calendarPlugin';
import { pomodoroPlugin } from './pomodoroPlugin';

export const registerAllPlugins = () => {
  pluginRegistry.register(todoPlugin);
  pluginRegistry.register(calendarPlugin);
  pluginRegistry.register(pomodoroPlugin);
};

export { pluginRegistry } from './registry';
