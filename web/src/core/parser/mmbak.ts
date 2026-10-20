// Parser for Realbyte Money Manager `.mmbak` backups (a renamed SQLite database).
// This is the only module that knows the raw schema; everything downstream uses `Dataset`.

import type { Database, SqlJsStatic } from 'sql.js';
import type {
  Account,
  AccountGroup,
  AccountKind,
  Budget,
  Category,
  Currency,
  Dataset,
  RecurringRule,
  Settings,
  Tag,
  Transaction,
  TxnKind,
} from '../model';

type Row = Record<string, unknown>;

const SQLITE_MAGIC = 'SQLite format 3\0';

/** System category used by the app's "modify balance" flow. */
const BALANCE_CORRECTION_CATEGORY = '-4';

const GROUP_KIND: Record<number, AccountKind> = {
  1: 'bank',
  2: 'creditCard',
  3: 'debitCard',
  4: 'deposit',
  5: 'loan',
  6: 'prepaid',
  7: 'other',
  8: 'investment',
  9: 'overdraft',
  10: 'insurance',
  11: 'cash',
};

const DO_TYPE_KIND: Record<string, TxnKind> = {
  '0': 'income',
  '1': 'expense',
  '7': 'adjustIn',
  '8': 'adjustOut',
};

export class MmbakFormatError extends Error {}

export function isSqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  return new TextDecoder('latin1').decode(bytes.subarray(0, 16)) === SQLITE_MAGIC;
}

export function parseMmbak(SQL: SqlJsStatic, bytes: Uint8Array, sourceName = 'backup.mmbak'): Dataset {
  if (!isSqliteFile(bytes)) {
    throw new MmbakFormatError('Not a Money Manager backup: the file is not a SQLite database.');
  }
  const db = new SQL.Database(bytes);
  try {
    return readDataset(db, sourceName);
  } finally {
    db.close();
  }
}

