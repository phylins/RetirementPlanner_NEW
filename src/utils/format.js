export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
export const pct = (n, digits = 1) => `${Number(n).toFixed(digits)}%`;
export function twMoney(n, digits = 1) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 100000000) return `${sign}${(a / 100000000).toFixed(digits)}億`;
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString('zh-TW')}萬`;
  return `${sign}${Math.round(a).toLocaleString('zh-TW')}`;
}
export function twWan(n, digits = 0) { return `${(Number(n || 0) / 10000).toFixed(digits)}萬`; }
export function numberInput(v) { return Math.round(Number(v) || 0).toLocaleString('en-US'); }
export function parseNumberInput(v) { return Number(String(v).replace(/,/g, '')) || 0; }
export function star(score) {
  const s = Math.max(0, Math.min(5, Math.round(score / 20)));
  return '★★★★★'.slice(0, s) + '☆☆☆☆☆'.slice(0, 5 - s);
}
