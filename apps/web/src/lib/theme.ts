export type Theme = 'light' | 'dark';

const KEY = 'qah.theme';

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage có thể bị chặn; dùng theo hệ điều hành
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // bỏ qua: chỉ là tiện ích ghi nhớ
  }
}
