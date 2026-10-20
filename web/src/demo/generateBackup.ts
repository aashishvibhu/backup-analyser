// Builds a realistic, fully synthetic Money Manager backup (SQLite bytes) for demos and tests.
// Deterministic: the same seed always produces the same file.

import type { SqlJsStatic } from 'sql.js';

const START = '2024-01-01';
const END = '2025-12-31';
const IST_OFFSET_MS = 330 * 60_000;

type Kind = 'income' | 'expense' | 'adjustIn' | 'adjustOut';
const DO_TYPE: Record<Kind, string> = { income: '0', expense: '1', adjustIn: '7', adjustOut: '8' };

interface Row {
  uid: string;
  doType: string;
  amount: number;
  date: string;
  time: number;
  asset: string;
  toAsset: string;
  ctg: string;
  memo: string;
  pair: string;
}

const GROUPS: [string, string, number][] = [
  ['11', 'Cash', 11],
  ['1', 'Accounts', 1],
  ['2', 'Card', 2],
  ['4', 'Deposit', 4],
  ['8', 'Investments', 8],
  ['5', 'Loan', 5],
  ['g-shared', 'Shared', 0],
];

// id, name, group, statement day, payment day, paid-from
const ACCOUNTS: [string, string, string, number, number, string][] = [
  ['cash', 'Wallet', '11', 1, 1, ''],
  ['bank1', 'Salary Account', '1', 1, 1, ''],
  ['bank2', 'Savings Account', '1', 1, 1, ''],
  ['cc1', 'Travel Card', '2', 15, 5, 'bank1'],
  ['cc2', 'Rewards Card', '2', 2, 22, 'bank1'],
  ['fd', 'Fixed Deposit', '4', 1, 1, ''],
  ['mf', 'Index Fund SIP', '8', 1, 1, ''],
  ['stocks', 'Stocks', '8', 1, 1, ''],
  ['carloan', 'Car Loan', '5', 1, 1, ''],
  ['trip', 'Holiday Fund', 'g-shared', 1, 1, ''],
];

