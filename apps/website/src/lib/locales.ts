export const locales = {
  en: { lang: 'en', label: 'English' },
  'zh-cn': { lang: 'zh-CN', label: '简体中文' },
} as const;

export type Locale = keyof typeof locales;

export const defaultLocale: Locale = 'en';

export function localePath(locale: Locale, path = ''): string {
  const base = import.meta.env.BASE_URL;
  return `${base}${locale}/${path.replace(/^\/+/, '')}`;
}
