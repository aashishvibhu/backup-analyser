export interface Formatter {
  /** Full amount, no decimals: ₹1,23,456 */
  money: (n: number) => string;
  /** Two decimals, for balances and tables: ₹1,23,456.78 */
  exact: (n: number) => string;
  /** Short axis label: ₹1.2L, ₹3.4Cr, ₹12k */
  compact: (n: number) => string;
  symbol: string;
}

export function makeFormatter(currency: string): Formatter {
  const indian = currency === 'INR';
  const locale = indian ? 'en-IN' : undefined;
  let whole: Intl.NumberFormat;
  let exactFmt: Intl.NumberFormat;
  try {
    whole = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 });
    exactFmt = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    exactFmt = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const symbol = whole.formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';
  const compactIntl = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const compact = (n: number) => {
    const sign = n < 0 ? '−' : '';
    const a = Math.abs(n);
    if (!indian) return `${sign}${symbol}${compactIntl.format(a)}`;
    const trim = (x: number) => x.toFixed(x >= 100 ? 0 : 1).replace(/\.0$/, '');
    if (a >= 1e7) return `${sign}${symbol}${trim(a / 1e7)}Cr`;
    if (a >= 1e5) return `${sign}${symbol}${trim(a / 1e5)}L`;
    if (a >= 1e3) return `${sign}${symbol}${trim(a / 1e3)}k`;
    return `${sign}${symbol}${Math.round(a)}`;
  };
  return {
    money: (n) => whole.format(Math.round(n) || 0).replace('-', '−'),
    exact: (n) => exactFmt.format(n).replace('-', '−'),
    compact,
    symbol,
  };
}

export const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(digits)}%`;

export const signedPct = (x: number | null | undefined) =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x * 100))}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-07-31 → 31 Jul 2026 */
export function fmtDate(iso: string | undefined): string {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function fmtRange(from: string, to: string): string {
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
