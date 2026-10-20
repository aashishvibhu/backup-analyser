// End-to-end checks of every analytic against the synthetic demo backup (parser included).

import initSqlJs from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateDemoBackup } from '../../demo/generateBackup';
import { buildLedger, DEFAULT_PREFS, periodOptions, selectTxns, type Ledger } from '../ledger';
import { parseMmbak } from '../parser/mmbak';
import { accountBalances, netWorthSeries } from './balances';
import { sizeHistogram, spendDays, merchants, weekdayHourMatrix } from './behaviour';
import { budgetReports } from './budgets';
import { cardReport } from './cards';
import { cashflow, summarize } from './cashflow';
import { categoryMatrix, categoryStats, categoryTree, compareCategories } from './categories';
import { incomeToSpendSankey, investmentReport, loanReports, transferMatrix } from './flows';
import { findAnomalies, forecast } from './forecast';
import { healthScore } from './insights';
import { listPeriods, periodOf } from './periods';
import { detectRecurring } from './recurring';

let ledger: Ledger;
const prefs = DEFAULT_PREFS;
const all = { from: '2024-01-01', to: '2025-12-31' };

beforeAll(async () => {
  const SQL = await initSqlJs();
  ledger = buildLedger(parseMmbak(SQL, generateDemoBackup(SQL), 'demo.mmbak'));
});

describe('demo backup', () => {
  it('parses cleanly and is deterministic', async () => {
    const SQL = await initSqlJs();
    expect(ledger.ds.meta.warnings).toEqual([]);
    expect(ledger.first).toBe('2024-01-01');
    expect(ledger.anchor).toBe('2025-12-31');
    expect(generateDemoBackup(SQL)).toEqual(generateDemoBackup(SQL));
  });
});

describe('cash flow', () => {
  it('fills every month and reconciles with the overall summary', () => {
    const o = periodOptions(ledger, prefs);
    const txns = selectTxns(ledger, prefs);
    const rows = cashflow(txns, 'month', o, all.from, all.to);
    expect(rows).toHaveLength(24);
    const s = summarize(txns);
    expect(rows.reduce((a, r) => a + r.income, 0)).toBeCloseTo(s.income, 2);
    expect(rows.reduce((a, r) => a + r.expense, 0)).toBeCloseTo(s.expense, 2);
    // Monthly pay plus small rewards.
    expect(rows[0].income).toBeGreaterThan(85000);
    expect(rows[0].income).toBeLessThan(86000);
  });

  it('separates one-off categories from core spend', () => {
    const s = summarize(selectTxns(ledger, prefs, all), new Set(['e10']));
    expect(s.oneOffExpense).toBe(120000);
    expect(s.coreExpense + s.oneOffExpense).toBeCloseTo(s.expense, 2);
  });

  it('drops balance corrections when asked', () => {
    const withCorr = summarize(selectTxns(ledger, prefs));
    const without = summarize(selectTxns(ledger, { ...prefs, includeCorrections: false }));
    expect(withCorr.correctionExpense).toBeGreaterThan(0);
    expect(without.correctionExpense).toBe(0);
    expect(withCorr.expense - without.expense).toBeCloseTo(withCorr.correctionExpense, 2);
  });

  it('respects excluded tags', () => {
    const s = summarize(selectTxns(ledger, { ...prefs, excludedTagIds: ['tag-skip'] }));
    expect(summarize(selectTxns(ledger, prefs)).expense - s.expense).toBe(120000);
  });
});

describe('categories', () => {
  it('builds a tree whose children sum to their parent', () => {
    const tree = categoryTree(selectTxns(ledger, prefs), 'expense');
    const food = tree.find((n) => n.name === 'Food')!;
    expect(food.children.map((c) => c.name).sort()).toEqual(['Groceries', 'Restaurants', 'Snacks']);
    expect(food.children.reduce((a, c) => a + c.total, 0)).toBeCloseTo(food.total, 2);
    expect(tree.reduce((a, n) => a + n.share, 0)).toBeCloseTo(1, 6);
  });

  it('classifies rent as fixed and furniture as one-off', () => {
    const o = periodOptions(ledger, prefs);
    const m = categoryMatrix(selectTxns(ledger, prefs), 'expense', listPeriods(all.from, all.to, 'month', o), o, 20);
    const stats = categoryStats(m);
    expect(stats.find((s) => s.name === 'Rent')?.nature).toBe('fixed');
    expect(stats.find((s) => s.name === 'Furniture')?.nature).toBe('one-off');
  });

  it('compares two ranges', () => {
    const cur = selectTxns(ledger, prefs, { from: '2025-05-01', to: '2025-05-31' });
    const prev = selectTxns(ledger, prefs, { from: '2025-04-01', to: '2025-04-30' });
    expect(compareCategories(cur, prev, 'expense')[0]).toMatchObject({ name: 'Furniture', delta: 120000, pct: null });
  });
});

