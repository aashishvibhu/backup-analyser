import type { Ledger, LedgerTxn } from '../ledger';
import { median, quantile } from './cashflow';
import { elapsedFraction, periodOf, type Period, type PeriodOptions } from './periods';

export interface BudgetPeriodResult {
  period: Period;
  actual: number;
  ratio: number;
}

export interface BudgetReport {
  id: string;
  name: string;
  amount: number;
  history: BudgetPeriodResult[];
  current: BudgetPeriodResult & {
    /** Projected spend by period end at the current pace. */
    projected: number;
    elapsed: number;
    status: 'ok' | 'at-risk' | 'over';
  };
  /** Share of completed periods that stayed within budget. */
  adherence: number | null;
}

/**
 * Monthly budgets from the backup compared with actual spend.
 * Budgets with a category cover it and its subcategories; "total" budgets cover all spend.
 */
export function budgetReports(ledger: Ledger, txns: LedgerTxn[], periods: Period[], o: PeriodOptions): BudgetReport[] {
  const anchor = ledger.anchor;
  const currentPeriod = periodOf(anchor, 'month', o);
  return ledger.ds.budgets
    .filter((b) => b.amount > 0)
    .map((b) => {
      const name = b.isTotal ? 'All spending' : (ledger.categoryById.get(b.categoryId ?? '')?.name ?? 'Unknown category');
      const matches = (t: LedgerTxn) =>
        t.kind === 'expense' && (b.isTotal || t.categoryId === b.categoryId || t.topCategory?.id === b.categoryId);
      const actualIn = (p: Period) =>
        txns.filter((t) => matches(t) && t.date >= p.start && t.date <= p.end).reduce((a, t) => a + t.amountMain, 0);
      const history = periods
        .filter((p) => p.end < currentPeriod.start)
        .map((period) => {
          const actual = actualIn(period);
          return { period, actual, ratio: actual / b.amount };
        });
      const actual = actualIn(currentPeriod);
      const elapsed = elapsedFraction(currentPeriod, anchor);
      const projected = elapsed > 0 ? actual / elapsed : actual;
      return {
        id: b.id,
        name,
        amount: b.amount,
        history,
        current: {
          period: currentPeriod,
          actual,
          ratio: actual / b.amount,
          projected,
          elapsed,
          status: actual > b.amount ? 'over' : projected > b.amount ? 'at-risk' : 'ok',
        },
        adherence: history.length ? history.filter((h) => h.actual <= b.amount).length / history.length : null,
      };
    });
}

export interface BudgetSuggestion {
  id: string;
  name: string;
  median: number;
  suggested: number;
}

/** Suggested monthly budgets: the 75th percentile of recent months, rounded up to a tidy figure. */
export function suggestBudgets(monthlyByCategory: { id: string; name: string; values: number[] }[]): BudgetSuggestion[] {
  return monthlyByCategory
    .filter((c) => c.values.filter((v) => v > 0).length >= Math.ceil(c.values.length / 2))
    .map((c) => ({ id: c.id, name: c.name, median: median(c.values), suggested: roundUp(quantile(c.values, 0.75)) }))
    .filter((s) => s.suggested > 0)
    .sort((a, b) => b.suggested - a.suggested);
}

function roundUp(n: number): number {
  const step = n >= 10_000 ? 1000 : n >= 1000 ? 500 : 100;
  return Math.ceil(n / step) * step;
}
