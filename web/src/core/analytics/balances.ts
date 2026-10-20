import { isLiabilityKind, isLiquidKind, isInvestmentKind, type Ledger, type LedgerTxn, type Prefs } from '../ledger';
import type { Account, AccountKind, Dataset, IsoDate, Transaction } from '../model';
import type { Period } from './periods';

export interface AccountBalance {
  account: Account;
  groupName: string;
  /** In the account's currency. Negative for money owed (cards, loans). */
  balance: number;
  txnCount: number;
  lastActivity?: IsoDate;
}

/** Signed effect of a transaction on each account it touches. */
export function balanceDeltas(t: Transaction): [string, number][] {
  switch (t.kind) {
    case 'income':
    case 'adjustIn':
      return [[t.accountId, t.accountAmount]];
    case 'expense':
    case 'adjustOut':
      return [[t.accountId, -t.accountAmount]];
    case 'transfer':
      return t.toAccountId
        ? [
            [t.accountId, -t.accountAmount],
            [t.toAccountId, t.toAccountAmount ?? t.accountAmount],
          ]
        : [[t.accountId, -t.accountAmount]];
  }
}

/**
 * Balances rebuilt from the full history. The backup stores no balances;
 * opening balances are themselves "modify balance" entries, so they are included.
 */
export function accountBalances(ds: Dataset, asOf?: IsoDate): AccountBalance[] {
  const byId = new Map<string, { balance: number; txnCount: number; lastActivity?: IsoDate }>();
  for (const t of ds.transactions) {
    if (asOf && t.date > asOf) continue;
    for (const [id, delta] of balanceDeltas(t)) {
      const entry = byId.get(id) ?? { balance: 0, txnCount: 0 };
      entry.balance += delta;
      entry.txnCount++;
      if (!entry.lastActivity || t.date > entry.lastActivity) entry.lastActivity = t.date;
      byId.set(id, entry);
    }
  }
  const groupName = new Map(ds.accountGroups.map((g) => [g.id, g.name]));
  const groupOrder = new Map(ds.accountGroups.map((g) => [g.id, g.order]));
  return ds.accounts
    .map((account) => ({
      account,
      groupName: groupName.get(account.groupId) ?? '(no group)',
      balance: round2(byId.get(account.id)?.balance ?? 0),
      txnCount: byId.get(account.id)?.txnCount ?? 0,
      lastActivity: byId.get(account.id)?.lastActivity,
    }))
    .sort(
      (a, b) =>
        (groupOrder.get(a.account.groupId) ?? 0) - (groupOrder.get(b.account.groupId) ?? 0) ||
        a.account.order - b.account.order,
    );
}

export interface BalanceTimeline {
  periods: Period[];
  /** account id → balance at the end of each period. */
  byAccount: Map<string, number[]>;
}

/** Balance of every account at the end of each period (full history, so opening balances count). */
export function balanceTimeline(txns: LedgerTxn[], periods: Period[]): BalanceTimeline {
  const running = new Map<string, number>();
  const byAccount = new Map<string, number[]>();
  let i = 0;
  periods.forEach((p, pi) => {
    while (i < txns.length && txns[i].date <= p.end) {
      for (const [id, delta] of balanceDeltas(txns[i])) running.set(id, (running.get(id) ?? 0) + delta);
      i++;
    }
    for (const [id, bal] of running) {
      let series = byAccount.get(id);
      if (!series) {
        series = periods.map(() => 0);
        byAccount.set(id, series);
      }
      series[pi] = bal;
    }
  });
  return { periods, byAccount };
}

export type AccountClass = 'liquid' | 'investment' | 'liability' | 'other';

export function accountClass(kind: AccountKind): AccountClass {
  if (isLiabilityKind(kind)) return 'liability';
  if (isLiquidKind(kind)) return 'liquid';
  if (isInvestmentKind(kind)) return 'investment';
  return 'other';
}

export interface NetWorthPoint {
  period: Period;
  liquid: number;
  investments: number;
  /** Positive balances in other accounts (wallets, shared-expense accounts, receivables). */
  otherAssets: number;
  /** Negative number: everything owed (cards, loans, and negative balances elsewhere). */
  liabilities: number;
  assets: number;
  netWorth: number;
}

export function netWorthSeries(ledger: Ledger, prefs: Prefs, periods: Period[]): NetWorthPoint[] {
  const excluded = new Set(prefs.excludedAccountIds);
  const timeline = balanceTimeline(ledger.txns, periods);
  return periods.map((period, pi) => {
    const point = { period, liquid: 0, investments: 0, otherAssets: 0, liabilities: 0, assets: 0, netWorth: 0 };
    for (const [id, series] of timeline.byAccount) {
      const account = ledger.accountById.get(id);
      if (!account || excluded.has(id)) continue;
      const bal = series[pi];
      const cls = accountClass(account.kind);
      if (bal < 0 || cls === 'liability') point.liabilities += Math.min(bal, 0);
      if (bal <= 0) continue;
      if (cls === 'liquid') point.liquid += bal;
      else if (cls === 'investment') point.investments += bal;
      else if (cls === 'other') point.otherAssets += bal;
      else point.otherAssets += bal; // a card/loan in credit
    }
    point.assets = point.liquid + point.investments + point.otherAssets;
    point.netWorth = point.assets + point.liabilities;
    return point;
  });
}

export interface GroupAllocation {
  groupId: string;
  name: string;
  total: number;
  accounts: AccountBalance[];
}

export function allocationByGroup(balances: AccountBalance[], excludedIds: string[] = []): GroupAllocation[] {
  const excluded = new Set(excludedIds);
  const groups = new Map<string, GroupAllocation>();
  for (const b of balances) {
    if (excluded.has(b.account.id)) continue;
    const g = groups.get(b.account.groupId) ?? { groupId: b.account.groupId, name: b.groupName, total: 0, accounts: [] };
    g.total += b.balance;
    g.accounts.push(b);
    groups.set(b.account.groupId, g);
  }
  return [...groups.values()];
}

export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}
