import { useCallback, useMemo, useState } from 'react';
import { cumulative, rollingAverage, summarize } from '../../core/analytics/cashflow';
import type { Granularity } from '../../core/analytics/periods';
import { axisTooltip, barSeries, categoryAxis, Chart, grid, legend, lineSeries, valueAxis } from '../components/Chart';
import { Card, DataTable, downloadCsv, Grid, Tile, Tiles } from '../components/ui';
import { useRangeFlow } from '../derived';
import { pct } from '../format';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

const GRANULARITIES: { id: Granularity; label: string }[] = [
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'quarter', label: 'Quarterly' },
  { id: 'fy', label: 'Financial year' },
  { id: 'year', label: 'Calendar year' },
];

export function CashFlow() {
  const { fmt, txns, oneOff, o } = useApp();
  const [g, setG] = useState<Granularity>('month');
  const rows = useRangeFlow(g);
  const total = useMemo(() => summarize(txns, oneOff), [txns, oneOff]);
  const n = rows.length || 1;

  const flowOption = useCallback(
    (t: ChartTheme) => {
      const avg = rollingAverage(rows.map((r) => r.expense), 3);
      return {
        legend: legend(t),
        grid: grid(),
        tooltip: axisTooltip(fmt.money),
        xAxis: categoryAxis(t, rows.map((r) => r.period.label)),
        yAxis: valueAxis(t, fmt.compact),
        series: [
          barSeries('Income', rows.map((r) => r.income), t.series[0]),
          barSeries('Spending', rows.map((r) => r.expense), t.series[1]),
          ...(rows.length >= 4 ? [lineSeries('Spending, 3-period average', avg, t.series[3])] : []),
        ],
      };
    },
    [rows, fmt],
  );

  const savedOption = useCallback(
    (t: ChartTheme) => ({
      legend: legend(t),
      grid: grid(),
      tooltip: axisTooltip(fmt.money),
      xAxis: categoryAxis(t, rows.map((r) => r.period.label)),
      yAxis: valueAxis(t, fmt.compact),
      series: [
        barSeries('Saved in period', rows.map((r) => r.net), t.series[2], {
          itemStyle: { color: t.series[2], borderRadius: 4 },
        }),
        lineSeries('Cumulative saved', cumulative(rows.map((r) => r.net)), t.series[0], { showSymbol: rows.length < 20 }),
      ],
    }),
    [rows, fmt],
  );

  const rateOption = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 16 }),
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (v === null ? '–' : `${v}%`) },
      xAxis: categoryAxis(t, rows.map((r) => r.period.label)),
      yAxis: valueAxis(t, (v: number) => `${v}%`),
      series: [
        barSeries('Savings rate', rows.map((r) => (r.savingsRate === null ? null : Math.round(r.savingsRate * 100))), t.series[0], {
          itemStyle: { color: t.series[0], borderRadius: 4 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.axis, type: 'solid' }, label: { show: false }, data: [{ yAxis: 0 }] },
        }),
      ],
    }),
    [rows],
  );

  const exportCsv = () =>
    downloadCsv(
      `cash-flow-${g}.csv`,
      ['Period', 'From', 'To', 'Income', 'Spending', 'Core spending', 'One-off spending', 'Saved', 'Savings rate', 'Corrections in', 'Corrections out', 'Adjustments +', 'Adjustments −', 'Transfers', 'Transactions'],
      rows.map((r) => [
        r.period.label,
        r.period.start,
        r.period.end,
        r.income.toFixed(2),
        r.expense.toFixed(2),
        r.coreExpense.toFixed(2),
        r.oneOffExpense.toFixed(2),
        r.net.toFixed(2),
        r.savingsRate === null ? '' : (r.savingsRate * 100).toFixed(1),
        r.correctionIncome.toFixed(2),
        r.correctionExpense.toFixed(2),
        r.adjustIn.toFixed(2),
        r.adjustOut.toFixed(2),
        r.transferTotal.toFixed(2),
        r.txnCount,
      ]),
    );

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Group by">
          {GRANULARITIES.map((x) => (
            <button key={x.id} aria-pressed={g === x.id} onClick={() => setG(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <span className="muted small">
          Months start on day {o.monthStartDay}
          {o.monthStartDay !== 1 ? ' (from your app settings — change in Settings)' : ''}.
        </span>
      </div>
      <Tiles>
        <Tile label="Total income" value={fmt.money(total.income)} sub={`${fmt.money(total.income / n)} per ${g === 'fy' ? 'year' : g}`} />
        <Tile label="Total spending" value={fmt.money(total.expense)} sub={`${fmt.money(total.expense / n)} per ${g === 'fy' ? 'year' : g}`} />
        <Tile label="Core spending" value={fmt.money(total.coreExpense)} sub={total.oneOffExpense ? `${fmt.money(total.oneOffExpense)} in one-off categories` : 'Mark one-off categories in Settings'} />
        <Tile label="Saved" value={fmt.money(total.net)} tone={total.net < 0 ? 'bad' : undefined} sub={`${pct(total.savingsRate)} savings rate`} />
      </Tiles>
      <Grid>
        <Card wide title="Income and spending">
          <Chart option={flowOption} label="Income and spending per period" height={320} />
        </Card>
        <Card title="Savings" subtitle="Per period, and the running total across the range">
          <Chart option={savedOption} label="Savings per period and cumulative" />
        </Card>
        <Card title="Savings rate" subtitle="Share of income not spent">
          <Chart option={rateOption} label="Savings rate per period" />
        </Card>
        <Card
          wide
          title="Details"
          subtitle="Corrections are 'modify balance' entries recorded as income or spending. Adjustments are balance edits the app keeps out of totals."
          actions={
            <button className="btn" onClick={exportCsv}>
              Export CSV
            </button>
          }
        >
          <DataTable
            rows={[...rows].reverse()}
            rowKey={(r) => r.period.key}
            columns={[
              { key: 'p', label: 'Period', render: (r) => r.period.label },
              { key: 'i', label: 'Income', num: true, render: (r) => fmt.money(r.income) },
              { key: 'e', label: 'Spending', num: true, render: (r) => fmt.money(r.expense) },
              { key: 'c', label: 'Core', num: true, render: (r) => fmt.money(r.coreExpense) },
              { key: 'n', label: 'Saved', num: true, render: (r) => <span className={r.net < 0 ? 'neg' : ''}>{fmt.money(r.net)}</span> },
              { key: 's', label: 'Rate', num: true, render: (r) => pct(r.savingsRate) },
              { key: 'k', label: 'Corrections', num: true, render: (r) => (r.correctionIncome || r.correctionExpense ? `+${fmt.money(r.correctionIncome)} / −${fmt.money(r.correctionExpense)}` : '') },
              { key: 'a', label: 'Adjustments', num: true, render: (r) => (r.adjustIn || r.adjustOut ? `+${fmt.money(r.adjustIn)} / −${fmt.money(r.adjustOut)}` : '') },
              { key: 't', label: 'Txns', num: true, render: (r) => r.txnCount },
            ]}
          />
        </Card>
      </Grid>
    </>
  );
}