describe('accounts', () => {
  it('rebuilds loan and SIP balances', () => {
    const b = Object.fromEntries(accountBalances(ledger.ds).map((x) => [x.account.id, x.balance]));
    expect(b.carloan).toBe(-480000 + 24 * 12500);
    expect(b.mf).toBe(200000 + 24 * 10000);
    expect(b.trip).toBe(4000);
  });

  it('net worth at the end equals the sum of balances', () => {
    const o = periodOptions(ledger, prefs);
    const series = netWorthSeries(ledger, prefs, listPeriods(all.from, all.to, 'month', o));
    const total = accountBalances(ledger.ds).reduce((a, x) => a + x.balance, 0);
    expect(series.at(-1)!.netWorth).toBeCloseTo(total, 2);
    expect(series.at(-1)!.liabilities).toBeLessThan(0);
  });

  it('tracks card statements, including the partly paid one', () => {
    const cc1 = ledger.accountById.get('cc1')!;
    const report = cardReport(ledger, cc1, all);
    const aug = report.cycles.find((c) => c.statement === '2025-07-15')!;
    expect(aug.status).toBe('partial');
    expect(report.cycles.filter((c) => c.status === 'paid').length).toBeGreaterThan(15);
    expect(report.cycles.filter((c) => c.status === 'partial' || c.status === 'unpaid')).toHaveLength(1);
    expect(report.paidInFullRate).toBeGreaterThan(0.9);
    expect(report.paidInFullRate).toBeLessThan(1);
  });

  it('reports loans and investments', () => {
    const o = periodOptions(ledger, prefs);
    const periods = listPeriods(all.from, all.to, 'month', o);
    const [loan] = loanReports(ledger, periods, 24);
    expect(loan.outstanding).toBe(180000);
    expect(loan.monthsToPayoff).toBe(Math.ceil(180000 / 12500));
    const inv = investmentReport(ledger, selectTxns(ledger, prefs, all), periods, o);
    expect(inv.byAccount.find((r) => r.account.id === 'mf')?.contributed).toBe(240000);
    expect(inv.consistency).toBe(1);
  });
});

describe('flows and behaviour', () => {
  it('balances the sankey', () => {
    const s = incomeToSpendSankey(selectTxns(ledger, prefs, all));
    const into = s.links.filter((l) => l.target === 'Income').reduce((a, l) => a + l.value, 0);
    const out = s.links.filter((l) => l.source === 'Income').reduce((a, l) => a + l.value, 0);
    expect(into).toBeCloseTo(out, 2);
    expect(new Set(s.nodes.map((n) => n.name)).size).toBe(s.nodes.length);
  });

  it('summarises transfers between groups', () => {
    const edges = transferMatrix(ledger, selectTxns(ledger, prefs, all));
    expect(edges.find((e) => e.from === 'Accounts' && e.to === 'Investments')?.total).toBe(240000 + 50000);
  });

  it('computes behaviour stats', () => {
    const txns = selectTxns(ledger, prefs, all);
    const expenses = txns.filter((t) => t.kind === 'expense' && !t.isBalanceCorrection).length;
    expect(sizeHistogram(txns).reduce((a, b) => a + b.count, 0)).toBe(expenses);
    expect(weekdayHourMatrix(txns).count.flat().reduce((a, b) => a + b, 0)).toBe(expenses);
    const days = spendDays(txns, all.from, all.to);
    expect(days.days).toBe(731);
    expect(days.spendDays + days.noSpendDays).toBe(731);
    expect(merchants(txns).map((m) => m.name)).toContain('Corner Cafe');
  });
});

describe('recurring, budgets, forecast, health', () => {
  it('detects subscriptions and bills', () => {
    const items = detectRecurring(ledger, ledger.txns);
    const stream = items.find((r) => r.name === 'StreamBox')!;
    expect(stream).toMatchObject({ cadence: 'monthly', active: true, fromRule: true, monthlyCost: 649 });
    expect(items.find((r) => r.name === 'TuneCloud')?.active).toBe(false);
    expect(items.find((r) => r.name === 'Flat rent')?.priceIncrease).toBe(false);
    expect(items.some((r) => r.name === 'FreshMart')).toBe(false);
  });

  it('compares budgets with actual spend', () => {
    const o = periodOptions(ledger, prefs);
    const reports = budgetReports(ledger, selectTxns(ledger, prefs), listPeriods(all.from, all.to, 'month', o), o);
    expect(reports.map((r) => r.name).sort()).toEqual(['Food', 'Shopping', 'Transport']);
    const food = reports.find((r) => r.name === 'Food')!;
    expect(food.history).toHaveLength(23);
    expect(food.current.period.key).toBe('2025-12');
  });

  it('forecasts from complete months and flags anomalies', () => {
    const o = periodOptions(ledger, prefs);
    const txns = selectTxns(ledger, prefs);
    const monthly = cashflow(txns, 'month', o, all.from, all.to, new Set(['e10']));
    const fy = periodOf(ledger.anchor, 'fy', o);
    const f = forecast(monthly, '2025-12-15', o, monthly.filter((r) => r.period.start >= fy.start && r.period.end < '2025-12-15'), fy);
    expect(f.basis).toBe(6);
    expect(f.income.expected).toBeGreaterThan(95000);
    expect(f.income.expected).toBeLessThan(96000);
    expect(f.fy?.remainingMonths).toBeCloseTo(3 + 16 / 31, 5);
    const anomalies = findAnomalies(ledger.txns, txns);
    expect(anomalies.every((a) => a.txn.amountMain >= 500)).toBe(true);
  });

  it('produces a bounded health score', () => {
    const o = periodOptions(ledger, prefs);
    const monthly = cashflow(selectTxns(ledger, prefs), 'month', o, '2025-01-01', '2025-12-31');
    const h = healthScore({ lastYear: monthly, liquid: 100000, liabilities: -200000, budgets: [], cards: [] });
    expect(h.score).toBeGreaterThan(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(h.components.find((c) => c.key === 'cards')?.score).toBeNull();
  });
});
