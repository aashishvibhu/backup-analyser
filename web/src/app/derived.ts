// Memoised analytics shared by several pages.

import { useMemo } from 'react';
import { accountBalances, accountClass, netWorthSeries } from '../core/analytics/balances';
import { budgetReports } from '../core/analytics/budgets';
import { cardReport } from '../core/analytics/cards';
import { cashflow, type FlowRow } from '../core/analytics/cashflow';
import { addDays, daysBetween, listPeriods, periodOf, type Granularity } from '../core/analytics/periods';
import { detectRecurring } from '../core/analytics/recurring';
import { useApp } from './store';

/** Week buckets for short ranges, months otherwise. */
export function useAutoGranularity(): Granularity {
  const { range } = useApp();
  return daysBetween(range.from, range.to) <= 62 ? 'week' : 'month';
}

export function useRangeFlow(g: Granularity): FlowRow[] {
  const { txns, o, range, oneOff } = useApp();
  return useMemo(() => cashflow(txns, g, o, range.from, range.to, oneOff), [txns, g, o, range, oneOff]);
}

/** The 12 complete months before the latest data (the "typical" baseline). */
export function useLastYear(): FlowRow[] {
  const { allTxns, o, ledger, oneOff } = useApp();
  return useMemo(() => {
    const current = periodOf(ledger.anchor, 'month', o);
    const end = addDays(current.start, -1);
    let start = current.start;
    for (let i = 0; i < 12; i++) start = periodOf(addDays(start, -1), 'month', o).start;
    if (end < ledger.first) return [];
    const from = start < ledger.first ? periodOf(ledger.first, 'month', o).start : start;
    return cashflow(allTxns, 'month', o, from, end, oneOff);
  }, [allTxns, o, ledger, oneOff]);
}

export function useBalances() {
  const { ledger, prefs } = useApp();
  return useMemo(() => {
    const excluded = new Set(prefs.excludedAccountIds);
    const balances = accountBalances(ledger.ds);
    let liquid = 0;
    let liabilities = 0;
    let assets = 0;
    for (const b of balances) {
      if (excluded.has(b.account.id)) continue;
      if (accountClass(b.account.kind) === 'liquid' && b.balance > 0) liquid += b.balance;
      if (b.balance < 0) liabilities += b.balance;
      else assets += b.balance;
    }
    return { balances, liquid, liabilities, assets, netWorth: assets + liabilities };
  }, [ledger, prefs.excludedAccountIds]);
}

export function useNetWorth(fromOverride?: string) {
  const { ledger, prefs, o, range } = useApp();
  return useMemo(() => {
    const from = fromOverride ?? range.from;
    const to = range.to < ledger.anchor ? range.to : ledger.anchor;
    return netWorthSeries(ledger, prefs, listPeriods(from, to, 'month', o));
  }, [ledger, prefs, o, range, fromOverride]);
}

export function useRecurring() {
  const { ledger, allTxns } = useApp();
  return useMemo(() => detectRecurring(ledger, allTxns), [ledger, allTxns]);
}

export function useBudgets() {
  const { ledger, allTxns, o } = useApp();
  return useMemo(() => {
    const periods = listPeriods(ledger.first, ledger.anchor, 'month', o).slice(-13);
    return budgetReports(ledger, allTxns, periods, o);
  }, [ledger, allTxns, o]);
}

export function useCards() {
  const { ledger, range, prefs } = useApp();
  return useMemo(() => {
    const excluded = new Set(prefs.excludedAccountIds);
    return ledger.ds.accounts
      .filter((a) => a.kind === 'creditCard' && !excluded.has(a.id))
      .map((a) => cardReport(ledger, a, range))
      .filter((r) => r.cycles.some((c) => c.spend > 0 || c.owed > 0) || r.outstanding > 0);
  }, [ledger, range, prefs.excludedAccountIds]);
}
