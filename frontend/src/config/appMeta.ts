export const APP_VERSION = '7.1';
export const APP_BRAND = 'SiteYeb';
export const APP_TITLE = `${APP_BRAND} ${APP_VERSION} · 灵境工作台`;

export function pageTitle(label?: string): string {
  return label ? `${label} · ${APP_BRAND} ${APP_VERSION}` : APP_TITLE;
}
