import { useCallback, useMemo, useState } from 'react';
import { allocationByGroup, balanceTimeline } from '../../core/analytics/balances';
import { daysBetween, listPeriods } from '../../core/analytics/periods';
import { axisTooltip, categoryAxis, Chart, grid, legend, lineSeries, valueAxis } from '../components/Chart';
import { Badge, Card, DataTable, Grid, Tile, Tiles } from '../components/ui';
import { useBalances, useNetWorth } from '../derived';
import { fmtDate } from '../format';
import { go } from '../router';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

export function Accounts() {
  const { ledger, fmt, prefs, o, range } = useApp();
  const { balances, liquid, liabilities, assets, netWorth } = useBalances();
  const [wholeHistory, setWholeHistory] = useState(false);
  const series = useNetWorth(wholeHistory ? ledger.first : undefined);
  const excluded = useMemo(() => new Set(prefs.excludedAccountIds), [prefs.excludedAccountIds]);
  const groups = useMemo(() => allocationByGroup(balances, prefs.excludedAccountIds).filter((g) => Math.abs(g.total) >= 1), [balances, prefs.excludedAccountIds]);
  const active = balances.filter((b) => b.txnCount > 0);
  const [selected, setSelected] = useState(() => active.slice().sort((a, b) => b.txnCount - a.txnCount)[0]?.account.id ?? '');

  const nwOption = useCallback(
    (t: ChartTheme) => {
      const area = (name: string, data: number[], color: string, stack: string) =>
        lineSeries(name, data, color, { stack, areaStyle: { color, opacity: 0.25 }, lineStyle: { width: 1, color } });
      return {
        legend: legend(t),
        grid: grid(),
        tooltip: axisTooltip(fmt.money),
        xAxis: categoryAxis(t, series.map((p) => p.period.label), { boundaryGap: false }),
        yAxis: valueAxis(t, fmt.compact),
        series: [
          area('Cash & bank', series.map((p) => p.liquid), t.series[0], 'assets'),
          area('Investments & deposits', series.map((p) => p.investments), t.series[2], 'assets'),
          area('Other assets', series.map((p) => p.otherAssets), t.series[6], 'assets'),
          area('Owed', series.map((p) => p.liabilities), t.series[1], 'debt'),
          lineSeries('Net worth', series.map((p) => p.netWorth), t.text, { lineStyle: { width: 2, color: t.text } }),
        ],
      };
    },
    [series, fmt],
  );

  const groupOption = useCallback(
    (t: ChartTheme) => {
      const sorted = [...groups].sort((a, b) => a.total - b.total);
      return {
        grid: grid({ top: 8 }),
        tooltip: { trigger: 'item', valueFormatter: (v: number) => fmt.money(v) },
        xAxis: valueAxis(t, fmt.compact),
        yAxis: categoryAxis(t, sorted.map((g) => g.name), { axisLabel: { color: t.textSecondary } }),
        series: [
          {
            type: 'bar',
            name: 'Balance',
            barMaxWidth: 16,
            data: sorted.map((g) => ({
              value: Math.round(g.total),
              itemStyle: { color: g.total < 0 ? t.series[1] : t.series[0], borderRadius: g.total < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] },
            })),
          },
        ],
      };
    },
    [groups, fmt],
  );

  const accountSeries = useMemo(() => {
    const from = wholeHistory ? ledger.first : range.from;
    const to = range.to < ledger.anchor ? range.to : ledger.anchor;
    const periods = listPeriods(from, to, 'month', o);
    return { periods, values: balanceTimeline(ledger.txns, periods).byAccount.get(selected) ?? periods.map(() => 0) };
  }, [ledger, selected, range, o, wholeHistory]);

  const accountOption = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 16 }),
      tooltip: axisTooltip(fmt.money),
      xAxis: categoryAxis(t, accountSeries.periods.map((p) => p.label), { boundaryGap: false }),
      yAxis: valueAxis(t, fmt.compact),
      series: [lineSeries('Balance at month end', accountSeries.values, t.series[0], { areaStyle: { color: t.series[0], opacity: 0.12 } })],
    }),
    [accountSeries, fmt],
  );

  return (
    <>
      <Tiles>
        <Tile label="Net worth" value={fmt.money(netWorth)} sub={`at ${fmtDate(ledger.anchor)}`} />
        <Tile label="Assets" value={fmt.money(assets)} />
        <Tile label="Owed" value={fmt.money(liabilities)} tone={liabilities < 0 ? 'bad' : undefined} sub="Cards, loans and negative balances" />
        <Tile label="Cash & bank" value={fmt.money(liquid)} />
      </Tiles>
      <Grid>
        <Card
          wide
          title="Net worth over time"
          subtitle="Balances at each month end, rebuilt from every transaction"
          actions={
            <label className="check">
              <input type="checkbox" checked={wholeHistory} onChange={(e) => setWholeHistory(e.target.checked)} /> Whole history
            </label>
          }
          table={
            <DataTable
              rows={series}
              rowKey={(r) => r.period.key}
              columns={[
                { key: 'p', label: 'Month', render: (r) => r.period.label },
                { key: 'l', label: 'Cash & bank', num: true, render: (r) => fmt.money(r.liquid) },
                { key: 'i', label: 'Investments', num: true, render: (r) => fmt.money(r.investments) },
                { key: 'o', label: 'Other assets', num: true, render: (r) => fmt.money(r.otherAssets) },
                { key: 'd', label: 'Owed', num: true, render: (r) => fmt.money(r.liabilities) },
                { key: 'n', label: 'Net worth', num: true, render: (r) => fmt.money(r.netWorth) },
              ]}
            />
          }
        >
          <Chart option={nwOption} label="Net worth over time" height={320} />
        </Card>

        <Card title="By account group" subtitle="Current balance of each group">
          <Chart option={groupOption} label="Balance by account group" height={Math.max(180, groups.length * 34)} />
        </Card>

        <Card
          title="Account history"
          actions={
            <select aria-label="Account" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {active.map((b) => (
                <option key={b.account.id} value={b.account.id}>
                  {b.account.name} ({b.groupName})
                </option>
              ))}
            </select>
          }
        >
          <Chart option={accountOption} label="Balance of the selected account at each month end" />
        </Card>

        <Card wide title="All accounts" subtitle="Click an account to see its transactions">
          <DataTable
            rows={balances}
            rowKey={(r) => r.account.id}
            onRowClick={(r) => go('transactions', { account: r.account.id })}
            columns={[
              { key: 'g', label: 'Group', render: (r) => r.groupName, sort: (r) => r.groupName },
              { key: 'a', label: 'Account', render: (r) => r.account.name, sort: (r) => r.account.name },
              {
                key: 'b',
                label: 'Balance',
                num: true,
                render: (r) => <span className={r.balance < 0 ? 'neg' : ''}>{fmt.exact(r.balance)}</span>,
                sort: (r) => r.balance,
              },
              { key: 't', label: 'Txns', num: true, render: (r) => r.txnCount, sort: (r) => r.txnCount },
              { key: 'l', label: 'Last activity', render: (r) => fmtDate(r.lastActivity), sort: (r) => r.lastActivity ?? '' },
              {
                key: 's',
                label: 'Status',
                render: (r) =>
                  excluded.has(r.account.id) ? (
                    <Badge kind="neutral">Excluded</Badge>
                  ) : r.lastActivity && Math.abs(r.balance) >= 1 && daysBetween(r.lastActivity, ledger.anchor) > 180 ? (
                    <Badge kind="warning">Dormant with balance</Badge>
                  ) : r.account.statusFlag ? (
                    <Badge kind="neutral">Hidden in app</Badge>
                  ) : null,
              },
            ]}
          />
        </Card>
      </Grid>
    </>
  );
}
