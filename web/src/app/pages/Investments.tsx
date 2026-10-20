import { useCallback, useMemo } from 'react';
import { investmentReport, loanReports } from '../../core/analytics/flows';
import { listPeriods } from '../../core/analytics/periods';
import { axisTooltip, barSeries, categoryAxis, Chart, grid, legend, lineSeries, valueAxis } from '../components/Chart';
import { Badge, Card, DataTable, Empty, Grid, Tile, Tiles } from '../components/ui';
import { useBalances } from '../derived';
import { pct } from '../format';
import { go } from '../router';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

export function Investments() {
  const { ledger, txns, o, range, fmt, prefs } = useApp();
  const periods = useMemo(() => listPeriods(range.from, range.to < ledger.anchor ? range.to : ledger.anchor, 'month', o), [range, ledger, o]);
  const inv = useMemo(() => investmentReport(ledger, txns, periods, o), [ledger, txns, periods, o]);
  const loans = useMemo(() => loanReports(ledger, periods, periods.length), [ledger, periods]);
  const { balances } = useBalances();
  const excluded = new Set(prefs.excludedAccountIds);
  const shared = balances.filter(
    (b) => (b.account.kind === 'custom' || b.account.kind === 'other') && Math.abs(b.balance) >= 1 && !excluded.has(b.account.id),
  );

  const invOption = useCallback(
    (t: ChartTheme) => ({
      legend: legend(t),
      grid: grid(),
      tooltip: axisTooltip(fmt.money),
      xAxis: categoryAxis(t, periods.map((p) => p.label)),
      yAxis: valueAxis(t, fmt.compact),
      series: [
        barSeries('Put in', inv.rows.map((r) => r.inflow), t.series[2]),
        barSeries('Taken out', inv.rows.map((r) => -r.outflow), t.series[1], { itemStyle: { color: t.series[1], borderRadius: [0, 0, 4, 4] } }),
      ],
    }),
    [inv, periods, fmt],
  );

  const loanOption = useCallback(
    (t: ChartTheme) => ({
      legend: legend(t),
      grid: grid(),
      tooltip: axisTooltip(fmt.money),
      xAxis: categoryAxis(t, periods.map((p) => p.label), { boundaryGap: false }),
      yAxis: valueAxis(t, fmt.compact),
      series: loans.slice(0, 8).map((l, i) => lineSeries(l.account.name, l.series, t.series[i], { showSymbol: periods.length < 15 })),
    }),
    [loans, periods, fmt],
  );

  return (
    <>
      <Tiles>
        <Tile label="Invested (net)" value={fmt.money(inv.totalNet)} sub="Into investment, deposit and insurance accounts" />
        <Tile label="Months with a contribution" value={pct(inv.consistency)} sub={`${inv.rows.filter((r) => r.net > 0).length} of ${inv.rows.length}`} />
        <Tile label="Returns booked as income" value={fmt.money(inv.returnsIncome)} sub="Interest, dividends etc. recorded on these accounts" />
        <Tile label="Loans outstanding" value={fmt.money(loans.reduce((a, l) => a + l.outstanding, 0))} />
      </Tiles>
      <Grid>
        <Card wide title="Money put into investments" subtitle="Transfers into and out of investment, deposit and insurance accounts">
          <Chart option={invOption} label="Monthly investment contributions and withdrawals" />
        </Card>
        <Card wide title="Investment accounts" subtitle="Balance is what was put in plus anything recorded; market value is not in the backup">
          {inv.byAccount.length ? (
            <DataTable
              rows={inv.byAccount}
              rowKey={(r) => r.account.id}
              onRowClick={(r) => go('transactions', { account: r.account.id })}
              columns={[
                { key: 'a', label: 'Account', render: (r) => r.account.name },
                { key: 'c', label: 'Put in (period)', num: true, render: (r) => fmt.money(r.contributed) },
                { key: 'w', label: 'Taken out (period)', num: true, render: (r) => fmt.money(r.withdrawn) },
                { key: 'b', label: 'Balance now', num: true, render: (r) => fmt.money(r.balance) },
              ]}
            />
          ) : (
            <Empty>No investment or deposit accounts.</Empty>
          )}
        </Card>
        <Card title="Loans" subtitle="Amount still owed at each month end">
          {loans.length ? <Chart option={loanOption} label="Outstanding loan balances" /> : <Empty>No loan accounts with a balance.</Empty>}
        </Card>
        <Card title="Repayment pace">
          {loans.length ? (
            <DataTable
              rows={loans}
              rowKey={(r) => r.account.id}
              columns={[
                { key: 'a', label: 'Loan', render: (r) => r.account.name },
                { key: 'o', label: 'Owed', num: true, render: (r) => fmt.money(r.outstanding) },
                { key: 'm', label: 'Repaid / month', num: true, render: (r) => fmt.money(r.avgMonthlyRepayment) },
                {
                  key: 'p',
                  label: 'Paid off in',
                  num: true,
                  render: (r) =>
                    r.outstanding < 1 ? <Badge kind="good">Cleared</Badge> : r.monthsToPayoff ? `${r.monthsToPayoff} months` : '–',
                },
              ]}
            />
          ) : (
            <Empty>Nothing to show.</Empty>
          )}
        </Card>
        <Card
          wide
          title="Shared, virtual and other accounts"
          subtitle="Shared-expense groups, wallets and IOU-style accounts. A positive balance usually means money held or owed to you; negative means you owe."
        >
          {shared.length ? (
            <DataTable
              rows={shared}
              rowKey={(r) => r.account.id}
              initialSort={{ key: 'b', desc: true }}
              onRowClick={(r) => go('transactions', { account: r.account.id })}
              columns={[
                { key: 'g', label: 'Group', render: (r) => r.groupName, sort: (r) => r.groupName },
                { key: 'a', label: 'Account', render: (r) => r.account.name, sort: (r) => r.account.name },
                { key: 'b', label: 'Balance', num: true, render: (r) => <span className={r.balance < 0 ? 'neg' : ''}>{fmt.exact(r.balance)}</span>, sort: (r) => r.balance },
                {
                  key: 's',
                  label: '',
                  render: (r) => <Badge kind="neutral">{r.balance > 0 ? 'Held / owed to you' : 'You owe'}</Badge>,
                },
              ]}
            />
          ) : (
            <Empty>No open balances in shared or other accounts.</Empty>
          )}
        </Card>
      </Grid>
    </>
  );
}
