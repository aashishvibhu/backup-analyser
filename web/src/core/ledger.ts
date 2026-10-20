// Enriched, filterable view of a Dataset that every analytic works from.

import type { Account, AccountGroup, AccountKind, Category, Dataset, IsoDate, Transaction } from './model';
import type { DateRange, PeriodOptions } from './analytics/periods';

export interface LedgerTxn extends Transaction {
  account?: Account;
  toAccount?: Account;
  category?: Category;
  /** The top-level category (the category itself when it has no parent). */
  topCategory?: Category;
  tagIds: string[];
}

export interface Ledger {
  ds: Dataset;
  /** Sorted by date, then time. */
  txns: LedgerTxn[];
  accountById: Map<string, Account>;
  groupById: Map<string, AccountGroup>;
  categoryById: Map<string, Category>;
  /** First and last transaction dates. */
  first: IsoDate;
  anchor: IsoDate;
}

/** User choices that change how numbers are computed. Stored per device. */
export interface Prefs {
  /** null = use the start day from the backup's settings. */
  monthStartDay: number | null;
  fyStartMonth: number;
  /** Count "modify balance" income/expense entries as real income/expense. */
  includeCorrections: boolean;
  /** Accounts left out of every analytic (their transactions are dropped). */
  excludedAccountIds: string[];
  /** Categories treated as one-off/big-ticket and left out of "core" spend. */
  oneOffCategoryIds: string[];
  excludedTagIds: string[];
}

export const DEFAULT_PREFS: Prefs = {
  monthStartDay: null,
  fyStartMonth: 4,
  includeCorrections: true,
  excludedAccountIds: [],
  oneOffCategoryIds: [],
  excludedTagIds: [],
};

/** Synthetic category id for "modify balance" corrections recorded as income/expense. */
export const CORRECTION_CATEGORY_ID = '__correction__';

const LIABILITY_KINDS: AccountKind[] = ['creditCard', 'loan', 'overdraft'];
const LIQUID_KINDS: AccountKind[] = ['cash', 'bank', 'prepaid'];
const INVESTMENT_KINDS: AccountKind[] = ['investment', 'deposit', 'insurance'];

export const isLiabilityKind = (k: AccountKind) => LIABILITY_KINDS.includes(k);
export const isLiquidKind = (k: AccountKind) => LIQUID_KINDS.includes(k);
export const isInvestmentKind = (k: AccountKind) => INVESTMENT_KINDS.includes(k);

export function buildLedger(ds: Dataset): Ledger {
  const accountById = new Map(ds.accounts.map((a) => [a.id, a]));
  const groupById = new Map(ds.accountGroups.map((g) => [g.id, g]));
  const categoryById = new Map(ds.categories.map((c) => [c.id, c]));
  const txns = ds.transactions.map<LedgerTxn>((t) => {
    const category = t.categoryId ? categoryById.get(t.categoryId) : undefined;
    const parent = category?.parentId ? categoryById.get(category.parentId) : undefined;
    return {
      ...t,
      account: accountById.get(t.accountId),
      toAccount: t.toAccountId ? accountById.get(t.toAccountId) : undefined,
      category,
      topCategory: parent ?? category,
      tagIds: ds.txnTags[t.id] ?? [],
    };
  });
  return {
    ds,
    txns,
    accountById,
    groupById,
    categoryById,
    first: txns[0]?.date ?? new Date().toISOString().slice(0, 10),
    anchor: txns.at(-1)?.date ?? new Date().toISOString().slice(0, 10),
  };
}

export function periodOptions(ledger: Ledger, prefs: Prefs): PeriodOptions {
  // Android stores java.util.Calendar constants: 1 = Sunday, 2 = Monday, …
  const raw = ledger.ds.settings.weekStartDay;
  return {
    monthStartDay: prefs.monthStartDay ?? ledger.ds.settings.monthStartDay,
    weekStartsOn: raw >= 1 && raw <= 7 ? raw - 1 : 1,
    fyStartMonth: prefs.fyStartMonth,
  };
}

/** Transactions that pass the user's prefs (accounts, tags, corrections), optionally within a range. */
export function selectTxns(ledger: Ledger, prefs: Prefs, range?: DateRange): LedgerTxn[] {
  const excludedAccounts = new Set(prefs.excludedAccountIds);
  const excludedTags = new Set(prefs.excludedTagIds);
  return ledger.txns.filter((t) => {
    if (range && (t.date < range.from || t.date > range.to)) return false;
    if (!prefs.includeCorrections && t.isBalanceCorrection) return false;
    if (excludedAccounts.has(t.accountId) && (!t.toAccountId || excludedAccounts.has(t.toAccountId))) return false;
    if (excludedTags.size && t.tagIds.some((id) => excludedTags.has(id))) return false;
    return true;
  });
}

export function isOneOff(t: LedgerTxn, oneOffIds: Set<string>): boolean {
  return (!!t.categoryId && oneOffIds.has(t.categoryId)) || (!!t.topCategory && oneOffIds.has(t.topCategory.id));
}

/** Display name for a transaction's top-level category. */
export function topCategoryName(t: LedgerTxn): string {
  if (t.isBalanceCorrection) return 'Balance corrections';
  return t.topCategory?.name ?? 'Uncategorised';
}

export function topCategoryKey(t: LedgerTxn): string {
  if (t.isBalanceCorrection) return CORRECTION_CATEGORY_ID;
  return t.topCategory?.id ?? '__none__';
}
