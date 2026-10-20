import { topCategoryName, type LedgerTxn } from '../ledger';
import { median, quantile, type FlowRow } from './cashflow';
import { addDays, elapsedFraction, listPeriods, type Period, type PeriodOptions } from './periods';
import type { IsoDate } from '../model';

export interface Forecast {
  /** Months the estimate is based on. */
  basis: number;
  income: { expected: number; low: number; high: number };
  coreExpense: { expected: number; low: number; high: number };
  net: number;
  /** Current month: actual so far plus the typical remainder. */
  current?: { period: Period; actualExpense: number; projectedExpense: number; elapsed: number };
  /** Rest of the financial year at the typical pace. */
  fy?: { period: Period; actualNet: number; projectedNet: number; remainingMonths: number };
}

/**
 * Median-based forecast from the last `window` complete months.
 * One-off categories are excluded (core expense), so a single large purchase does not inflate next month.
 */
export function forecast(
  monthly: FlowRow[],
  anchor: IsoDate,
  o: PeriodOptions,
  fyRows: FlowRow[],
  fyPeriod?: Period,
  window = 6,
): Forecast {
  const complete = monthly.filter((r) => r.period.end < anchor);
  const recent = complete.slice(-window);
  const inc = recent.map((r) => r.income);
  const exp = recent.map((r) => r.coreExpense);
  const band = (v: number[]) => ({ expected: median(v), low: quantile(v, 0.25), high: quantile(v, 0.75) });
  const out: Forecast = { basis: recent.length, income: band(inc), coreExpense: band(exp), net: median(inc) - median(exp) };

  const cur = monthly.find((r) => r.period.start <= anchor && r.period.end >= anchor);
  if (cur) {
    const elapsed = elapsedFraction(cur.period, anchor);
    out.current = {
      period: cur.period,
      actualExpense: cur.coreExpense,
      projectedExpense: cur.coreExpense + (1 - elapsed) * out.coreExpense.expected,
      elapsed,
    };
  }
  if (fyPeriod) {
    const actualNet = fyRows.reduce((a, r) => a + r.net, 0);
    const curEnd = cur?.period.end ?? anchor;
    const future = curEnd < fyPeriod.end ? listPeriods(addDays(curEnd, 1), fyPeriod.end, 'month', o).length : 0;
    const remainingMonths = future + (cur ? 1 - elapsedFraction(cur.period, anchor) : 0);
    out.fy = { period: fyPeriod, actualNet, projectedNet: actualNet + remainingMonths * out.net, remainingMonths };
  }
  return out;
}

export interface Anomaly {
  txn: LedgerTxn;
  reason: string;
  /** How many times the category's typical amount. */
  multiple: number;
}

/**
 * Expenses far above what is normal for their category (median + 5 × MAD and ≥ 3× the median),
 * judged against the full history. Small amounts are ignored.
 */
export function findAnomalies(history: LedgerTxn[], inRange: LedgerTxn[], minAmount = 500, limit = 30): Anomaly[] {
  const byCat = new Map<string, number[]>();
  for (const t of history) {
    if (t.kind !== 'expense' || t.isBalanceCorrection) continue;
    const key = t.categoryId ?? '';
    const list = byCat.get(key) ?? [];
    list.push(t.amountMain);
    byCat.set(key, list);
  }
  const stats = new Map(
    [...byCat].map(([k, v]) => {
      const med = median(v);
      const mad = median(v.map((x) => Math.abs(x - med))) * 1.4826;
      return [k, { med, mad, n: v.length }];
    }),
  );
  const out: Anomaly[] = [];
  for (const t of inRange) {
    if (t.kind !== 'expense' || t.isBalanceCorrection || t.amountMain < minAmount) continue;
    const s = stats.get(t.categoryId ?? '');
    if (!s || s.n < 5 || s.med <= 0) continue;
    if (t.amountMain > s.med * 3 && t.amountMain > s.med + 5 * s.mad) {
      const multiple = t.amountMain / s.med;
      out.push({
        txn: t,
        multiple,
        reason: `${multiple.toFixed(1)}× the usual ${t.category?.name ?? topCategoryName(t)} amount`,
      });
    }
  }
  return out.sort((a, b) => b.txn.amountMain - a.txn.amountMain).slice(0, limit);
}

export interface Spike {
  id: string;
  name: string;
  period: Period;
  value: number;
  typical: number;
}

/** Months where a category's spend jumped well above its own trailing 12-month pattern. */
export function categorySpikes(matrix: { categories: { id: string; name: string }[]; periods: Period[]; values: number[][] }): Spike[] {
  const out: Spike[] = [];
  matrix.categories.forEach((c, ci) => {
    if (c.id === '__other__') return;
    const values = matrix.values[ci];
    values.forEach((v, pi) => {
      const prior = values.slice(Math.max(0, pi - 12), pi);
      if (prior.length < 4) return;
      const typical = median(prior);
      const p75 = quantile(prior, 0.75);
      if (v > 1000 && v > Math.max(typical * 2, p75 * 1.5)) {
        out.push({ id: c.id, name: c.name, period: matrix.periods[pi], value: v, typical });
      }
    });
  });
  return out.sort((a, b) => b.period.start.localeCompare(a.period.start) || b.value - a.value);
}
