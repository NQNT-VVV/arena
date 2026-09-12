/** Numerotation et formats AGARTHA : hexadecimal partout, 0x00 est le systeme. */

/** 3 → « 0x03 », 8010 → « 0x1F4A ». */
export const hex = (n: number, pad = 2): string => `0x${Math.max(0, Math.trunc(Number(n) || 0)).toString(16).toUpperCase().padStart(pad, '0')}`;

/** « 0x03 / 0x0C » */
export const hexOf = (n: number, total: number): string => `${hex(n)} / ${hex(total)}`;

/** Entier avec espace fine insecable : 1 480 → « 1 480 ». */
export const fmtInt = (n: number): string => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n).replace(/[   ]/g, ' ');

/** Horodatage systeme « 14:02:17 ». */
export const stamp = (ms: number = Date.now()): string => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/** Secondes → « 07.4 » (dixiemes) ou « 01:07.4 » au-dela d'une minute. */
export function fmtTimer(seconds: number): string {
  const s = Math.max(0, seconds);
  const whole = Math.floor(s);
  const tenth = Math.floor((s - whole) * 10);
  if (whole >= 60) return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${tenth}`;
  return `${String(whole).padStart(2, '0')}.${tenth}`;
}
