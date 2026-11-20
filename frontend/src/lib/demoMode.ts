/** 演示构建的登录预填。
 *
 * 只有显式传入 VITE_DEMO_MODE=true 才生效；普通 Lite / Media 构建
 * 不会把任何演示口令写进登录页，也不会把口令存进 localStorage。
 */
export interface DemoCredentials {
  username: string;
  password: string;
}

export function parseDemoCredentials(
  mode: string | undefined,
  username: string | undefined,
  password: string | undefined,
): DemoCredentials | null {
  if (String(mode || '').trim().toLowerCase() !== 'true') return null;
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user || !pass) return null;
  return { username: user, password: pass };
}

export const DEMO_CREDENTIALS = parseDemoCredentials(
  import.meta.env.VITE_DEMO_MODE,
  import.meta.env.VITE_DEMO_USERNAME,
  import.meta.env.VITE_DEMO_PASSWORD,
);

export const IS_DEMO = DEMO_CREDENTIALS !== null;
