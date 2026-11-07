import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import vi from './vi.json';

export const LANGUAGES = ['vi', 'en'] as const;
const KEY = 'qah.lang';

function savedLanguage(): string {
  try {
    return localStorage.getItem(KEY) ?? 'vi';
  } catch {
    return 'vi';
  }
}

void i18n.use(initReactI18next).init({
  resources: { vi: { translation: vi }, en: { translation: en } },
  lng: savedLanguage(),
  fallbackLng: 'vi',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    // bỏ qua
  }
});

export default i18n;
