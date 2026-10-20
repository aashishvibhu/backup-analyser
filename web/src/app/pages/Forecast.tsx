import { useCallback, useMemo } from 'react';
import { cashflow } from '../../core/analytics/cashflow';
import { categoryMatrix } from '../../core/analytics/categories';
import { categorySpikes, findAnomalies, forecast } from '../../core/analytics/forecast';
import { listPeriods, periodOf } from '../../core/analytics/periods';
import { axisTooltip, barSeries, categoryAxis, Chart, grid, legend, lineSeries, valueAxis } from '../components/Chart';
import { Card, DataTable, Empty, Grid, Tile, Tiles } from '../components/ui';
import { fmtDate, fmtRange } from '../format';
import { go } from '../router';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

export function Forecast() {
  const { ledger, allTxns, txns, o, oneOff, fmt } = useApp();
  const monthly = useMemo(() => cashflow(allTxns, 'month', o, ledger.first, ledger.anchor, oneOff), [allTxns, o, ledger, oneOff]);
  const fy = periodOf(ledger.anchor, 'fy', o);
  const f = useMemo(
    () => forecast(monthly, ledger.anchor, o, monthly.filter((r) => r.period.start >= fy.start), fy),
    [monthly, ledger.anchor, o, fy],
  );
  const anomalies = useMemo(() => findAnomalies(allTxns, txns), [allTxns, txns]);
  const spikes = useMemo(() => {
    const periods = listPeriods(ledger.first, ledger.anchor, 'month', o);
    return categorySpikes(categoryMatrix(allTxns, 'expense', periods, o, 100)).slice(0, 20);
  }, [allTxns, ledger, o]);

  const recent = monthly.slice(-12);
  const option = useCallback(
    (t: ChartTheme) => {
      const labels = [...recent.map((r) => r.period.label), 'Next month'];
      const band = (v: number) => [...recent.map(() => null), Math.round(v)];
      return {
        legend: legend(t),
        grid: grid(),
        tooltip: axisTooltip(fmt.money),
        xAxis: categoryAxis(t, labels),
        yAxis: valueAxis(t, fmt.compact),
        series: [
          barSeries('Core spending', [...recent.map((r) => Math.round(r.coreExpense)), null], t.series[1]),
          barSeries('Forecast spending', band(f.coreExpense.expected), t.series[1], { itemStyle: { color: t.series[1], opacity: 0.45, borderRadius: [4, 4, 0, 0] }, barGap: '-100%' }),
          lineSeries('Income', [...recent.map((r) => Math.round(r.income)), Math.round(f.income.expected)], t.series[0], { showSymbol: true }),
        ],
      };
    },
    [recent, f, fmt],
  );

  if (f.basis < 2) return <Empty>At least two complete months of data are needed for a forecast.</Empty>;

  return (
    <>
      <p className="muted small intro">
        Forecasts use the median of your last {f.basis} complete months and leave out categories you marked as one-off,
        so a single big purchase does not distort them. The range shown is the middle half of those months.
      </p>
      <Tiles>
        <Tile label="Next month: income" value={fmt.money(f.income.expected)} sub={`${fmt.money(f.income.low)} – ${fmt.money(f.income.high)}`} />
        <Tile label="Next month: core spending" value={fmt.money(f.coreExpense.expected)} sub={`${fmt.money(f.coreExpense.low)} – ${fmt.money(f.coreExpense.high)}`} />
        <Tile label="Next month: saved" value={fmt.money(f.net)} tone={f.net < 0 ? 'bad' : undefined} />
        {f.current && (
          <Tile
            label="This month, projected spending"
            value={fmt.money(f.current.projectedExpense)}
            sub={`${fmt.money(f.current.actualExpense)} so far, ${Math.round(f.current.elapsed * 100)}% through`}
          />
        )}
        {f.fy && (
          <Tile label={`${f.fy.period.label}: projected savings`} value={fmt.money(f.fy.projectedNet)} sub={`${fmt.money(f.fy.actualNet)} saved so far`} />
        )}
      </Tiles>
      <Grid>
        <Card wide title="Last 12 months and next month" subtitle="Lighter bar is the forecast">
          <Chart option={option} label="Monthly income and core spending with next month's forecast" />
        </Card>
        <Card wide title="Unusual expenses" subtitle="In the selected range: far above the usual amount for their category (at least 3× the typical amount)">
          {anomalies.length ? (
            <DataTable
              rows={anomalies}
              rowKey={(r) => r.txn.id}
              limit={10}
              onRowClick={(r) => go('transactions', { q: r.txn.memo || undefined, from: r.txn.date, to: r.txn.date })}
              columns={[
                { key: 'd', label: 'Date', render: (r) => fmtDate(r.txn.date) },
                { key: 'c', label: 'Category', render: (r) => r.txn.category?.name ?? '–' },
                { key: 'm', label: 'Note', render: (r) => r.txn.memo || '–' },
                { key: 'a', label: 'Amount', num: true, render: (r) => fmt.money(r.txn.amountMain) },
                { key: 'r', label: 'Why', render: (r) => r.reason },
              ]}
            />
          ) : (
            <Empty>Nothing unusual in this period.</Empty>
          )}
        </Card>
        <Card wide title="Category spikes" subtitle="Months where a category ran well above its own previous 12 months (all history)">
          {spikes.length ? (
            <DataTable
              rows={spikes}
              rowKey={(r) => `${r.id}-${r.period.key}`}
              limit={10}
              onRowClick={(r) => go('transactions', { category: r.id, from: r.period.start, to: r.period.end })}
              columns={[
                { key: 'p', label: 'Month', render: (r) => fmtRange(r.period.start, r.period.end) },
                { key: 'n', label: 'Category', render: (r) => r.name },
                { key: 'v', label: 'Spent', num: true, render: (r) => fmt.money(r.value) },
                { key: 't', label: 'Typical', num: true, render: (r) => fmt.money(r.typical) },
              ]}
            />
          ) : (
            <Empty>No spikes found.</Empty>
          )}
        </Card>
      </Grid>
    </>
  );
}
