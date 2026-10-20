import { useMemo, useState } from 'react';
import { CORRECTION_CATEGORY_ID, topCategoryName, type LedgerTxn } from '../../core/ledger';
import type { TxnKind } from '../../core/model';
import { downloadCsv, Empty, Tile, Tiles } from '../components/ui';
import { fmtDate, fmtRange } from '../format';
import { go, useRoute } from '../router';
import { useApp } from '../store';

const KIND_LABEL: Record<TxnKind, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  adjustIn: 'Balance edit +',
  adjustOut: 'Balance edit −',
};

const PAGE = 100;

export function Transactions() {
  const { ledger, allTxns, txns: rangeTxns, fmt } = useApp();
  const { params } = useRoute();
  const linkFrom = params.get('from');
  const linkTo = params.get('to');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState(params.get('kind') ?? '');
  const [category, setCategory] = useState(params.get('category') ?? '');
  const [account, setAccount] = useState(params.get('account') ?? '');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [page, setPage] = useState(0);

  const base = useMemo(
    () => (linkFrom || linkTo ? allTxns.filter((t) => (!linkFrom || t.date >= linkFrom) && (!linkTo || t.date <= linkTo)) : rangeTxns),
    [allTxns, rangeTxns, linkFrom, linkTo],
  );

  const categories = useMemo(() => {
    const tops = ledger.ds.categories.filter((c) => !c.parentId && !c.deleted).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return tops.map((t) => ({ top: t, subs: ledger.ds.categories.filter((c) => c.parentId === t.id && !c.deleted) }));
  }, [ledger]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = min ? Number(min) : -Infinity;
    const hi = max ? Number(max) : Infinity;
    const rows = base.filter((t) => {
      if (kind && t.kind !== kind) return false;
      if (category) {
        if (category === CORRECTION_CATEGORY_ID) {
          if (!t.isBalanceCorrection) return false;
        } else if (t.categoryId !== category && t.topCategory?.id !== category) return false;
      }
      if (account && t.accountId !== account && t.toAccountId !== account) return false;
      if (t.amountMain < lo || t.amountMain > hi) return false;
      if (needle) {
        const hay = `${t.memo} ${t.category?.name ?? ''} ${t.topCategory?.name ?? ''} ${t.account?.name ?? ''} ${t.toAccount?.name ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sortDesc ? -1 : 1;
    return rows.sort((a, b) =>
      sortBy === 'amount' ? (a.amountMain - b.amountMain) * dir : (a.date.localeCompare(b.date) || a.timestamp - b.timestamp) * dir,
    );
  }, [base, q, kind, category, account, min, max, sortDesc, sortBy]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filtered) {
      if (t.kind === 'income') income += t.amountMain;
      if (t.kind === 'expense') expense += t.amountMain;
    }
    return { income, expense };
  }, [filtered]);

  const mainCurrencyId = ledger.ds.currencies.find((c) => c.isMain)?.id;
  const shown = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const pages = Math.ceil(filtered.length / PAGE);
  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

  const exportCsv = () =>
    downloadCsv(
      'transactions.csv',
      ['Date', 'Time', 'Type', 'Category', 'Subcategory', 'Account', 'To account', 'Amount', 'Currency', 'Note', 'Balance correction'],
      filtered.map((t) => [
        t.date,
        t.timestamp ? new Date(t.timestamp).toTimeString().slice(0, 5) : '',
        KIND_LABEL[t.kind],
        t.kind === 'income' || t.kind === 'expense' ? topCategoryName(t) : '',
        t.category && t.category.id !== t.topCategory?.id ? t.category.name : '',
        t.account?.name ?? '',
        t.toAccount?.name ?? '',
        t.amount.toFixed(2),
        t.currency,
        t.memo,
        t.isBalanceCorrection ? 'yes' : '',
      ]),
    );

  return (
    <>
      {(linkFrom || linkTo) && (
        <p className="notice">
          Showing {fmtRange(linkFrom ?? ledger.first, linkTo ?? ledger.anchor)} from a link.{' '}
          <button className="link-btn" onClick={() => go('transactions')}>
            Use the date range instead
          </button>
        </p>
      )}
      <div className="filters">
        <input type="search" placeholder="Search notes, categories, accounts" aria-label="Search" value={q} onChange={(e) => reset(() => setQ(e.target.value))} />
        <select aria-label="Type" value={kind} onChange={(e) => reset(() => setKind(e.target.value))}>
          <option value="">All types</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => reset(() => setCategory(e.target.value))}>
          <option value="">All categories</option>
          {categories.map(({ top, subs }) => [
            <option key={top.id} value={top.id}>
              {top.name} ({top.type})
            </option>,
            ...subs.map((s) => (
              <option key={s.id} value={s.id}>
                {'   '}
                {s.name}
              </option>
            )),
          ])}
          <option value={CORRECTION_CATEGORY_ID}>Balance corrections</option>
        </select>
        <select aria-label="Account" value={account} onChange={(e) => reset(() => setAccount(e.target.value))}>
          <option value="">All accounts</option>
          {ledger.ds.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input type="number" inputMode="decimal" placeholder="Min" aria-label="Minimum amount" value={min} onChange={(e) => reset(() => setMin(e.target.value))} />
        <input type="number" inputMode="decimal" placeholder="Max" aria-label="Maximum amount" value={max} onChange={(e) => reset(() => setMax(e.target.value))} />
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
          Export CSV
        </button>
      </div>
      <Tiles>
        <Tile label="Transactions" value={filtered.length.toLocaleString('en-IN')} />
        <Tile label="Income" value={fmt.money(totals.income)} />
        <Tile label="Spending" value={fmt.money(totals.expense)} />
      </Tiles>
      {!filtered.length ? (
        <Empty>No transactions match these filters.</Empty>
      ) : (
        <section className="card wide">
          <div className="scroll">
            <table className="txn-table">
              <thead>
                <tr>
                  <th>
                    <button className="th-btn" onClick={() => (sortBy === 'date' ? setSortDesc((d) => !d) : (setSortBy('date'), setSortDesc(true)))}>
                      Date{sortBy === 'date' ? (sortDesc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                  <th>Category</th>
                  <th>Note</th>
                  <th>Account</th>
                  <th className="num">
                    <button className="th-btn" onClick={() => (sortBy === 'amount' ? setSortDesc((d) => !d) : (setSortBy('amount'), setSortDesc(true)))}>
                      Amount{sortBy === 'amount' ? (sortDesc ? ' ↓' : ' ↑') : ''}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <Row key={t.id} t={t} money={fmt.exact} mainCurrencyId={mainCurrencyId} />
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="pager">
              <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span className="muted small">
                Page {page + 1} of {pages}
              </span>
              <button className="btn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Row({ t, money, mainCurrencyId }: { t: LedgerTxn; money: (n: number) => string; mainCurrencyId?: string }) {
  const sign = t.kind === 'income' || t.kind === 'adjustIn' ? '+' : t.kind === 'transfer' ? '' : '−';
  const cls = t.kind === 'income' || t.kind === 'adjustIn' ? 'pos' : t.kind === 'transfer' ? 'muted' : '';
  const cat =
    t.kind === 'transfer'
      ? 'Transfer'
      : t.kind === 'adjustIn' || t.kind === 'adjustOut'
        ? 'Balance edit'
        : t.category && t.category.id !== t.topCategory?.id
          ? `${topCategoryName(t)} › ${t.category.name}`
          : topCategoryName(t);
  return (
    <tr>
      <td className="nowrap">{fmtDate(t.date)}</td>
      <td>{cat}</td>
      <td className="memo">{t.memo}</td>
      <td className="nowrap">
        {t.account?.name ?? '–'}
        {t.kind === 'transfer' && <> → {t.toAccount?.name ?? '–'}</>}
      </td>
      <td className={`num nowrap ${cls}`}>
        {sign}
        {money(t.amount).replace('−', '')}
        {mainCurrencyId && t.currency !== mainCurrencyId ? ` ${t.currency.split('_')[0]}` : ''}
      </td>
    </tr>
  );
}
