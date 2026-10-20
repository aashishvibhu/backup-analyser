import { useCallback, useMemo, useState } from 'react';
import { categoryMatrix, categoryStats, categoryTree, compareCategories, type FlowType } from '../../core/analytics/categories';
import { listPeriods } from '../../core/analytics/periods';
import { categoryAxis, Chart, grid, legend, valueAxis } from '../components/Chart';
import { Badge, Card, DataTable, Empty, Grid, Meter } from '../components/ui';
import { pct, signedPct } from '../format';
import { go } from '../router';
import { useApp } from '../store';
import { slotColor, type ChartTheme } from '../theme';

const NATURE_LABEL = { fixed: 'Fixed', regular: 'Regular', occasional: 'Occasional', 'one-off': 'One-off' } as const;

export function Categories() {
  const { txns, prevTxns, fmt, range, o, categorySlot } = useApp();
  const [type, setType] = useState<FlowType>('expense');
  const tree = useMemo(() => categoryTree(txns, type), [txns, type]);
  const periods = useMemo(() => listPeriods(range.from, range.to, 'month', o), [range, o]);
  const fullMatrix = useMemo(() => categoryMatrix(txns, type, periods, o, 100), [txns, type, periods, o]);
  const stats = useMemo(() => categoryStats(fullMatrix), [fullMatrix]);
  const changes = useMemo(() => compareCategories(txns, prevTxns, type), [txns, prevTxns, type]);
  const total = tree.reduce((a, c) => a + c.total, 0);

  // Stacked chart: categories with a colour slot keep it; everything else folds into one grey "Other".
  const stacked = useMemo(() => {
    const keep: { id: string; name: string; values: number[] }[] = [];
    const other = periods.map(() => 0);
    fullMatrix.categories.forEach((c, i) => {
      if (categorySlot(c.id) > 0) keep.push({ id: c.id, name: c.name, values: fullMatrix.values[i] });
      else fullMatrix.values[i].forEach((v, pi) => (other[pi] += v));
    });
    keep.sort((a, b) => categorySlot(a.id) - categorySlot(b.id));
    return { keep, other };
  }, [fullMatrix, periods, categorySlot]);

  const stackOption = useCallback(
    (t: ChartTheme) => {
      const series = stacked.keep.map((c) => ({
        type: 'bar',
        name: c.name,
        stack: 'all',
        barMaxWidth: 22,
        data: c.values,
        itemStyle: { color: slotColor(t, categorySlot(c.id)), borderColor: t.surface, borderWidth: 1 },
        emphasis: { focus: 'series' },
      }));
      if (stacked.other.some((v) => v > 0)) {
        series.push({
          type: 'bar',
          name: 'Other',
          stack: 'all',
          barMaxWidth: 22,
          data: stacked.other,
          itemStyle: { color: t.other, borderColor: t.surface, borderWidth: 1 },
          emphasis: { focus: 'series' },
        });
      }
      return {
        legend: legend(t, { type: 'scroll' }),
        grid: grid({ top: 40 }),
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmt.money(v) },
        xAxis: categoryAxis(t, periods.map((p) => p.label)),
        yAxis: valueAxis(t, fmt.compact),
        series,
      };
    },
    [stacked, periods, fmt, categorySlot],
  );

  const treemapOption = useCallback(
    (t: ChartTheme) => ({
      tooltip: {
        formatter: (p: { name: string; value: number; treePathInfo: { name: string }[] }) => {
          const path = p.treePathInfo.map((x) => x.name).filter(Boolean).join(' › ');
          return `${path}<br/><b>${fmt.money(p.value)}</b> · ${pct(total ? p.value / total : 0, 1)}`;
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: 'zoomToNode',
          breadcrumb: { show: true, bottom: 0, itemStyle: { color: t.surface, borderColor: t.grid, textStyle: { color: t.textSecondary } } },
          top: 0,
          left: 0,
          right: 0,
          bottom: 28,
          label: { color: '#fff', fontSize: 12, overflow: 'truncate' },
          upperLabel: { show: true, height: 22, color: '#fff' },
          itemStyle: { borderColor: t.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
          levels: [{ itemStyle: { borderWidth: 0, gapWidth: 2 } }, { itemStyle: { gapWidth: 2, borderColor: t.surface, borderWidth: 2 } }],
          data: tree.map((c) => ({
            name: c.name,
            id: c.id,
            value: c.total,
            itemStyle: { color: slotColor(t, categorySlot(c.id)) },
            children: c.children.map((s) => ({ name: s.name, id: s.id, value: s.total })),
          })),
        },
      ],
    }),
    [tree, fmt, total, categorySlot],
  );

  const heatOption = useCallback(
    (t: ChartTheme) => {
      const cats = fullMatrix.categories.slice(0, 15);
      const data: [number, number, number][] = [];
      cats.forEach((_, ci) => fullMatrix.values[ci].forEach((v, pi) => data.push([pi, ci, Math.round(v)])));
      const max = Math.max(1, ...data.map((d) => d[2]));
      return {
        grid: grid({ top: 8, bottom: 40 }),
        tooltip: {
          formatter: (p: { value: [number, number, number] }) =>
            `${cats[p.value[1]].name} · ${periods[p.value[0]].label}<br/><b>${fmt.money(p.value[2])}</b>`,
        },
        xAxis: categoryAxis(t, periods.map((p) => p.label), { splitArea: { show: false } }),
        yAxis: categoryAxis(t, cats.map((c) => c.name), { axisLabel: { color: t.textSecondary }, inverse: true }),
        visualMap: {
          min: 0,
          max,
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          itemHeight: 160,
          itemWidth: 10,
          text: [fmt.compact(max), fmt.compact(0)],
          textStyle: { color: t.muted },
          inRange: { color: [t.surface, ...t.seq] },
        },
        series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.text, borderWidth: 1 } } }],
      };
    },
    [fullMatrix, periods, fmt],
  );

  const openCategory = (id: string) => go('transactions', { category: id, kind: type });

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Type">
          <button aria-pressed={type === 'expense'} onClick={() => setType('expense')}>
            Spending
          </button>
          <button aria-pressed={type === 'income'} onClick={() => setType('income')}>
            Income
          </button>
        </div>
        <span className="muted small">Total {fmt.money(total)} across {tree.length} categories. Click a category to see its transactions.</span>
      </div>
      {!tree.length ? (
        <Empty>No {type === 'expense' ? 'spending' : 'income'} in this period.</Empty>
      ) : (
        <Grid>
          <Card title="Breakdown" subtitle="Share of the total; open a row for subcategories">
            <ul className="cat-list">
              {tree.map((c) => (
                <li key={c.id}>
                  <details>
                    <summary>
                      <span className="swatch" style={{ background: `var(--series-${categorySlot(c.id) || 'other'})` }} />
                      <span className="cat-name">{c.name}</span>
                      <span className="num">{fmt.money(c.total)}</span>
                      <span className="num muted small">{pct(c.share, 1)}</span>
                    </summary>
                    <Meter value={c.share} max={1} />
                    <ul>
                      {(c.children.length ? c.children : [c]).map((s) => (
                        <li key={s.id}>
                          <button className="link-btn" onClick={() => openCategory(s.id.endsWith(':direct') ? c.id : s.id)}>
                            {s.name}
                          </button>
                          <span className="num">{fmt.money(s.total)}</span>
                          <span className="num muted small">
                            {s.count} txns · {pct(c.children.length ? s.share : 1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Category map" subtitle="Area is proportional to the amount. Click to zoom into subcategories.">
            <Chart option={treemapOption} label="Treemap of categories and subcategories" height={380} />
          </Card>

          <Card
            wide
            title="By month"
            subtitle="Your largest categories keep their colour on every page; the rest are grouped as Other"
            table={
              <DataTable
                rows={fullMatrix.categories.map((c, i) => ({ c, values: fullMatrix.values[i] }))}
                rowKey={(r) => r.c.id}
                columns={[
                  { key: 'n', label: 'Category', render: (r) => r.c.name },
                  ...periods.map((p, pi) => ({ key: p.key, label: p.label, num: true, render: (r: { values: number[] }) => fmt.money(r.values[pi]) })),
                  { key: 't', label: 'Total', num: true, render: (r) => fmt.money(r.c.total) },
                ]}
              />
            }
          >
            <Chart option={stackOption} label="Monthly totals stacked by category" height={340} />
          </Card>

          {periods.length > 1 && (
            <Card wide title="Heat map" subtitle="Top 15 categories by month; stronger colour means more spent">
              <Chart option={heatOption} label="Category by month heat map" height={Math.max(220, Math.min(15, fullMatrix.categories.length) * 26 + 70)} />
            </Card>
          )}

          <Card
            wide
            title="Patterns"
            subtitle="Fixed: nearly every month at a steady amount. Regular: most months. Occasional: now and then. One-off: concentrated in a single month."
          >
            <DataTable
              rows={stats}
              rowKey={(r) => r.id}
              initialSort={{ key: 'total', desc: true }}
              onRowClick={(r) => openCategory(r.id)}
              columns={[
                { key: 'name', label: 'Category', render: (r) => r.name, sort: (r) => r.name },
                { key: 'total', label: 'Total', num: true, render: (r) => fmt.money(r.total), sort: (r) => r.total },
                { key: 'avg', label: 'Per month', num: true, render: (r) => fmt.money(r.avgPerPeriod), sort: (r) => r.avgPerPeriod },
                { key: 'nature', label: 'Pattern', render: (r) => NATURE_LABEL[r.nature], sort: (r) => r.nature },
                { key: 'active', label: 'Months active', num: true, render: (r) => pct(r.activeShare), sort: (r) => r.activeShare },
                { key: 'vol', label: 'Swing', num: true, render: (r) => `±${pct(r.volatility)}`, sort: (r) => r.volatility },
                {
                  key: 'chg',
                  label: 'Last month vs avg',
                  num: true,
                  render: (r) => (r.changeVsAvg === null ? '–' : signedPct(r.changeVsAvg)),
                  sort: (r) => r.changeVsAvg ?? 0,
                },
              ]}
            />
          </Card>

          <Card wide title="Compared with the previous period" subtitle="Same length, immediately before the selected range">
            <DataTable
              rows={changes.filter((c) => c.current || c.previous)}
              rowKey={(r) => r.id}
              limit={12}
              onRowClick={(r) => openCategory(r.id)}
              columns={[
                { key: 'n', label: 'Category', render: (r) => r.name },
                { key: 'c', label: 'This period', num: true, render: (r) => fmt.money(r.current) },
                { key: 'p', label: 'Previous', num: true, render: (r) => fmt.money(r.previous) },
                {
                  key: 'd',
                  label: 'Change',
                  num: true,
                  render: (r) => (
                    <Badge kind={r.delta === 0 ? 'neutral' : (r.delta > 0) === (type === 'expense') ? 'warning' : 'good'}>
                      {r.delta > 0 ? '+' : '−'}
                      {fmt.money(Math.abs(r.delta))} {r.pct === null ? '(new)' : `(${signedPct(r.pct)})`}
                    </Badge>
                  ),
                },
              ]}
            />
          </Card>
        </Grid>
      )}
    </>
  );
}
