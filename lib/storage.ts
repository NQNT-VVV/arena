/** Acces localStorage tolerant : navigation privee, quota plein, SSR. */
export const store = {
  get<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* mode prive ou quota plein */ }
  },
  del(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch { /* rien a faire */ }
  },
};

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}
