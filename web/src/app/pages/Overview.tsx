import { useCallback, useMemo } from 'react';
import { summarize } from '../../core/analytics/cashflow';
import { categoryTree, compareCategories } from '../../core/analytics/categories';
import { findAnomalies } from '../../core/analytics/forecast';
import { buildInsights, healthScore } from '../../core/analytics/insights';
import { spendDays } from '../../core/analytics/behaviour';
import { addDays } from '../../core/analytics/periods';
import { axisTooltip, barSeries, categoryAxis, Chart, grid, legend, lineSeries, valueAxis } from '../components/Chart';
import { Card, DataTable, Empty, Grid, Tile, Tiles } from '../components/ui';
import { useAutoGranularity, useBalances, useBudgets, useCards, useLastYear, useNetWorth, useRangeFlow, useRecurring } from '../derived';
import { fmtDate, pct, signedPct } from '../format';
import { go, href } from '../router';
import { useApp } from '../store';
import { slotColor, type ChartTheme } from '../theme';
import { InsightList } from './Health';

export function Overview() {
  const { txns, prevTxns, fmt, oneOff, range, ledger, allTxns, categorySlot } = useApp();
  const g = useAutoGranularity();
  const rows = useRangeFlow(g);
  const cur = useMemo(() => summarize(txns, oneOff), [txns, oneOff]);
  const prev = useMemo(() => summarize(prevTxns, oneOff), [prevTxns, oneOff]);
  const lastYear = useLastYear();
  const { liquid, liabilities } = useBalances();
  const netWorth = useNetWorth();
  const recurring = useRecurring();
  const budgets = useBudgets();
  const cards = useCards();
  const tree = useMemo(() => categoryTree(txns, 'expense'), [txns]);

  const insights = useMemo(() => {
    const days = spendDays(txns, range.from, range.to < ledger.anchor ? range.to : ledger.anchor);
    return buildInsights({
      rangeLabel: 'in this period',
      current: cur,
      previous: prev,
      lastYear,
      categoryChanges: compareCategories(txns, prevTxns, 'expense'),
      recurring,
      budgets,
      cards,
      anomalies: findAnomalies(allTxns, txns),
      noSpendDays: days.noSpendDays,
      days: days.days,
      liquid,
      fmt: fmt.money,
    });
  }, [txns, prevTxns, cur, prev, lastYear, recurring, budgets, cards, allTxns, liquid, fmt, range, ledger]);

  const health = useMemo(() => healthScore({ lastYear, liquid, liabilities, budgets, cards }), [lastYear, liquid, liabilities, budgets, cards]);

  const delta = (now: number, before: number, higherIsGood: boolean) => {
    if (!before) return undefined;
    const ch = (now - before) / Math.abs(before);
    return { text: `${signedPct(ch)} vs previous`, good: ch === 0 ? null : ch > 0 === higherIsGood };
  };

  const flowOption = useCallback(
    (t: ChartTheme) => ({
      legend: legend(t),
      grid: grid(),
      tooltip: axisTooltip(fmt.money),
      xAxis: categoryAxis(t, rows.map((r) => r.period.label)),
      yAxis: valueAxis(t, fmt.compact),
      series: [
        barSeries('Income', rows.map((r) => r.income), t.series[0]),
        barSeries('Spending', rows.map((r) => r.expense), t.series[1]),
        lineSeries('Saved', rows.map((r) => r.net), t.series[2], { showSymbol: rows.length < 20 }),
      ],
    }),
    [rows, fmt],
  );

  const top = tree.slice(0, 8);
  const catOption = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 8 }),
      tooltip: { trigger: 'item', valueFormatter: (v: number) => fmt.money(v) },
      xAxis: valueAxis(t, fmt.compact),
      yAxis: categoryAxis(t, top.map((c) => c.name).reverse(), { axisLabel: { color: t.textSecondary } }),
      series: [
        {
          type: 'bar',
          name: 'Spending',
          barMaxWidth: 16,
          data: [...top].reverse().map((c) => ({ value: c.total, itemStyle: { color: slotColor(t, categorySlot(c.id)), borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', color: t.textSecondary, formatter: (p: { dataIndex: number }) => pct([...top].reverse()[p.dataIndex].share) },
        },
      ],
    }),
    [top, fmt, categorySlot],
  );

  const upcoming = recurring
    .filter((r) => r.active && r.nextExpected <= addDays(ledger.anchor, 31))
    .sort((a, b) => a.nextExpected.localeCompare(b.nextExpected))
    .slice(0, 6);
  const nw = netWorth.at(-1);

  if (!txns.length) return <Empty>No transactions in this period. Pick a different date range above.</Empty>;

  return (
    <>
      <Tiles>
        <Tile label="Income" value={fmt.money(cur.income)} delta={delta(cur.income, prev.income, true)} />
        <Tile label="Spending" value={fmt.money(cur.expense)} delta={delta(cur.expense, prev.expense, false)} sub={cur.oneOffExpense ? `${fmt.money(cur.oneOffExpense)} one-off` : undefined} />
        <Tile
          label="Saved"
          value={fmt.money(cur.net)}
          tone={cur.net < 0 ? 'bad' : undefined}
          sub={cur.savingsRate === null ? 'No income in this period' : `${pct(cur.savingsRate)} of income`}
        />
        <Tile label="Net worth" value={nw ? fmt.money(nw.netWorth) : '–'} sub={nw ? `at ${fmtDate(nw.period.end < ledger.anchor ? nw.period.end : ledger.anchor)}` : undefined} />
        <Tile label="Health score" value={<a href={href('health')}>{health.score}/100</a>} sub="Last 12 months" />
      </Tiles>

      <Grid>
        <Card
          wide
          title="Income and spending"
          subtitle={`Per ${g}. "Saved" is income minus spending.`}
          table={
            <DataTable
              rows={rows}
              rowKey={(r) => r.period.key}
              columns={[
                { key: 'p', label: 'Period', render: (r) => r.period.label },
                { key: 'i', label: 'Income', num: true, render: (r) => fmt.money(r.income) },
                { key: 'e', label: 'Spending', num: true, render: (r) => fmt.money(r.expense) },
                { key: 'n', label: 'Saved', num: true, render: (r) => fmt.money(r.net) },
                { key: 's', label: 'Savings rate', num: true, render: (r) => pct(r.savingsRate) },
              ]}
            />
          }
        >
          <Chart option={flowOption} label="Income and spending per period" height={300} />
        </Card>

        <Card title="Where the money went" subtitle="Top spending categories" actions={<a href={href('categories')}>All categories</a>}>
          {top.length ? (
            <Chart option={catOption} label="Top spending categories" height={Math.max(160, top.length * 34)} onClick={(p) => {
              const c = [...top].reverse()[p.dataIndex];
              if (c) go('transactions', { category: c.id, kind: 'expense' });
            }} />
          ) : (
            <Empty>No spending in this period.</Empty>
          )}
        </Card>

        <Card title="What stands out" subtitle="Generated from your data" actions={<a href={href('health')}>More</a>}>
          <InsightList insights={insights.slice(0, 6)} />
        </Card>

        <Card title="Coming up" subtitle="Recurring payments expected in the next month" actions={<a href={href('recurring')}>All</a>}>
          {upcoming.length ? (
            <ul className="plain-list">
              {upcoming.map((r) => (
                <li key={r.key}>
                  <span>
                    {r.name} <span className="muted small">· {fmtDate(r.nextExpected)}</span>
                  </span>
                  <strong>{fmt.money(r.lastAmount)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No recurring payments detected for the coming month.</Empty>
          )}
        </Card>
      </Grid>
    </>
  );
}
