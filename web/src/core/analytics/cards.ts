import { topCategoryName, type Ledger, type LedgerTxn } from '../ledger';
import type { Account, IsoDate } from '../model';
import { balanceDeltas } from './balances';
import { addDays, daysInMonth } from './periods';

/** 'late' = paid in full after the due date but before the next statement. */
export type CycleStatus = 'paid' | 'late' | 'partial' | 'unpaid' | 'nothing-due' | 'open';

export interface CardCycle {
  start: IsoDate;
  statement: IsoDate;
  due: IsoDate;
  spend: number;
  refunds: number;
  /** Amount owed at the statement date (≥ 0). */
  owed: number;
  /** Paid into the card after the statement, up to and including the due date. */
  paidByDue: number;
  /** Paid into the card after the statement, up to the next statement. */
  paidByNext: number;
  status: CycleStatus;
}

export interface CardReport {
  account: Account;
  cycles: CardCycle[];
  /** Current amount owed (≥ 0). */
  outstanding: number;
  /** Share of closed cycles with something due that were paid in full by the due date. */
  paidInFullRate: number | null;
  topCategories: { name: string; total: number }[];
}

function dayInMonth(year: number, month: number, day: number): IsoDate {
  const d = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Statement dates covering [from, to] plus the one after. */
function statementDates(day: number, from: IsoDate, to: IsoDate): IsoDate[] {
  let [y, m] = from.split('-').map(Number);
  const out: IsoDate[] = [];
  for (;;) {
    const s = dayInMonth(y, m, day);
    if (s >= from) out.push(s);
    if (s > to) break;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** First date on `payDay` strictly after the statement date. */
function dueDate(statement: IsoDate, payDay: number): IsoDate {
  let [y, m] = statement.split('-').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = dayInMonth(y, m, payDay);
    if (d > statement) return d;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return addDays(statement, 30);
}

/** Statement-cycle view of one credit card, based on the statement and payment days from the backup. */
export function cardReport(ledger: Ledger, account: Account, range: { from: IsoDate; to: IsoDate }): CardReport {
  const card = account.card ?? { statementDay: 1, paymentDay: 1 };
  const own = ledger.txns.filter((t) => t.accountId === account.id || t.toAccountId === account.id);
  const cycles: CardCycle[] = [];
  if (!own.length) return { account, cycles, outstanding: 0, paidInFullRate: null, topCategories: [] };

  const statements = statementDates(card.statementDay, addDays(own[0].date, -1), ledger.anchor);
  let balance = 0;
  let i = 0;
  let prevStatement = addDays(own[0].date, -1);
  const balanceAt = (date: IsoDate) => {
    while (i < own.length && own[i].date <= date) {
      for (const [id, d] of balanceDeltas(own[i])) if (id === account.id) balance += d;
      i++;
    }
    return balance;
  };

  statements.forEach((statement, si) => {
    const start = addDays(prevStatement, 1);
    prevStatement = statement;
    const inCycle = own.filter((t) => t.date >= start && t.date <= statement && t.accountId === account.id);
    const spend = sum(inCycle.filter((t) => t.kind === 'expense'));
    const refunds = sum(inCycle.filter((t) => t.kind === 'income'));
    const owed = Math.max(0, -balanceAt(statement));
    const due = dueDate(statement, card.paymentDay);
    const next = statements[si + 1] ?? addDays(statement, 31);
    const paidBetween = (until: IsoDate) =>
      sum(own.filter((t) => t.kind === 'transfer' && t.toAccountId === account.id && t.date > statement && t.date <= until));
    const paidByDue = paidBetween(due);
    const paidByNext = paidBetween(next > due ? next : due);
    const status: CycleStatus =
      statement > ledger.anchor || due > ledger.anchor
        ? 'open'
        : owed < 1
          ? 'nothing-due'
          : paidByDue >= owed - 1
            ? 'paid'
            : next <= ledger.anchor && paidByNext >= owed - 1
              ? 'late'
              : paidByNext > 0
                ? 'partial'
                : 'unpaid';
    if (statement >= range.from && start <= range.to) {
      cycles.push({ start, statement, due, spend, refunds, owed, paidByDue, paidByNext, status });
    }
  });

  const closed = cycles.filter((c) => c.status !== 'open' && c.status !== 'nothing-due');
  const spendInRange = own.filter((t) => t.kind === 'expense' && t.accountId === account.id && t.date >= range.from && t.date <= range.to);
  const cats = new Map<string, number>();
  for (const t of spendInRange) cats.set(topCategoryName(t), (cats.get(topCategoryName(t)) ?? 0) + t.amountMain);

  return {
    account,
    cycles,
    outstanding: Math.max(0, -balanceAt(ledger.anchor)),
    paidInFullRate: closed.length ? closed.filter((c) => c.status === 'paid').length / closed.length : null,
    topCategories: [...cats].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 6),
  };
}

function sum(txns: LedgerTxn[]): number {
  return txns.reduce((a, t) => a + t.accountAmount, 0);
}