// id, name, type (0 income, 1 expense), parent
const CATEGORIES: [string, string, number, string][] = [
  ['i1', 'Salary', 0, ''],
  ['i2', 'Interest', 0, ''],
  ['i3', 'Rewards', 0, ''],
  ['i3a', 'Card points', 0, 'i3'],
  ['i3b', 'Wallet bonus', 0, 'i3'],
  ['i4', 'Bonus', 0, ''],
  ['e1', 'Food', 1, ''],
  ['e1a', 'Groceries', 1, 'e1'],
  ['e1b', 'Restaurants', 1, 'e1'],
  ['e1c', 'Snacks', 1, 'e1'],
  ['e2', 'Transport', 1, ''],
  ['e2a', 'Fuel', 1, 'e2'],
  ['e2b', 'Cab', 1, 'e2'],
  ['e3', 'Rent', 1, ''],
  ['e4', 'Bills', 1, ''],
  ['e4a', 'Electricity', 1, 'e4'],
  ['e4b', 'Mobile', 1, 'e4'],
  ['e4c', 'Internet', 1, 'e4'],
  ['e5', 'Subscriptions', 1, ''],
  ['e5a', 'Video streaming', 1, 'e5'],
  ['e5b', 'Audio streaming', 1, 'e5'],
  ['e6', 'Shopping', 1, ''],
  ['e6a', 'Clothes', 1, 'e6'],
  ['e6b', 'Home tech', 1, 'e6'],
  ['e7', 'Health', 1, ''],
  ['e8', 'Gifts', 1, ''],
  ['e9', 'Travel', 1, ''],
  ['e10', 'Furniture', 1, ''],
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoBackup(SQL: SqlJsStatic, seed = 42): Uint8Array {
  const rand = mulberry32(seed);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  const rows: Row[] = [];
  const balances = new Map<string, number>();
  let seq = 0;
  const at = (date: string, hour: number) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d, hour, between(0, 59)) - IST_OFFSET_MS;
  };
  const bump = (acc: string, delta: number) => balances.set(acc, (balances.get(acc) ?? 0) + delta);

  const add = (kind: Kind, date: string, amount: number, asset: string, ctg: string, memo = '', hour = 12, uid?: string) => {
    rows.push({ uid: uid ?? `t${++seq}`, doType: DO_TYPE[kind], amount, date, time: at(date, hour), asset, toAsset: '', ctg, memo, pair: '' });
    bump(asset, kind === 'income' || kind === 'adjustIn' ? amount : -amount);
  };
  const transfer = (date: string, amount: number, from: string, to: string, memo = '', hour = 10) => {
    const pair = `p${++seq}`;
    const time = at(date, hour);
    rows.push({ uid: `t${++seq}`, doType: '3', amount, date, time, asset: from, toAsset: to, ctg: '', memo, pair });
    rows.push({ uid: `t${++seq}`, doType: '4', amount, date, time, asset: to, toAsset: from, ctg: '', memo, pair });
    bump(from, -amount);
    bump(to, amount);
  };

  // Opening balances, entered the way the app does it ("Difference" adjustments).
  add('adjustIn', START, 150000, 'bank1', '-4', 'Difference', 9);
  add('adjustIn', START, 25000, 'bank2', '-4', 'Difference', 9);
  add('adjustIn', START, 3000, 'cash', '-4', 'Difference', 9);
  add('adjustIn', START, 200000, 'mf', '-4', 'Difference', 9);
  add('adjustOut', START, 480000, 'carloan', '-4', 'Difference', 9);

  const statementOwed = new Map<string, number>();
  const restaurants = ['Corner Cafe', 'Spice Route', 'Noodle Bar', 'Green Bowl', 'Harbour Table', 'Thali House'];

  for (let d = new Date(`${START}T00:00:00Z`); d <= new Date(`${END}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    const [y, m, day] = date.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const weekday = d.getUTCDay();
    const ym = y * 100 + m;

    // Card payments first thing on the due date (in full, except one partial month).
    for (const [id, , , , pay] of ACCOUNTS.filter((a) => a[2] === '2')) {
      if (day === Math.min(pay, lastDay) && (statementOwed.get(id) ?? 0) > 0) {
        const owed = statementOwed.get(id)!;
        transfer(date, id === 'cc1' && ym === 202508 ? Math.round(owed * 0.6) : owed, 'bank1', id, 'Card bill', 11);
        statementOwed.set(id, 0);
      }
    }

    // Income
    if (day === lastDay) add('income', date, ym >= 202504 ? 95000 : 85000, 'bank1', 'i1', 'Monthly pay', 10);
    if (ym === 202403 || ym === 202503) if (day === 20) add('income', date, 50000, 'bank1', 'i4', 'Annual bonus', 10);
    if (day === 28 && m % 3 === 0 && ym >= 202406) add('income', date, 1850, 'fd', 'i2', 'FD interest', 9);
    if (day === 25) add('income', date, between(50, 320), 'cc2', 'i3a', 'Card points', 9);
    if (rand() < 0.03) add('income', date, between(5, 80), 'bank2', 'i3b', 'Wallet bonus', 18);

    // Fixed outflows
    if (day === 1) transfer(date, 5000, 'bank1', 'cash', 'ATM', 9);
    if (day === 15) transfer(date, 3000, 'bank1', 'cash', 'ATM', 9);
    if (day === 2) add('expense', date, ym >= 202504 ? 22000 : 20000, 'bank1', 'e3', 'Flat rent', 9);
    if (day === 5) transfer(date, 10000, 'bank1', 'mf', 'SIP', 9);
    if (day === 7) transfer(date, 12500, 'bank1', 'carloan', 'Car EMI', 9);
    if (day === 10) add('expense', date, between(1200, m >= 4 && m <= 6 ? 3400 : 2200), 'bank1', 'e4a', 'Power bill', 19);
    if (day === 5) add('expense', date, 299, 'cc2', 'e4b', 'Phone plan', 8);
    if (day === 8) add('expense', date, 799, 'bank1', 'e4c', 'FiberLink Internet', 8);
    if (day === 12) add('expense', date, 649, 'cc2', 'e5a', 'StreamBox', 2, `r-stream_${date}_1`);
    if (day === 20 && ym <= 202509) add('expense', date, 119, 'cc2', 'e5b', 'TuneCloud', 2);

    // Variable spend
    if (weekday === 6) add('expense', date, between(1500, 3600), pick(['cc1', 'cash']), 'e1a', pick(['FreshMart', 'Daily Basket', 'Green Grocer']), 11);
    if (rand() < 0.2) add('expense', date, between(300, 1600), pick(['cc2', 'bank2']), 'e1b', pick(restaurants), pick([13, 20, 21]));
    if (rand() < 0.35) add('expense', date, between(30, 220), 'cash', 'e1c', pick(['Brew Corner', 'Fresh Press', 'Bakery']), pick([11, 17, 22]));
    if (day === 3 || day === 18) add('expense', date, between(1500, 2600), 'cc1', 'e2a', 'Fuel station', 8);
    if (rand() < 0.13) add('expense', date, between(150, 650), 'bank2', 'e2b', pick(['City Cabs', 'Auto ride', 'Rickshaw']), pick([9, 19, 23]));
    if (rand() < 0.07) add('expense', date, between(500, 4200), pick(['cc1', 'cc2']), 'e6a', pick(['Fashion Hub', 'Shoe Corner', 'Online order']), 16);
    if (rand() < 0.03) add('expense', date, between(300, 2500), 'bank2', 'e7', pick(['Pharmacy', 'Clinic']), 18);
    if ((m === 10 || m === 11) && rand() < 0.1) add('expense', date, between(800, 5000), 'cc1', 'e8', 'Festival gifts', 17);
    if (rand() < 0.01) add('expense', date, between(1, 60), 'cash', '-4', 'Difference', 23);

    // One-offs and events
    if (date === '2024-06-10') transfer(date, 100000, 'bank1', 'fd', 'FD opened');
    if (date === '2024-11-16') add('expense', date, 72000, 'cc1', 'e6b', 'Refrigerator', 15);
    if (date === '2024-12-20') {
      add('expense', date, 24000, 'cc1', 'e9', 'Beach holiday', 14);
      transfer(date, 12000, 'bank1', 'trip', 'Share paid for friends');
    }
    if (date === '2025-01-10') transfer(date, 8000, 'trip', 'bank2', 'Friends repaid');
    if (date === '2025-05-12') add('expense', date, 120000, 'bank1', 'e10', 'Sofa set', 12, 'big-1');
    if (date === '2025-02-14' || date === '2025-08-14') transfer(date, 25000, 'bank2', 'stocks', 'Buy shares');

    // Statement closes at the end of the statement day.
    for (const [id, , , stmt] of ACCOUNTS.filter((a) => a[2] === '2')) {
      if (day === Math.min(stmt, lastDay)) statementOwed.set(id, Math.max(0, -(balances.get(id) ?? 0)));
    }
  }

  // ---------------------------------------------------------------- write SQLite
  const db = new SQL.Database();
  db.run(`
    PRAGMA user_version = 19;
    CREATE TABLE ASSETGROUP (uid TEXT, ACC_GROUP_NAME TEXT, TYPE INT, ORDERSEQ INT, IS_DEL INT);
    CREATE TABLE ASSETS (ID INTEGER PRIMARY KEY, uid TEXT, NIC_NAME TEXT, groupUid TEXT, currencyUid TEXT, ORDERSEQ INT,
      ZDATA TEXT, CARD_DAY_FIN TEXT, CARD_DAY_PAY TEXT, cardAssetUid TEXT);
    CREATE TABLE ZCATEGORY (ID INTEGER PRIMARY KEY, uid TEXT, NAME TEXT, TYPE INT, pUid TEXT, ORDERSEQ INT, STATUS INT, C_IS_DEL INT);
    CREATE TABLE CURRENCY (uid TEXT, ISO TEXT, NAME TEXT, SYMBOL TEXT, RATE REAL, IS_MAIN_CURRENCY INT, IS_DEL INT);
    CREATE TABLE ZETC (dataTypeKey TEXT, ZDATA TEXT);
    CREATE TABLE INOUTCOME (uid TEXT, DO_TYPE TEXT, ZMONEY TEXT, IN_ZMONEY TEXT, AMOUNT_ACCOUNT REAL, WDATE TEXT, ZDATE TEXT,
      assetUid TEXT, toAssetUid TEXT, ctgUid TEXT, ZCONTENT TEXT, txUidTrans TEXT, currencyUid TEXT, IS_DEL INT);
    CREATE TABLE BUDGET (uid TEXT, targetUid TEXT, DO_TYPE INT, PERIOD_TYPE INT, IS_TOTAL INT, IS_DEL INT);
    CREATE TABLE BUDGET_AMOUNT (uid TEXT, budgetUid TEXT, AMOUNT REAL, IS_DEL INT);
    CREATE TABLE REPEATTRANSACTION (uid TEXT, DO_TYPE INT, REPEAT_TYPE INT, AMOUNT_SUB REAL, assetUid TEXT, toAssetUid TEXT,
      ctgUid TEXT, MEMO TEXT, NEXT_DATE INT, END_DATE INT, IS_DEL INT);
    CREATE TABLE TAG (uid TEXT, name TEXT, isDel INT);
    CREATE TABLE TX_TAG (uid TEXT, txUid TEXT, tagUid TEXT, isDel INT);
  `);
  const insert = (sql: string, rowsToInsert: unknown[][]) => {
    const stmt = db.prepare(sql);
    for (const r of rowsToInsert) stmt.run(r as never);
    stmt.free();
  };
  insert('INSERT INTO ASSETGROUP VALUES (?,?,?,?,0)', GROUPS.map(([id, name, type], i) => [id, name, type, i]));
  insert(
    'INSERT INTO ASSETS (uid,NIC_NAME,groupUid,currencyUid,ORDERSEQ,ZDATA,CARD_DAY_FIN,CARD_DAY_PAY,cardAssetUid) VALUES (?,?,?,?,?,?,?,?,?)',
    ACCOUNTS.map(([id, name, group, stmt, pay, from], i) => [id, name, group, 'INR_INR', i, '0', String(stmt), String(pay), from]),
  );
  insert(
    'INSERT INTO ZCATEGORY (uid,NAME,TYPE,pUid,ORDERSEQ,STATUS,C_IS_DEL) VALUES (?,?,?,?,?,?,NULL)',
    CATEGORIES.map(([id, name, type, parent], i) => [id, name, type, parent || null, i, parent ? 2 : 0]),
  );
  insert('INSERT INTO CURRENCY VALUES (?,?,?,?,?,?,0)', [['INR_INR', 'INR', 'INR - India (₹)', '₹', 1, 1]]);
  insert('INSERT INTO ZETC VALUES (?,?)', [
    ['start_day', '1'],
    ['week_start_day', '2'],
    ['carry_over', '0'],
    ['card_accounting_type', '0'],
  ]);
  insert(
    'INSERT INTO INOUTCOME VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)',
    rows.map((r) => [
      r.uid,
      r.doType,
      r.amount.toFixed(2),
      r.amount.toFixed(2),
      r.amount,
      r.date,
      String(r.time),
      r.asset,
      r.toAsset,
      r.ctg,
      r.memo,
      r.pair,
      'INR_INR',
    ]),
  );
  insert('INSERT INTO BUDGET VALUES (?,?,1,6,0,0)', [
    ['b-food', 'e1'],
    ['b-shop', 'e6'],
    ['b-transport', 'e2'],
  ]);
  insert('INSERT INTO BUDGET_AMOUNT VALUES (?,?,?,0)', [
    ['ba1', 'b-food', 12000],
    ['ba2', 'b-shop', 4000],
    ['ba3', 'b-transport', 6000],
  ]);
  insert('INSERT INTO REPEATTRANSACTION VALUES (?,1,1,649,?,?,?,?,?,0,0)', [
    ['r-stream', 'cc2', '', 'e5a', 'StreamBox', Date.UTC(2026, 0, 12)],
  ]);
  insert('INSERT INTO TAG VALUES (?,?,0)', [
    ['tag-skip', 'Not my expense'],
    ['tag-reimb', 'Reimbursable'],
  ]);
  insert('INSERT INTO TX_TAG VALUES (?,?,?,0)', [['tt1', 'big-1', 'tag-skip']]);

  const bytes = db.export();
  db.close();
  return bytes;
}
