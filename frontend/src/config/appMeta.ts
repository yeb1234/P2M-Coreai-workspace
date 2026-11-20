export const APP_VERSION = '7.2';
export const APP_BRAND = 'P2';
export const APP_EDITION = 'Media';
export const APP_TITLE = `${APP_BRAND} ${APP_VERSION} ${APP_EDITION} · 灵境工作台`;

export function pageTitle(label?: string): string {
  return label ? `${label} · ${APP_BRAND} ${APP_VERSION} ${APP_EDITION}` : APP_TITLE;
}
