import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_PREFS, periodOptions, selectTxns, topCategoryKey, type Ledger, type LedgerTxn, type Prefs } from '../core/ledger';
import { previousRange, rangeForPreset, type DateRange, type PeriodOptions, type RangePreset } from '../core/analytics/periods';
import { makeFormatter, type Formatter } from './format';
import { readJson, writeJson } from './storage';

interface ViewState {
  preset: RangePreset;
  custom?: DateRange;
}

export interface AppState {
  ledger: Ledger;
  fmt: Formatter;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  o: PeriodOptions;
  preset: RangePreset;
  range: DateRange;
  prevRange: DateRange;
  setPreset: (p: RangePreset) => void;
  setCustomRange: (r: DateRange) => void;
  /** All transactions that pass the prefs, any date. */
  allTxns: LedgerTxn[];
  /** Transactions in the selected range. */
  txns: LedgerTxn[];
  /** Transactions in the range just before the selected one (same length). */
  prevTxns: LedgerTxn[];
  oneOff: Set<string>;
  /** Stable colour slot (1–7) for a top-level category, or 0 for "other". Follows the entity, not the current rank. */
  categorySlot: (topCategoryId: string) => number;
  close: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useApp outside AppProvider');
  return s;
}

/** Prefs are stored per backup: the fingerprint is the set of account ids. */
function fingerprint(ledger: Ledger): string {
  let h = 5381;
  for (const id of ledger.ds.accounts.map((a) => a.id).sort().join('|')) h = ((h << 5) + h + id.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function AppProvider({ ledger, onClose, children }: { ledger: Ledger; onClose: () => void; children: ReactNode }) {
  const key = fingerprint(ledger);
  const [prefs, setPrefsState] = useState<Prefs>(() => readJson(`prefs:${key}`, DEFAULT_PREFS));
  const [view, setView] = useState<ViewState>(() => readJson<ViewState>(`view:${key}`, { preset: 'last12' }));

  const setPrefs = useCallback(
    (patch: Partial<Prefs>) =>
      setPrefsState((p) => {
        const next = { ...p, ...patch };
        writeJson(`prefs:${key}`, next);
        return next;
      }),
    [key],
  );
  const saveView = useCallback(
    (v: ViewState) => {
      setView(v);
      writeJson(`view:${key}`, v);
    },
    [key],
  );

  const o = useMemo(() => periodOptions(ledger, prefs), [ledger, prefs]);
  const range = useMemo(
    () => (view.preset === 'custom' && view.custom ? view.custom : rangeForPreset(view.preset, ledger.anchor, ledger.first, o)),
    [view, ledger, o],
  );
  const prevRange = useMemo(() => previousRange(range), [range]);
  const allTxns = useMemo(() => selectTxns(ledger, prefs), [ledger, prefs]);
  const txns = useMemo(() => allTxns.filter((t) => t.date >= range.from && t.date <= range.to), [allTxns, range]);
  const prevTxns = useMemo(() => allTxns.filter((t) => t.date >= prevRange.from && t.date <= prevRange.to), [allTxns, prevRange]);
  const oneOff = useMemo(() => new Set(prefs.oneOffCategoryIds), [prefs.oneOffCategoryIds]);

  const slots = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of ledger.txns) if (t.kind === 'expense' || t.kind === 'income') totals.set(topCategoryKey(t), (totals.get(topCategoryKey(t)) ?? 0) + t.amountMain);
    const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return new Map(ranked.slice(0, 7).map((id, i) => [id, i + 1]));
  }, [ledger]);

  const value = useMemo<AppState>(
    () => ({
      ledger,
      fmt: makeFormatter(ledger.ds.meta.mainCurrency),
      prefs,
      setPrefs,
      o,
      preset: view.preset,
      range,
      prevRange,
      setPreset: (preset) => saveView({ preset, custom: view.custom }),
      setCustomRange: (custom) => saveView({ preset: 'custom', custom }),
      allTxns,
      txns,
      prevTxns,
      oneOff,
      categorySlot: (id) => slots.get(id) ?? 0,
      close: onClose,
    }),
    [ledger, prefs, setPrefs, o, view, range, prevRange, saveView, allTxns, txns, prevTxns, oneOff, slots, onClose],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
