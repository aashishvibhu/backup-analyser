// Validation report: prints rebuilt account balances and monthly totals (and a smoke run of every analytic)
// so numbers can be compared with what the Money Manager app shows.
//
//   npm run report -- <path-to.mmbak> [--as-of YYYY-MM-DD] [--calendar] [--all]

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import initSqlJs from 'sql.js';
import { accountBalances, netWorthSeries } from '../src/core/analytics/balances.ts';
import { merchants, spendDays } from '../src/core/analytics/behaviour.ts';
import { budgetReports } from '../src/core/analytics/budgets.ts';
import { cardReport } from '../src/core/analytics/cards.ts';
import { cashflow } from '../src/core/analytics/cashflow.ts';
import { categoryMatrix, categoryStats, suggestOneOffCategories } from '../src/core/analytics/categories.ts';
import { incomeToSpendSankey, investmentReport, loanReports } from '../src/core/analytics/flows.ts';
import { findAnomalies, forecast } from '../src/core/analytics/forecast.ts';
import { healthScore } from '../src/core/analytics/insights.ts';
import { listPeriods, periodOf } from '../src/core/analytics/periods.ts';
import { detectRecurring } from '../src/core/analytics/recurring.ts';
import { buildLedger, DEFAULT_PREFS, periodOptions, selectTxns } from '../src/core/ledger.ts';
import { parseMmbak } from '../src/core/parser/mmbak.ts';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--as-of');
if (!file) {
  console.error('Usage: npm run report -- <file.mmbak> [--as-of YYYY-MM-DD] [--calendar] [--all]');
  process.exit(1);
}
const asOfIdx = args.indexOf('--as-of');
const asOf = asOfIdx >= 0 ? args[asOfIdx + 1] : undefined;

const SQL = await initSqlJs();
const ds = parseMmbak(SQL, new Uint8Array(readFileSync(file)), basename(file));
const ledger = buildLedger(ds);
const prefs = { ...DEFAULT_PREFS, monthStartDay: args.includes('--calendar') ? 1 : null };
const o = periodOptions(ledger, prefs);
const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`\n# ${ds.meta.sourceName}`);
console.log(`schema v${ds.meta.schemaVersion} · main currency ${ds.meta.mainCurrency} · ${ds.transactions.length} transactions (transfers merged) · ${ledger.first} → ${ledger.anchor}`);
console.log(`settings: month starts on day ${ds.settings.monthStartDay}, week_start_day=${ds.settings.weekStartDay}, carry_over=${ds.settings.carryOver}, card_accounting_type=${ds.settings.cardAccountingType}`);
for (const w of ds.meta.warnings) console.log(`warning: ${w}`);

console.log(`\n## Account balances${asOf ? ` as of ${asOf}` : ' (all transactions)'}`);
console.table(
  accountBalances(ds, asOf).map((b) => ({
    group: b.groupName,
    account: b.account.name,
    balance: fmt(b.balance),
    txns: b.txnCount,
    last: b.lastActivity ?? '',
    flag: b.account.statusFlag,
  })),
);

const txns = selectTxns(ledger, prefs);
const months = cashflow(txns, 'month', o, ledger.first, ledger.anchor);
console.log(`\n## Monthly totals (${ds.meta.mainCurrency}), periods starting on day ${o.monthStartDay}`);
console.log('income/expense include "modify balance" corrections; corr* shows that part. adj± are balance edits kept out of income/expense.');
console.table(
  months.map((m) => ({
    period: `${m.period.start} → ${m.period.end}`,
    income: fmt(m.income),
    expense: fmt(m.expense),
    net: fmt(m.net),
    'save%': m.savingsRate == null ? '' : `${Math.round(m.savingsRate * 100)}%`,
    corrIn: m.correctionIncome || '',
    corrOut: m.correctionExpense || '',
    'adj+': m.adjustIn || '',
    'adj-': m.adjustOut || '',
    txns: m.txnCount,
  })),
);

if (args.includes('--all')) {
  // Smoke run of every analytic over the whole history, printing headline numbers.
  const periods = listPeriods(ledger.first, ledger.anchor, 'month', o);
  const matrix = categoryMatrix(txns, 'expense', periods, o, 100);
  const oneOff = new Set(suggestOneOffCategories(matrix));
  const t0 = performance.now();
  const nw = netWorthSeries(ledger, prefs, periods);
  const cards = ds.accounts.filter((a) => a.kind === 'creditCard').map((a) => cardReport(ledger, a, { from: ledger.first, to: ledger.anchor }));
  const recurring = detectRecurring(ledger, txns);
  const budgets = budgetReports(ledger, txns, periods.slice(-13), o);
  const flowRows = cashflow(txns, 'month', o, ledger.first, ledger.anchor, oneOff);
  const fy = periodOf(ledger.anchor, 'fy', o);
  const f = forecast(flowRows, ledger.anchor, o, flowRows.filter((r) => r.period.start >= fy.start), fy);
  const inv = investmentReport(ledger, txns, periods, o);
  const loans = loanReports(ledger, periods, periods.length);
  const anomalies = findAnomalies(txns, txns);
  const days = spendDays(txns, ledger.first, ledger.anchor);
  const shops = merchants(txns);
  const sankey = incomeToSpendSankey(txns);
  const health = healthScore({
    lastYear: flowRows.slice(-13, -1),
    liquid: nw.at(-1)!.liquid,
    liabilities: nw.at(-1)!.liabilities,
    budgets,
    cards,
  });
  const ms = Math.round(performance.now() - t0);

  console.log(`\n## All analytics (computed in ${ms} ms)`);
  console.log('suggested one-off categories:', [...oneOff].map((id) => ledger.categoryById.get(id)?.name ?? id).join(', ') || 'none');
  console.log('category patterns:', categoryStats(matrix).slice(0, 8).map((s) => `${s.name}=${s.nature}`).join(', '));
  console.log(`net worth now: ${fmt(nw.at(-1)!.netWorth)} (liquid ${fmt(nw.at(-1)!.liquid)}, investments ${fmt(nw.at(-1)!.investments)}, owed ${fmt(nw.at(-1)!.liabilities)})`);
  for (const c of cards) console.log(`card ${c.account.name}: owed ${fmt(c.outstanding)}, paid in full ${c.paidInFullRate === null ? '–' : Math.round(c.paidInFullRate * 100) + '%'} of ${c.cycles.length} cycles`);
  console.log(`recurring: ${recurring.filter((r) => r.active).length} active (${recurring.filter((r) => r.active).slice(0, 8).map((r) => `${r.name} ${r.cadence} ${Math.round(r.lastAmount)}`).join('; ')})`);
  console.log(`budgets: ${budgets.map((b) => `${b.name} ${Math.round(b.current.actual)}/${b.amount} (${b.current.status})`).join('; ') || 'none'}`);
  console.log(`forecast next month: income ${fmt(f.income.expected)}, core spend ${fmt(f.coreExpense.expected)}; ${f.fy?.period.label} projected savings ${fmt(f.fy?.projectedNet ?? 0)}`);
  console.log(`investments: net ${fmt(inv.totalNet)}, consistency ${Math.round(inv.consistency * 100)}%; loans: ${loans.map((l) => `${l.account.name} ${fmt(l.outstanding)}`).join('; ') || 'none'}`);
  console.log(`anomalies: ${anomalies.length}; top merchants: ${shops.slice(0, 5).map((m) => `${m.name} (${m.count})`).join(', ')}`);
  console.log(`no-spend days ${days.noSpendDays}/${days.days}; sankey ${sankey.nodes.length} nodes; health score ${health.score}/100`);
}
