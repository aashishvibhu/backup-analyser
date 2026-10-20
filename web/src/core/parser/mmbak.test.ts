import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { accountBalances } from '../analytics/balances';
import { cashflow } from '../analytics/cashflow';
import { buildLedger } from '../ledger';
import { MmbakFormatError, parseMmbak } from './mmbak';

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await initSqlJs();
});

// Minimal synthetic backup with the columns the parser reads.
function buildBackup(): Uint8Array {
  const db = new SQL.Database();
  db.run(`
    PRAGMA user_version = 19;
    CREATE TABLE ASSETGROUP (uid TEXT, ACC_GROUP_NAME TEXT, TYPE INT, ORDERSEQ INT, IS_DEL INT);
    CREATE TABLE ASSETS (uid TEXT, NIC_NAME TEXT, groupUid TEXT, currencyUid TEXT, ORDERSEQ INT, ZDATA TEXT,
      CARD_DAY_FIN TEXT, CARD_DAY_PAY TEXT, cardAssetUid TEXT);
    CREATE TABLE ZCATEGORY (uid TEXT, NAME TEXT, TYPE INT, pUid TEXT, ORDERSEQ INT, C_IS_DEL INT);
    CREATE TABLE CURRENCY (uid TEXT, ISO TEXT, NAME TEXT, SYMBOL TEXT, RATE REAL, IS_MAIN_CURRENCY INT, IS_DEL INT);
    CREATE TABLE ZETC (dataTypeKey TEXT, ZDATA TEXT);
    CREATE TABLE INOUTCOME (uid TEXT, DO_TYPE TEXT, ZMONEY TEXT, AMOUNT_ACCOUNT REAL, WDATE TEXT, ZDATE TEXT,
      assetUid TEXT, toAssetUid TEXT, ctgUid TEXT, ZCONTENT TEXT, txUidTrans TEXT, currencyUid TEXT, IS_DEL INT);

    INSERT INTO ASSETGROUP VALUES ('1','Accounts',1,1,0), ('2','Card',2,2,0);
    INSERT INTO ASSETS VALUES ('bank','Bank','1','INR_INR',1,'0','1','1',''),
                              ('cc','Card','2','INR_INR',2,'0','16','5','bank');
    INSERT INTO ZCATEGORY VALUES ('c-pay','Pay',0,NULL,1,NULL), ('c-food','Food',1,NULL,1,NULL),
                                 ('f1','Snacks',1,'c-food',1,NULL);
    INSERT INTO CURRENCY VALUES ('INR_INR','INR','Rupee','₹',1,1,0);
    INSERT INTO ZETC VALUES ('start_day','25');

    INSERT INTO INOUTCOME VALUES
      ('a','7','1000.0',1000,'2026-01-01','1767225600000','bank','','-4','Difference','', 'INR_INR',0),
      ('b','0','50000.0',50000,'2026-01-25','1769299200000','bank','','c-pay','','', 'INR_INR',0),
      ('c','1','200.5',200.5,'2026-01-26','1769385600000','cc','','f1','Brew Corner','', 'INR_INR',0),
      ('t1','3','200.5',200.5,'2026-02-10','1770681600000','bank','cc','','','p1','INR_INR',0),
      ('t2','4','200.5',200.5,'2026-02-10','1770681600000','cc','bank','','','p1','INR_INR',0),
      ('d','1','3.0',3,'2026-02-11','1770768000000','bank','','-4','Difference','', 'INR_INR',0),
      ('x','1','999.0',999,'2026-02-12','1770854400000','bank','','c-food','','', 'INR_INR',1);
  `);
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('parseMmbak', () => {
  it('rejects files that are not SQLite', () => {
    expect(() => parseMmbak(SQL, new TextEncoder().encode('x'.repeat(200)))).toThrow(MmbakFormatError);
  });

  it('decodes settings, accounts and transaction kinds', () => {
    const ds = parseMmbak(SQL, buildBackup());
    expect(ds.meta.schemaVersion).toBe(19);
    expect(ds.settings.monthStartDay).toBe(25);
    expect(ds.accounts.find((a) => a.id === 'cc')?.card).toEqual({ statementDay: 16, paymentDay: 5, paidFromAccountId: 'bank' });
    expect(ds.categories.find((c) => c.id === 'f1')?.parentId).toBe('c-food');

    const kinds = Object.fromEntries(ds.transactions.map((t) => [t.id, t.kind]));
    expect(kinds).toEqual({ a: 'adjustIn', b: 'income', c: 'expense', t1: 'transfer', d: 'expense' });
    expect(ds.transactions.find((t) => t.id === 'd')?.isBalanceCorrection).toBe(true);
    expect(ds.transactions.find((t) => t.id === 't1')).toMatchObject({ accountId: 'bank', toAccountId: 'cc', amount: 200.5 });
    expect(ds.meta.warnings).toEqual([]);
  });

  it('rebuilds balances and monthly totals', () => {
    const ds = parseMmbak(SQL, buildBackup());
    const balances = Object.fromEntries(accountBalances(ds).map((b) => [b.account.id, b.balance]));
    expect(balances).toEqual({ bank: 1000 + 50000 - 200.5 - 3, cc: 0 });

    const months = cashflow(buildLedger(ds).txns, 'month', { monthStartDay: 25, weekStartsOn: 1, fyStartMonth: 4 }, '2025-12-25', '2026-02-24');
    expect(months.map((m) => m.period.key)).toEqual(['2025-12', '2026-01']);
    expect(months[1]).toMatchObject({ income: 50000, expense: 203.5, correctionExpense: 3, transferTotal: 200.5 });
    expect(months[0]).toMatchObject({ income: 0, adjustIn: 1000 });
  });
});
