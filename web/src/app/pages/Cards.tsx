import { useCallback } from 'react';
import type { CardReport, CycleStatus } from '../../core/analytics/cards';
import { barSeries, categoryAxis, Chart, grid, legend, valueAxis, axisTooltip } from '../components/Chart';
import { Badge, Card, DataTable, Empty, Grid, Tile, Tiles, type StatusKind } from '../components/ui';
import { useCards } from '../derived';
import { fmtDate, pct } from '../format';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

const STATUS: Record<CycleStatus, { kind: StatusKind; label: string }> = {
  paid: { kind: 'good', label: 'Paid in full' },
  late: { kind: 'warning', label: 'Paid late' },
  partial: { kind: 'serious', label: 'Partly paid' },
  unpaid: { kind: 'critical', label: 'Not paid' },
  'nothing-due': { kind: 'neutral', label: 'Nothing due' },
  open: { kind: 'neutral', label: 'Open' },
};

export function Cards() {
  const cards = useCards();
  if (!cards.length) return <Empty>No credit cards with activity in this period.</Empty>;
  return (
    <>
      <p className="muted small intro">
        Statement cycles use each card's statement and payment days from the app's card settings. A statement counts as
        paid in full when transfers into the card between the statement date and the due date cover what was owed, and as
        paid late when they only cover it by the next statement. If most bills show as late, check the payment day set
        for the card in the app.
      </p>
      {cards.map((c) => (
        <CardSection key={c.account.id} report={c} />
      ))}
    </>
  );
}

function CardSection({ report }: { report: CardReport }) {
  const { fmt, txns } = useApp();
  const spend = txns.filter((t) => t.kind === 'expense' && t.accountId === report.account.id).reduce((a, t) => a + t.amountMain, 0);
  const cycles = report.cycles;
  const closed = cycles.filter((c) => c.status !== 'open');

  const option = useCallback(
    (t: ChartTheme) => ({
      legend: legend(t),
      grid: grid(),
      tooltip: axisTooltip(fmt.money),
      xAxis: categoryAxis(t, cycles.map((c) => fmtDate(c.statement))),
      yAxis: valueAxis(t, fmt.compact),
      series: [
        barSeries('Spent in cycle', cycles.map((c) => Math.round(c.spend)), t.series[0]),
        barSeries('Paid by due date', cycles.map((c) => Math.round(c.paidByDue)), t.series[2]),
      ],
    }),
    [cycles, fmt],
  );

  return (
    <section className="section">
      <h2 className="section-title">
        {report.account.name}
        <span className="muted small">
          {' '}
          · statement on day {report.account.card?.statementDay}, due on day {report.account.card?.paymentDay}
        </span>
      </h2>
      <Tiles>
        <Tile label="Owed now" value={fmt.money(report.outstanding)} />
        <Tile label="Spent in period" value={fmt.money(spend)} sub={closed.length ? `${fmt.money(spend / Math.max(1, cycles.length))} per cycle` : undefined} />
        <Tile
          label="Paid in full"
          value={pct(report.paidInFullRate)}
          tone={report.paidInFullRate !== null && report.paidInFullRate < 1 ? 'bad' : undefined}
          sub={`${closed.filter((c) => c.status === 'paid').length} on time, ${closed.filter((c) => c.status === 'late').length} late, of ${closed.filter((c) => c.status !== 'nothing-due').length} statements`}
        />
      </Tiles>
      <Grid>
        <Card title="Statement cycles">
          <Chart option={option} label={`Spending and payments per statement for ${report.account.name}`} />
        </Card>
        <Card title="Top categories on this card">
          {report.topCategories.length ? (
            <ul className="plain-list">
              {report.topCategories.map((c) => (
                <li key={c.name}>
                  <span>{c.name}</span>
                  <strong>{fmt.money(c.total)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No spending on this card in this period.</Empty>
          )}
        </Card>
        <Card wide title="Statements">
          <DataTable
            rows={[...cycles].reverse()}
            rowKey={(r) => r.statement}
            limit={12}
            columns={[
              { key: 'c', label: 'Cycle', render: (r) => `${fmtDate(r.start)} – ${fmtDate(r.statement)}` },
              { key: 's', label: 'Spent', num: true, render: (r) => fmt.money(r.spend) },
              { key: 'o', label: 'Owed at statement', num: true, render: (r) => fmt.money(r.owed) },
              { key: 'd', label: 'Due', render: (r) => fmtDate(r.due) },
              { key: 'p', label: 'Paid by due', num: true, render: (r) => fmt.money(r.paidByDue) },
              { key: 'st', label: 'Status', render: (r) => <Badge kind={STATUS[r.status].kind}>{STATUS[r.status].label}</Badge> },
            ]}
          />
        </Card>
      </Grid>
    </section>
  );
}
