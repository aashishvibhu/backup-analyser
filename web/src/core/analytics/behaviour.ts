import { topCategoryName, type LedgerTxn } from '../ledger';
import type { IsoDate } from '../model';
import { addDays, dayOfWeek, daysBetween } from './periods';

const expenses = (txns: LedgerTxn[]) => txns.filter((t) => t.kind === 'expense' && !t.isBalanceCorrection);

export interface WeekdayStat {
  /** 0 = Sunday. */
  day: number;
  total: number;
  count: number;
  /** Average spend per calendar occurrence of this weekday in the range. */
  avgPerDay: number;
}

export function weekdayStats(txns: LedgerTxn[], from: IsoDate, to: IsoDate): WeekdayStat[] {
  const stats = Array.from({ length: 7 }, (_, day) => ({ day, total: 0, count: 0, avgPerDay: 0 }));
  for (const t of expenses(txns)) {
    const s = stats[dayOfWeek(t.date)];
    s.total += t.amountMain;
    s.count++;
  }
  const occurrences = Array(7).fill(0);
  for (let d = from; d <= to; d = addDays(d, 1)) occurrences[dayOfWeek(d)]++;
  for (const s of stats) s.avgPerDay = occurrences[s.day] ? s.total / occurrences[s.day] : 0;
  return stats;
}

export function dayOfMonthTotals(txns: LedgerTxn[]): number[] {
  const out = Array(31).fill(0);
  for (const t of expenses(txns)) out[Number(t.date.slice(8, 10)) - 1] += t.amountMain;
  return out;
}

/**
 * Spend by weekday × hour, from the entry timestamp (local time).
 * Approximate: back-dated entries carry the time they were typed in.
 */
export function weekdayHourMatrix(txns: LedgerTxn[]): { count: number[][]; amount: number[][] } {
  const count = Array.from({ length: 7 }, () => Array(24).fill(0));
  const amount = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const t of expenses(txns)) {
    if (!t.timestamp) continue;
    const d = new Date(t.timestamp);
    // Use the user-assigned date's weekday; the timestamp only supplies the hour.
    const wd = dayOfWeek(t.date);
    count[wd][d.getHours()]++;
    amount[wd][d.getHours()] += t.amountMain;
  }
  return { count, amount };
}

export const SIZE_BUCKETS: { label: string; max: number }[] = [
  { label: '< 100', max: 100 },
  { label: '100–500', max: 500 },
  { label: '500–1k', max: 1_000 },
  { label: '1k–5k', max: 5_000 },
  { label: '5k–10k', max: 10_000 },
  { label: '10k–50k', max: 50_000 },
  { label: '50k+', max: Infinity },
];

export function sizeHistogram(txns: LedgerTxn[]): { label: string; count: number; total: number }[] {
  const out = SIZE_BUCKETS.map((b) => ({ label: b.label, count: 0, total: 0 }));
  for (const t of expenses(txns)) {
    const i = SIZE_BUCKETS.findIndex((b) => t.amountMain < b.max);
    out[i].count++;
    out[i].total += t.amountMain;
  }
  return out;
}

export interface SpendDays {
  days: number;
  spendDays: number;
  noSpendDays: number;
  longestNoSpendStreak: number;
  currentNoSpendStreak: number;
  avgPerDay: number;
  avgPerSpendDay: number;
}

export function spendDays(txns: LedgerTxn[], from: IsoDate, to: IsoDate): SpendDays {
  const dates = new Set(expenses(txns).map((t) => t.date));
  const total = expenses(txns).reduce((a, t) => a + t.amountMain, 0);
  const days = Math.max(0, daysBetween(from, to) + 1);
  let longest = 0;
  let run = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    run = dates.has(d) ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return {
    days,
    spendDays: dates.size,
    noSpendDays: days - dates.size,
    longestNoSpendStreak: longest,
    currentNoSpendStreak: run,
    avgPerDay: days ? total / days : 0,
    avgPerSpendDay: dates.size ? total / dates.size : 0,
  };
}

export interface Merchant {
  key: string;
  name: string;
  total: number;
  count: number;
  avgTicket: number;
  first: IsoDate;
  last: IsoDate;
  topCategory: string;
}

const GENERIC_MEMOS = new Set(['difference', 'payment', 'transfer', 'misc', 'others', 'other', 'na', 'card bill']);

/** Normalises memo text so "Corner Cafe", "corner cafe " and "CORNER CAFE #2" group together. */
export function merchantKey(memo: string): string {
  return memo
    .toLowerCase()
    .replace(/[#*\d]+/g, ' ')
    .replace(/[^\p{L}\s&]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Spend grouped by memo text, which users typically use for the merchant or payee.
 * Places seen fewer than `minVisits` times are left out (one-time purchases are not "places").
 */
export function merchants(txns: LedgerTxn[], minVisits = 2): Merchant[] {
  const m = new Map<string, Merchant & { names: Map<string, number>; cats: Map<string, number> }>();
  for (const t of expenses(txns)) {
    const key = merchantKey(t.memo);
    if (key.length < 2 || GENERIC_MEMOS.has(key)) continue;
    let e = m.get(key);
    if (!e) {
      e = { key, name: t.memo, total: 0, count: 0, avgTicket: 0, first: t.date, last: t.date, topCategory: '', names: new Map(), cats: new Map() };
      m.set(key, e);
    }
    e.total += t.amountMain;
    e.count++;
    if (t.date < e.first) e.first = t.date;
    if (t.date > e.last) e.last = t.date;
    e.names.set(t.memo.trim(), (e.names.get(t.memo.trim()) ?? 0) + 1);
    e.cats.set(topCategoryName(t), (e.cats.get(topCategoryName(t)) ?? 0) + t.amountMain);
  }
  return [...m.values()]
    .map(({ names, cats, ...e }) => ({
      ...e,
      name: [...names].sort((a, b) => b[1] - a[1])[0][0],
      topCategory: [...cats].sort((a, b) => b[1] - a[1])[0][0],
      avgTicket: e.total / e.count,
    }))
    .filter((e) => e.count >= minVisits)
    .sort((a, b) => b.total - a.total);
}
