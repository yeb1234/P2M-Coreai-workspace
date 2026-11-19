/**
 * 客户端类型只用于 UI 分流，不是身份凭证。
 *
 * 桌面壳（Electron / Tauri）在页面脚本执行前写入全局标记；
 * 浏览器没有这个标记，一律按 web 处理。
 * 即使有人在控制台把标记改成 desktop-exe，也只是看到精简布局，
 * 不会获得任何额外权限。
 */
export type ClientType = 'web' | 'desktop-exe';

declare global {
  interface Window {
    __P2_CLIENT_TYPE__?: string;
  }
}

export function getClientType(): ClientType {
  if (typeof window === 'undefined') return 'web';
  return window.__P2_CLIENT_TYPE__ === 'desktop-exe' ? 'desktop-exe' : 'web';
}

export const CLIENT_TYPE: ClientType = getClientType();
export const IS_DESKTOP_CLIENT = CLIENT_TYPE === 'desktop-exe';

let fetchHeaderInstalled = false;

function isApiUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, window.location.href);
    return url.pathname === '/api' || url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * 给所有 API 请求补 X-Client-Type。
 *
 * 项目没有引入 axios，现有请求分散在 authFetch 和若干原生 fetch 上，
 * 所以在入口统一包一层 fetch，比逐个改业务文件更稳，也不会碰 Agent/RAG/MCP。
 * 桌面壳自身也会在 Electron 网络层再补一次 header，作为双保险。
 */
export function installDesktopFetchHeader(): void {
  if (!IS_DESKTOP_CLIENT || fetchHeaderInstalled || typeof window === 'undefined') return;
  fetchHeaderInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (!isApiUrl(rawUrl)) return nativeFetch(input, init);

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has('X-Client-Type')) headers.set('X-Client-Type', 'desktop-exe');

    return nativeFetch(input, { ...init, headers });
  };
}
