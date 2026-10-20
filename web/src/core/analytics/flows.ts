import { isInvestmentKind, topCategoryName, type Ledger, type LedgerTxn } from '../ledger';
import type { Account } from '../model';
import { balanceTimeline } from './balances';
import { periodOf, type Period, type PeriodOptions } from './periods';

export interface SankeyData {
  nodes: { name: string; kind: 'income' | 'hub' | 'expense' | 'saving' }[];
  links: { source: string; target: string; value: number }[];
}

/** Income categories → "Income" → expense categories, with the surplus as "Saved" (or the gap as "From savings"). */
export function incomeToSpendSankey(txns: LedgerTxn[], maxCategories = 10): SankeyData {
  const totals = (kind: 'income' | 'expense') => {
    const m = new Map<string, number>();
    for (const t of txns) if (t.kind === kind) m.set(topCategoryName(t), (m.get(topCategoryName(t)) ?? 0) + t.amountMain);
    const sorted = [...m].sort((a, b) => b[1] - a[1]);
    const head = sorted.slice(0, maxCategories);
    const rest = sorted.slice(maxCategories).reduce((a, [, v]) => a + v, 0);
    if (rest > 0) head.push([kind === 'income' ? 'Other income' : 'Other spend', rest]);
    return head;
  };
  const income = totals('income');
  const expense = totals('expense');
  const incomeTotal = income.reduce((a, [, v]) => a + v, 0);
  const expenseTotal = expense.reduce((a, [, v]) => a + v, 0);
  const HUB = 'Income';
  // Sankey node names must be unique across columns.
  const inName = (n: string) => (expense.some(([e]) => e === n) || n === HUB ? `${n} ` : n);

  const nodes: SankeyData['nodes'] = [{ name: HUB, kind: 'hub' }];
  const links: SankeyData['links'] = [];
  for (const [name, value] of income) {
    nodes.push({ name: inName(name), kind: 'income' });
    links.push({ source: inName(name), target: HUB, value });
  }
  if (expenseTotal > incomeTotal) {
    nodes.push({ name: 'From savings', kind: 'saving' });
    links.push({ source: 'From savings', target: HUB, value: expenseTotal - incomeTotal });
  }
  for (const [name, value] of expense) {
    nodes.push({ name, kind: 'expense' });
    links.push({ source: HUB, target: name, value });
  }
  if (incomeTotal > expenseTotal) {
    nodes.push({ name: 'Saved', kind: 'saving' });
    links.push({ source: HUB, target: 'Saved', value: incomeTotal - expenseTotal });
  }
  return { nodes, links };
}

export interface TransferEdge {
  from: string;
  to: string;
  total: number;
  count: number;
}

/** Money moved between account groups (transfers only). */
export function transferMatrix(ledger: Ledger, txns: LedgerTxn[]): TransferEdge[] {
  const groupName = (a?: Account) => (a ? (ledger.groupById.get(a.groupId)?.name ?? 'Other') : 'Unknown');
  const edges = new Map<string, TransferEdge>();
  for (const t of txns) {
    if (t.kind !== 'transfer') continue;
    const from = groupName(t.account);
    const to = groupName(t.toAccount);
    const key = `${from}→${to}`;
    const e = edges.get(key) ?? { from, to, total: 0, count: 0 };
    e.total += t.amountMain;
    e.count++;
    edges.set(key, e);
  }
  return [...edges.values()].sort((a, b) => b.total - a.total);
}

export interface ContributionRow {
  period: Period;
  /** Net money moved into investment/deposit accounts (transfers in − transfers out). */
  net: number;
  inflow: number;
  outflow: number;
}

export interface InvestmentReport {
  rows: ContributionRow[];
  byAccount: { account: Account; contributed: number; withdrawn: number; balance: number }[];
  totalNet: number;
  /** Share of periods with a positive net contribution. */
  consistency: number;
  returnsIncome: number;
}

