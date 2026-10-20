import { isOneOff, type LedgerTxn } from '../ledger';
import type { IsoDate } from '../model';
import { listPeriods, periodOf, type Granularity, type Period, type PeriodOptions } from './periods';

export interface FlowSummary {
  income: number;
  expense: number;
  /** Expense excluding one-off categories. */
  coreExpense: number;
  oneOffExpense: number;
  net: number;
  /** net / income; null without income. */
  savingsRate: number | null;
  /** Part of income/expense that came from "modify balance" corrections. */
  correctionIncome: number;
  correctionExpense: number;
  /** Balance edits the app keeps out of income/expense. */
  adjustIn: number;
  adjustOut: number;
  transferTotal: number;
  incomeCount: number;
  expenseCount: number;
  txnCount: number;
}

export interface FlowRow extends FlowSummary {
  period: Period;
}

export function emptySummary(): FlowSummary {
  return {
    income: 0,
    expense: 0,
    coreExpense: 0,
    oneOffExpense: 0,
    net: 0,
    savingsRate: null,
    correctionIncome: 0,
    correctionExpense: 0,
    adjustIn: 0,
    adjustOut: 0,
    transferTotal: 0,
    incomeCount: 0,
    expenseCount: 0,
    txnCount: 0,
  };
}

function accumulate(s: FlowSummary, t: LedgerTxn, oneOff: Set<string>) {
  s.txnCount++;
  const amt = t.amountMain;
  switch (t.kind) {
    case 'income':
      s.income += amt;
      s.incomeCount++;
      if (t.isBalanceCorrection) s.correctionIncome += amt;
      break;
    case 'expense':
      s.expense += amt;
      s.expenseCount++;
      if (t.isBalanceCorrection) s.correctionExpense += amt;
      if (isOneOff(t, oneOff)) s.oneOffExpense += amt;
      else s.coreExpense += amt;
      break;
    case 'adjustIn':
      s.adjustIn += amt;
      break;
    case 'adjustOut':
      s.adjustOut += amt;
      break;
    case 'transfer':
      s.transferTotal += amt;
      break;
  }
}

function finish<T extends FlowSummary>(s: T): T {
  s.net = s.income - s.expense;
  s.savingsRate = s.income > 0 ? s.net / s.income : null;
  return s;
}

export function summarize(txns: LedgerTxn[], oneOff: Set<string> = new Set()): FlowSummary {
  const s = emptySummary();
  for (const t of txns) accumulate(s, t, oneOff);
  return finish(s);
}

/** Totals per period across [from, to], including empty periods. */
export function cashflow(
  txns: LedgerTxn[],
  g: Granularity,
  o: PeriodOptions,
  from: IsoDate,
  to: IsoDate,
  oneOff: Set<string> = new Set(),
): FlowRow[] {
  const rows = listPeriods(from, to, g, o).map<FlowRow>((period) => ({ period, ...emptySummary() }));
  const byKey = new Map(rows.map((r) => [r.period.key, r]));
  for (const t of txns) {
    if (t.date < from || t.date > to) continue;
    const row = byKey.get(periodOf(t.date, g, o).key);
    if (row) accumulate(row, t, oneOff);
  }
  return rows.map(finish);
}

/** Moving average over the previous `window` values (inclusive). */
export function rollingAverage(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    return sum / window;
  });
}

export function cumulative(values: number[]): number[] {
  let run = 0;
  return values.map((v) => (run += v));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}
