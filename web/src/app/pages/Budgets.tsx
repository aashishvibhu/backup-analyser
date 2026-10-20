import { useCallback, useMemo } from 'react';
import { suggestBudgets, type BudgetReport } from '../../core/analytics/budgets';
import { categoryMatrix } from '../../core/analytics/categories';
import { listPeriods, periodOf, addDays } from '../../core/analytics/periods';
import { barSeries, categoryAxis, Chart, grid, valueAxis } from '../components/Chart';
import { Badge, Card, DataTable, Empty, Grid, Meter } from '../components/ui';
import { useBudgets } from '../derived';
import { fmtRange, pct } from '../format';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

const STATUS = {
  ok: { kind: 'good', label: 'On track' },
  'at-risk': { kind: 'warning', label: 'At risk' },
  over: { kind: 'critical', label: 'Over budget' },
} as const;

export function Budgets() {
  const { ledger, allTxns, o, fmt } = useApp();
  const budgets = useBudgets();

  const suggestions = useMemo(() => {
    const current = periodOf(ledger.anchor, 'month', o);
    const end = addDays(current.start, -1);
    const periods = listPeriods(ledger.first, end, 'month', o).slice(-6);
    if (!periods.length) return [];
    const m = categoryMatrix(allTxns, 'expense', periods, o, 100);
    return suggestBudgets(m.categories.map((c, i) => ({ ...c, values: m.values[i] }))).filter((s) => s.id !== '__correction__');
  }, [ledger, allTxns, o]);

  return (
    <>
      <p className="muted small intro">
        Budgets come from your Money Manager settings and are treated as monthly. This page always looks at the current
        month and the 12 before it.
      </p>
      {budgets.length ? (
        <Grid>
          {budgets.map((b) => (
            <BudgetCard key={b.id} b={b} />
          ))}
        </Grid>
      ) : (
        <Empty>No budgets are set in this backup. The suggestions below can help you pick some in the app.</Empty>
      )}
      <Grid>
        <Card wide title="Suggested monthly budgets" subtitle="The 75th percentile of the last 6 complete months, rounded up: enough for a normal month, tight enough to notice a bad one.">
          <DataTable
            rows={suggestions}
            rowKey={(r) => r.id}
            limit={12}
            columns={[
              { key: 'n', label: 'Category', render: (r) => r.name },
              { key: 'm', label: 'Typical month', num: true, render: (r) => fmt.money(r.median) },
              { key: 's', label: 'Suggested budget', num: true, render: (r) => fmt.money(r.suggested) },
            ]}
          />
        </Card>
      </Grid>
    </>
  );
}

function BudgetCard({ b }: { b: BudgetReport }) {
  const { fmt } = useApp();
  const st = STATUS[b.current.status];
  const option = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 16 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmt.money(v) },
      xAxis: categoryAxis(t, b.history.map((h) => h.period.label)),
      yAxis: valueAxis(t, fmt.compact),
      series: [
        barSeries('Spent', b.history.map((h) => Math.round(h.actual)), t.series[0], {
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: t.text, type: 'solid', width: 1 },
            label: { formatter: 'Budget', color: t.textSecondary, position: 'insideEndTop' },
            data: [{ yAxis: b.amount }],
          },
        }),
      ],
    }),
    [b, fmt],
  );
  return (
    <Card title={b.name} subtitle={`${fmt.money(b.amount)} a month · ${fmtRange(b.current.period.start, b.current.period.end)}`} actions={<Badge kind={st.kind}>{st.label}</Badge>}>
      <div className="budget-now">
        <div className="row-between">
          <strong>{fmt.money(b.current.actual)}</strong>
          <span className="muted small">
            {pct(b.current.ratio)} used · {pct(b.current.elapsed)} of the month gone
          </span>
        </div>
        <Meter value={b.current.actual} max={Math.max(b.amount, b.current.projected, b.current.actual)} marker={b.amount} kind={st.kind} />
        <p className="muted small">
          At this pace: {fmt.money(b.current.projected)} by month end.
          {b.adherence !== null && ` Stayed within budget in ${pct(b.adherence)} of past months.`}
        </p>
      </div>
      {b.history.length > 0 && <Chart option={option} label={`Monthly spending against the ${b.name} budget`} height={200} />}
    </Card>
  );
}
