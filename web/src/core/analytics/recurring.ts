import { topCategoryName, type Ledger, type LedgerTxn } from '../ledger';
import type { IsoDate } from '../model';
import { mean, median, stdDev } from './cashflow';
import { merchantKey } from './behaviour';
import { addDays, daysBetween } from './periods';

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const CADENCES: { cadence: Cadence; days: number; tolerance: number; perMonth: number }[] = [
  { cadence: 'weekly', days: 7, tolerance: 2, perMonth: 52 / 12 },
  { cadence: 'monthly', days: 30.4, tolerance: 5, perMonth: 1 },
  { cadence: 'quarterly', days: 91, tolerance: 12, perMonth: 1 / 3 },
  { cadence: 'yearly', days: 365, tolerance: 20, perMonth: 1 / 12 },
];

export interface RecurringItem {
  key: string;
  name: string;
  category: string;
  cadence: Cadence;
  avgAmount: number;
  lastAmount: number;
  occurrences: number;
  first: IsoDate;
  last: IsoDate;
  nextExpected: IsoDate;
  /** Normalised to a monthly cost. */
  monthlyCost: number;
  /** Still happening: the last charge is within ~1.5 intervals of the latest data. */
  active: boolean;
  /** Came from a repeat rule set up in the app (vs detected from history). */
  fromRule: boolean;
  /** Latest amount is >10% above the previous one. */
  priceIncrease: boolean;
}

/**
 * Finds recurring expenses (subscriptions, bills, EMIs) from the full history:
 * same merchant/memo — or same subcategory and similar amount when there is no memo —
 * charged at a steady interval with a stable amount.
 */
export function detectRecurring(ledger: Ledger, txns: LedgerTxn[]): RecurringItem[] {
  const groups = new Map<string, LedgerTxn[]>();
  for (const t of txns) {
    if (t.kind !== 'expense' || t.isBalanceCorrection) continue;
    const memo = merchantKey(t.memo);
    const key = memo.length >= 2 ? `m:${memo}` : `c:${t.categoryId}:${Math.round(Math.log(t.amountMain + 1) * 4)}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }
  const ruleIds = new Set(ledger.ds.recurring.map((r) => r.id));
  const out: RecurringItem[] = [];
  for (const [key, list] of groups) {
    // One entry per day is enough to judge cadence.
    const byDate = [...new Map(list.map((t) => [t.date, t])).values()];
    if (byDate.length < 3) continue;
    const gaps = byDate.slice(1).map((t, i) => daysBetween(byDate[i].date, t.date));
    const typical = median(gaps);
    const match = CADENCES.find((c) => Math.abs(typical - c.days) <= c.tolerance);
    if (!match) continue;
    const regular = gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance * 1.5).length / gaps.length;
    const amounts = byDate.map((t) => t.amountMain);
    const avg = mean(amounts);
    const cv = avg ? stdDev(amounts) / avg : 1;
    if (regular < 0.7 || cv > 0.35) continue;
    // Weekly groceries etc. are habits, not commitments: require a stable amount for weekly.
    if (match.cadence === 'weekly' && cv > 0.15) continue;
    const last = byDate.at(-1)!;
    const prev = byDate.at(-2)!;
    const step = Math.round(match.days);
    out.push({
      key,
      name: last.memo.trim() || last.category?.name || topCategoryName(last),
      category: topCategoryName(last),
      cadence: match.cadence,
      avgAmount: avg,
      lastAmount: last.amountMain,
      occurrences: byDate.length,
      first: byDate[0].date,
      last: last.date,
      nextExpected: addDays(last.date, step),
      monthlyCost: last.amountMain * match.perMonth,
      active: daysBetween(last.date, ledger.anchor) <= match.days * 1.5 + match.tolerance,
      fromRule: list.some((t) => t.recurringId && ruleIds.has(t.recurringId)),
      priceIncrease: last.amountMain > prev.amountMain * 1.1,
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.monthlyCost - a.monthlyCost);
}
