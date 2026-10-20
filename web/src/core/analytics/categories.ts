import { CORRECTION_CATEGORY_ID, topCategoryKey, topCategoryName, type LedgerTxn } from '../ledger';
import { mean, stdDev } from './cashflow';
import { periodOf, type Period, type PeriodOptions } from './periods';

export type FlowType = 'income' | 'expense';

export interface CategoryNode {
  id: string;
  name: string;
  total: number;
  count: number;
  share: number;
  children: CategoryNode[];
}

/** Two-level category tree (top → sub) with totals and shares, largest first. */
export function categoryTree(txns: LedgerTxn[], type: FlowType): CategoryNode[] {
  const tops = new Map<string, CategoryNode & { childMap: Map<string, CategoryNode> }>();
  let grand = 0;
  for (const t of txns) {
    if (t.kind !== type) continue;
    grand += t.amountMain;
    const key = topCategoryKey(t);
    let top = tops.get(key);
    if (!top) {
      top = { id: key, name: topCategoryName(t), total: 0, count: 0, share: 0, children: [], childMap: new Map() };
      tops.set(key, top);
    }
    top.total += t.amountMain;
    top.count++;
    // Spend booked directly on the parent shows as a "(direct)" child so children sum to the parent.
    const isSub = !!t.category && t.category.id !== t.topCategory?.id;
    const subKey = isSub ? t.category!.id : `${key}:direct`;
    let sub = top.childMap.get(subKey);
    if (!sub) {
      sub = { id: subKey, name: isSub ? t.category!.name : `${top.name} (direct)`, total: 0, count: 0, share: 0, children: [] };
      top.childMap.set(subKey, sub);
    }
    sub.total += t.amountMain;
    sub.count++;
  }
  return [...tops.values()]
    .map(({ childMap, ...top }) => {
      const children = [...childMap.values()]
        .map((c) => ({ ...c, share: top.total ? c.total / top.total : 0 }))
        .sort((a, b) => b.total - a.total);
      // A parent with only direct spend has no meaningful breakdown.
      return { ...top, share: grand ? top.total / grand : 0, children: children.length === 1 && children[0].id.endsWith(':direct') ? [] : children };
    })
    .sort((a, b) => b.total - a.total);
}

export interface CategoryMatrix {
  categories: { id: string; name: string; total: number }[];
  periods: Period[];
  /** values[categoryIndex][periodIndex] */
  values: number[][];
}

/** Top-level category × month totals. The tail beyond `limit` folds into "Other". */
export function categoryMatrix(
  txns: LedgerTxn[],
  type: FlowType,
  periods: Period[],
  o: PeriodOptions,
  limit = 12,
): CategoryMatrix {
  const pIndex = new Map(periods.map((p, i) => [p.key, i]));
  const rows = new Map<string, { id: string; name: string; total: number; values: number[] }>();
  for (const t of txns) {
    if (t.kind !== type) continue;
    const pi = pIndex.get(periodOf(t.date, 'month', o).key);
    if (pi === undefined) continue;
    const key = topCategoryKey(t);
    let row = rows.get(key);
    if (!row) {
      row = { id: key, name: topCategoryName(t), total: 0, values: periods.map(() => 0) };
      rows.set(key, row);
    }
    row.values[pi] += t.amountMain;
    row.total += t.amountMain;
  }
  const sorted = [...rows.values()].sort((a, b) => b.total - a.total);
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  if (tail.length) {
    head.push({
      id: '__other__',
      name: `Other (${tail.length})`,
      total: tail.reduce((a, r) => a + r.total, 0),
      values: periods.map((_, i) => tail.reduce((a, r) => a + r.values[i], 0)),
    });
  }
  return {
    categories: head.map(({ id, name, total }) => ({ id, name, total })),
    periods,
    values: head.map((r) => r.values),
  };
}

export type SpendNature = 'fixed' | 'regular' | 'occasional' | 'one-off';

export interface CategoryStat {
  id: string;
  name: string;
  total: number;
  share: number;
  avgPerPeriod: number;
  /** Share of periods with any spend. */
  activeShare: number;
  /** Coefficient of variation across periods (std-dev / mean). */
  volatility: number;
  nature: SpendNature;
  /** Latest full period vs average of the earlier ones (null when not enough history). */
  latest: number;
  changeVsAvg: number | null;
}

/** Per-category regularity and volatility, from a category matrix built on monthly periods. */
export function categoryStats(m: CategoryMatrix): CategoryStat[] {
  const grand = m.categories.reduce((a, c) => a + c.total, 0);
  return m.categories
    .filter((c) => c.id !== '__other__')
    .map((c, i) => {
      const values = m.values[i];
      const avg = mean(values);
      const active = values.filter((v) => v > 0).length;
      const activeShare = values.length ? active / values.length : 0;
      const volatility = avg ? stdDev(values) / avg : 0;
      const maxShare = c.total ? Math.max(...values) / c.total : 0;
      const nature: SpendNature =
        activeShare >= 0.8 && volatility < 0.35
          ? 'fixed'
          : activeShare >= 0.5
            ? 'regular'
            : maxShare >= 0.6 && values.length >= 3
              ? 'one-off'
              : 'occasional';
      const latest = values.at(-1) ?? 0;
      const prior = values.slice(0, -1);
      const priorAvg = mean(prior);
      return {
        id: c.id,
        name: c.name,
        total: c.total,
        share: grand ? c.total / grand : 0,
        avgPerPeriod: avg,
        activeShare,
        volatility,
        nature,
        latest,
        changeVsAvg: prior.length >= 2 && priorAvg > 0 ? (latest - priorAvg) / priorAvg : null,
      };
    });
}

export interface CategoryChange {
  id: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
  /** null when previous is 0. */
  pct: number | null;
}

/** Category totals in two ranges, sorted by absolute change. */
export function compareCategories(current: LedgerTxn[], previous: LedgerTxn[], type: FlowType): CategoryChange[] {
  const totals = (txns: LedgerTxn[]) => {
    const m = new Map<string, { name: string; total: number }>();
    for (const t of txns) {
      if (t.kind !== type) continue;
      const key = topCategoryKey(t);
      const e = m.get(key) ?? { name: topCategoryName(t), total: 0 };
      e.total += t.amountMain;
      m.set(key, e);
    }
    return m;
  };
  const a = totals(current);
  const b = totals(previous);
  const ids = new Set([...a.keys(), ...b.keys()]);
  ids.delete(CORRECTION_CATEGORY_ID);
  return [...ids]
    .map((id) => {
      const cur = a.get(id)?.total ?? 0;
      const prev = b.get(id)?.total ?? 0;
      return {
        id,
        name: a.get(id)?.name ?? b.get(id)!.name,
        current: cur,
        previous: prev,
        delta: cur - prev,
        pct: prev ? (cur - prev) / prev : null,
      };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

/** Suggests one-off categories: big totals concentrated in very few months. */
export function suggestOneOffCategories(m: CategoryMatrix): string[] {
  const grand = m.categories.reduce((a, c) => a + c.total, 0);
  return categoryStats(m)
    .filter((s) => s.nature === 'one-off' && s.total >= grand * 0.03)
    .map((s) => s.id);
}