/** Contributions into investment, deposit and insurance accounts. */
export function investmentReport(ledger: Ledger, txns: LedgerTxn[], periods: Period[], o: PeriodOptions): InvestmentReport {
  const isInv = (a?: Account) => !!a && isInvestmentKind(a.kind);
  const rows = periods.map<ContributionRow>((period) => ({ period, net: 0, inflow: 0, outflow: 0 }));
  const idx = new Map(periods.map((p, i) => [p.key, i]));
  const perAccount = new Map<string, { contributed: number; withdrawn: number }>();
  let returnsIncome = 0;
  for (const t of txns) {
    if (t.kind === 'income' && isInv(t.account)) returnsIncome += t.amountMain;
    if (t.kind !== 'transfer') continue;
    const into = isInv(t.toAccount) && !isInv(t.account);
    const outOf = isInv(t.account) && !isInv(t.toAccount);
    if (!into && !outOf) continue;
    const row = rows[idx.get(periodOf(t.date, 'month', o).key) ?? -1];
    if (into) {
      if (row) row.inflow += t.amountMain;
      const e = perAccount.get(t.toAccountId!) ?? { contributed: 0, withdrawn: 0 };
      e.contributed += t.amountMain;
      perAccount.set(t.toAccountId!, e);
    } else {
      if (row) row.outflow += t.amountMain;
      const e = perAccount.get(t.accountId) ?? { contributed: 0, withdrawn: 0 };
      e.withdrawn += t.amountMain;
      perAccount.set(t.accountId, e);
    }
  }
  for (const r of rows) r.net = r.inflow - r.outflow;
  const last = periods.at(-1);
  const balances = last ? balanceTimeline(ledger.txns, [last]).byAccount : new Map<string, number[]>();
  const byAccount = ledger.ds.accounts
    .filter((a) => isInv(a))
    .map((account) => ({
      account,
      contributed: perAccount.get(account.id)?.contributed ?? 0,
      withdrawn: perAccount.get(account.id)?.withdrawn ?? 0,
      balance: balances.get(account.id)?.[0] ?? 0,
    }))
    .filter((r) => r.contributed || r.withdrawn || Math.abs(r.balance) > 0.5)
    .sort((a, b) => b.balance - a.balance);
  return {
    rows,
    byAccount,
    totalNet: rows.reduce((a, r) => a + r.net, 0),
    consistency: rows.length ? rows.filter((r) => r.net > 0).length / rows.length : 0,
    returnsIncome,
  };
}

export interface LoanReport {
  account: Account;
  outstanding: number;
  repaidInRange: number;
  avgMonthlyRepayment: number;
  /** Months to clear at the recent repayment pace; null when not repaying. */
  monthsToPayoff: number | null;
  /** Outstanding (positive) at the end of each period. */
  series: number[];
}

/** Loan accounts: how much is owed and how fast it is being repaid. */
export function loanReports(ledger: Ledger, periods: Period[], months: number): LoanReport[] {
  const timeline = balanceTimeline(ledger.txns, periods);
  const from = periods[0]?.start ?? ledger.first;
  const to = periods.at(-1)?.end ?? ledger.anchor;
  return ledger.ds.accounts
    .filter((a) => a.kind === 'loan')
    .map((account) => {
      const series = (timeline.byAccount.get(account.id) ?? periods.map(() => 0)).map((b) => Math.max(0, -b));
      const repaid = ledger.txns
        .filter((t) => t.kind === 'transfer' && t.toAccountId === account.id && t.date >= from && t.date <= to)
        .reduce((a, t) => a + t.amountMain, 0);
      const outstanding = series.at(-1) ?? 0;
      const avg = months > 0 ? repaid / months : 0;
      return {
        account,
        outstanding,
        repaidInRange: repaid,
        avgMonthlyRepayment: avg,
        monthsToPayoff: outstanding > 0 && avg > 0 ? Math.ceil(outstanding / avg) : null,
        series,
      };
    })
    .filter((r) => r.outstanding > 0.5 || r.repaidInRange > 0);
}