function readDataset(db: Database, sourceName: string): Dataset {
  const tables = new Set(all(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => str(r.name)));
  for (const required of ['INOUTCOME', 'ASSETS', 'ZCATEGORY']) {
    if (!tables.has(required)) {
      throw new MmbakFormatError(`Not a Money Manager backup: table ${required} is missing.`);
    }
  }
  const warnings: string[] = [];
  const read = (table: string): Row[] => (tables.has(table) ? all(db, `SELECT * FROM "${table}"`) : []);

  const schemaVersion = num(all(db, 'PRAGMA user_version')[0]?.user_version);

  const currencies = read('CURRENCY')
    .filter((r) => !truthy(r.IS_DEL))
    .map<Currency>((r) => ({
      id: str(r.uid),
      iso: str(r.ISO),
      name: str(r.NAME),
      symbol: str(r.SYMBOL),
      rate: num(r.RATE) || 1,
      isMain: truthy(r.IS_MAIN_CURRENCY),
    }));
  const mainCurrency = currencies.find((c) => c.isMain)?.iso ?? 'INR';
  const rateByCurrencyId = new Map(currencies.map((c) => [c.id, c.rate]));

  const accountGroups = read('ASSETGROUP').map<AccountGroup>((r) => ({
    id: str(r.uid),
    name: str(r.ACC_GROUP_NAME),
    kind: GROUP_KIND[num(r.TYPE)] ?? 'custom',
    order: num(r.ORDERSEQ),
    deleted: truthy(r.IS_DEL),
  }));
  const groupById = new Map(accountGroups.map((g) => [g.id, g]));

  const accounts = read('ASSETS').map<Account>((r) => {
    const groupId = str(r.groupUid);
    const kind = groupById.get(groupId)?.kind ?? 'custom';
    const account: Account = {
      id: str(r.uid),
      name: str(r.NIC_NAME).trim(),
      groupId,
      kind,
      currency: str(r.currencyUid),
      order: num(r.ORDERSEQ),
      statusFlag: num(r.ZDATA),
    };
    if (kind === 'creditCard') {
      account.card = {
        statementDay: num(r.CARD_DAY_FIN),
        paymentDay: num(r.CARD_DAY_PAY),
        paidFromAccountId: optStr(r.cardAssetUid),
      };
    }
    return account;
  });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const categories = read('ZCATEGORY').map<Category>((r) => ({
    id: str(r.uid),
    name: str(r.NAME).trim(),
    type: num(r.TYPE) === 0 ? 'income' : 'expense',
    parentId: optStr(r.pUid, ['0']),
    order: num(r.ORDERSEQ),
    deleted: truthy(r.C_IS_DEL),
  }));
  const categoryIds = new Set(categories.map((c) => c.id));

  const recurringRaw = read('REPEATTRANSACTION').filter((r) => !truthy(r.IS_DEL));
  const recurringIds = new Set(recurringRaw.map((r) => str(r.uid)));

  // --- transactions -------------------------------------------------------
  const rawTxns = read('INOUTCOME').filter((r) => !truthy(r.IS_DEL));
  const transactions: Transaction[] = [];
  const transferHalves = new Map<string, { out?: Row; in?: Row }>();
  let missingAccount = 0;
  let missingCategory = 0;
  let unknownType = 0;

  const toAmounts = (r: Row, accountId: string) => {
    const amount = Math.abs(num(r.ZMONEY));
    const currency = str(r.currencyUid);
    const accountCurrency = accountById.get(accountId)?.currency ?? currency;
    // AMOUNT_ACCOUNT is rounded to 2 dp; prefer the exact amount when no conversion applies.
    const accountAmount = accountCurrency === currency ? amount : Math.abs(num(r.AMOUNT_ACCOUNT, amount));
    return { amount, currency, accountAmount, amountMain: amount * (rateByCurrencyId.get(currency) ?? 1) };
  };

  for (const r of rawTxns) {
    const doType = str(r.DO_TYPE);
    if (doType === '3' || doType === '4') {
      const key = str(r.txUidTrans) || str(r.uid);
      const halves = transferHalves.get(key) ?? {};
      halves[doType === '3' ? 'out' : 'in'] = r;
      transferHalves.set(key, halves);
      continue;
    }
    const kind = DO_TYPE_KIND[doType];
    if (!kind) {
      unknownType++;
      continue;
    }
    const accountId = str(r.assetUid);
    if (!accountById.has(accountId)) missingAccount++;
    const rawCategory = optStr(r.ctgUid);
    const isBalanceCorrection = rawCategory === BALANCE_CORRECTION_CATEGORY;
    const categoryId = isBalanceCorrection ? undefined : rawCategory;
    if (categoryId && !categoryIds.has(categoryId)) missingCategory++;
    transactions.push({
      id: str(r.uid),
      kind,
      date: str(r.WDATE).slice(0, 10),
      timestamp: num(r.ZDATE),
      ...toAmounts(r, accountId),
      accountId,
      categoryId,
      memo: str(r.ZCONTENT).trim(),
      isBalanceCorrection,
      recurringId: recurringIdOf(str(r.uid), recurringIds),
    });
  }

  let unpairedTransfers = 0;
  for (const { out, in: incoming } of transferHalves.values()) {
    const base = out ?? incoming!;
    if (!out || !incoming) unpairedTransfers++;
    // On both halves assetUid/toAssetUid are from the row's own perspective.
    const fromId = out ? str(out.assetUid) : str(base.toAssetUid);
    const toId = out ? str(out.toAssetUid) : str(base.assetUid);
    if (!accountById.has(fromId) || !accountById.has(toId)) missingAccount++;
    const amounts = toAmounts(base, fromId);
    transactions.push({
      id: str(base.uid),
      kind: 'transfer',
      date: str(base.WDATE).slice(0, 10),
      timestamp: num(base.ZDATE),
      ...amounts,
      accountId: fromId,
      toAccountId: toId,
      toAccountAmount: incoming ? toAmounts(incoming, toId).accountAmount : amounts.accountAmount,
      memo: str(base.ZCONTENT).trim(),
      isBalanceCorrection: false,
      recurringId: recurringIdOf(str(base.uid), recurringIds),
    });
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.timestamp - b.timestamp);

  if (unknownType) warnings.push(`${unknownType} transactions have an unknown type and were skipped.`);
  if (unpairedTransfers) warnings.push(`${unpairedTransfers} transfers are missing one side.`);
  if (missingAccount) warnings.push(`${missingAccount} transactions reference an account that no longer exists.`);
  if (missingCategory) warnings.push(`${missingCategory} transactions reference a category that no longer exists.`);

  // --- budgets, recurring, tags, settings ---------------------------------
  const budgetAmounts = new Map(
    read('BUDGET_AMOUNT')
      .filter((r) => !truthy(r.IS_DEL))
      .map((r) => [str(r.budgetUid), num(r.AMOUNT)]),
  );
  const budgets = read('BUDGET')
    .filter((r) => !truthy(r.IS_DEL))
    .map<Budget>((r) => ({
      id: str(r.uid),
      categoryId: truthy(r.IS_TOTAL) ? undefined : optStr(r.targetUid),
      isTotal: truthy(r.IS_TOTAL),
      periodType: num(r.PERIOD_TYPE),
      amount: budgetAmounts.get(str(r.uid)) ?? 0,
    }));

  const recurring = recurringRaw.map<RecurringRule>((r) => ({
    id: str(r.uid),
    kind: DO_TYPE_KIND[str(r.DO_TYPE)] ?? 'transfer',
    repeatType: num(r.REPEAT_TYPE),
    amount: num(r.AMOUNT_SUB),
    accountId: str(r.assetUid),
    toAccountId: optStr(r.toAssetUid),
    categoryId: optStr(r.ctgUid),
    memo: str(r.MEMO),
    nextDate: num(r.NEXT_DATE) || undefined,
    endDate: num(r.END_DATE) || undefined,
  }));

  const tags = read('TAG')
    .filter((r) => !truthy(r.isDel))
    .map<Tag>((r) => ({ id: str(r.uid), name: str(r.name) }));
  const txnTags: Record<string, string[]> = {};
  for (const r of read('TX_TAG').filter((r) => !truthy(r.isDel))) {
    (txnTags[str(r.txUid)] ??= []).push(str(r.tagUid));
  }

  const rawSettings: Record<string, string> = {};
  for (const r of read('ZETC')) {
    const key = str(r.dataTypeKey);
    if (key) rawSettings[key] = str(r.ZDATA);
  }
  const settings: Settings = {
    monthStartDay: clamp(num(rawSettings.start_day, 1), 1, 31),
    weekStartDay: num(rawSettings.week_start_day, 1),
    carryOver: rawSettings.carry_over === '1',
    cardAccountingType: num(rawSettings.card_accounting_type),
    raw: rawSettings,
  };

  const rowCounts: Record<string, number> = {};
  for (const t of tables) {
    if (!t.startsWith('sqlite_')) rowCounts[t] = num(all(db, `SELECT count(*) AS n FROM "${t}"`)[0]?.n);
  }

  return {
    meta: { sourceName, schemaVersion, parsedAt: Date.now(), mainCurrency, warnings, rowCounts },
    settings,
    accountGroups,
    accounts,
    categories,
    currencies,
    transactions,
    budgets,
    recurring,
    tags,
    txnTags,
  };
}

// Rows created by a repeat rule have ids like `<ruleUid>_<YYYY-MM-DD>_<n>`.
function recurringIdOf(uid: string, ruleIds: Set<string>): string | undefined {
  const m = /^(.+)_\d{4}-\d{2}-\d{2}_\d+$/.exec(uid);
  return m && ruleIds.has(m[1]) ? m[1] : undefined;
}

function all(db: Database, sql: string): Row[] {
  const res = db.exec(sql)[0];
  if (!res) return [];
  return res.values.map((vals) => Object.fromEntries(res.columns.map((c, i) => [c, vals[i]])));
}

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function optStr(v: unknown, empties: string[] = []): string | undefined {
  const s = str(v).trim();
  return s === '' || empties.includes(s) ? undefined : s;
}

function num(v: unknown, fallback = 0): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function truthy(v: unknown): boolean {
  return num(v) !== 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
