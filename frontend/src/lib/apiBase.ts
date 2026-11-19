function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function configuredApiBase(): string {
  const value = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!value) return '';

  try {
    const url = new URL(value);
    if (typeof window !== 'undefined' && isLoopbackHost(url.hostname) && !isLoopbackHost(window.location.hostname)) {
      url.hostname = window.location.hostname;
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return value;
  }

  return value;
}

export const API_BASE = configuredApiBase();

export function resolveApiPath(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
