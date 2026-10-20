import { useCallback, useMemo, useState } from 'react';
import { dayOfMonthTotals, merchants, sizeHistogram, spendDays, weekdayHourMatrix, weekdayStats } from '../../core/analytics/behaviour';
import { barSeries, categoryAxis, Chart, grid, valueAxis } from '../components/Chart';
import { Card, DataTable, Grid, Tile, Tiles } from '../components/ui';
import { fmtDate, WEEKDAYS } from '../format';
import { go } from '../router';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

export function Habits() {
  const { txns, range, ledger, fmt, o } = useApp();
  const to = range.to < ledger.anchor ? range.to : ledger.anchor;
  const weekdays = useMemo(() => weekdayStats(txns, range.from, to), [txns, range.from, to]);
  const dom = useMemo(() => dayOfMonthTotals(txns), [txns]);
  const heat = useMemo(() => weekdayHourMatrix(txns), [txns]);
  const sizes = useMemo(() => sizeHistogram(txns), [txns]);
  const days = useMemo(() => spendDays(txns, range.from, to), [txns, range.from, to]);
  const shops = useMemo(() => merchants(txns), [txns]);
  const [q, setQ] = useState('');
  const shown = q ? shops.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())) : shops;

  // Weekdays in the order the user's week starts.
  const order = useMemo(() => Array.from({ length: 7 }, (_, i) => (o.weekStartsOn + i) % 7), [o.weekStartsOn]);

  const weekdayOption = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 16 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmt.money(v) },
      xAxis: categoryAxis(t, order.map((d) => WEEKDAYS[d])),
      yAxis: valueAxis(t, fmt.compact),
      series: [barSeries('Average spend per day', order.map((d) => Math.round(weekdays[d].avgPerDay)), t.series[0])],
    }),
    [weekdays, fmt, order],
  );

  const domOption = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 16 }),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmt.money(v) },
      xAxis: categoryAxis(t, dom.map((_, i) => String(i + 1))),
      yAxis: valueAxis(t, fmt.compact),
      series: [barSeries('Spent on this day of the month', dom.map(Math.round), t.series[0], { barMaxWidth: 10 })],
    }),
    [dom, fmt],
  );

  const heatOption = useCallback(
    (t: ChartTheme) => {
      const data: [number, number, number][] = [];
      order.forEach((d, yi) => heat.count[d].forEach((c, h) => data.push([h, yi, c])));
      const max = Math.max(1, ...data.map((x) => x[2]));
      return {
        grid: grid({ top: 8, bottom: 40 }),
        tooltip: {
          formatter: (p: { value: [number, number, number] }) => {
            const d = order[p.value[1]];
            return `${WEEKDAYS[d]} ${String(p.value[0]).padStart(2, '0')}:00–${String(p.value[0] + 1).padStart(2, '0')}:00<br/><b>${p.value[2]} entries</b> · ${fmt.money(heat.amount[d][p.value[0]])}`;
          },
        },
        xAxis: categoryAxis(t, Array.from({ length: 24 }, (_, h) => `${h}`), { name: 'Hour', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: t.muted } }),
        yAxis: categoryAxis(t, order.map((d) => WEEKDAYS[d]), { inverse: true, axisLabel: { color: t.textSecondary } }),
        visualMap: {
          min: 0,
          max,
          orient: 'horizontal',
          left: 'center',
          bottom: 0,
          itemHeight: 160,
          itemWidth: 10,
          text: [`${max}`, '0'],
          textStyle: { color: t.muted },
          inRange: { color: [t.surface, ...t.seq] },
        },
        series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 } }],
      };
    },
    [heat, fmt, order],
  );

  const sizeOption = useCallback(
    (t: ChartTheme) => ({
      grid: grid({ top: 16 }),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const s = sizes[p[0].dataIndex];
          return `${s.label}<br/><b>${s.count} expenses</b> · ${fmt.money(s.total)}`;
        },
      },
      xAxis: categoryAxis(t, sizes.map((s) => s.label)),
      yAxis: valueAxis(t, (v: number) => String(v)),
      series: [barSeries('Number of expenses', sizes.map((s) => s.count), t.series[0])],
    }),
    [sizes, fmt],
  );

  const small = sizes.slice(0, 2);
  const smallCount = small.reduce((a, s) => a + s.count, 0);
  const smallTotal = small.reduce((a, s) => a + s.total, 0);

  return (
    <>
      <Tiles>
        <Tile label="Average per day" value={fmt.money(days.avgPerDay)} sub={`${fmt.money(days.avgPerSpendDay)} on days you spend`} />
        <Tile label="No-spend days" value={`${days.noSpendDays} of ${days.days}`} sub={`Longest run: ${days.longestNoSpendStreak} days`} />
        <Tile label="Small purchases (< 500)" value={`${smallCount}`} sub={`${fmt.money(smallTotal)} in total`} />
        <Tile label="Places / payees" value={shops.length} sub="From the notes on your expenses" />
      </Tiles>
      <Grid>
        <Card title="Day of the week" subtitle="Average spending on each weekday">
          <Chart option={weekdayOption} label="Average spending by weekday" />
        </Card>
        <Card title="Day of the month" subtitle="Total spending on each calendar day">
          <Chart option={domOption} label="Spending by day of the month" />
        </Card>
        <Card wide title="When you record expenses" subtitle="Number of entries by weekday and hour. Based on when entries were saved, so back-dated entries show the time you typed them.">
          <Chart option={heatOption} label="Expense entries by weekday and hour" height={300} />
        </Card>
        <Card title="Expense sizes" subtitle="How many expenses fall in each amount band">
          <Chart option={sizeOption} label="Distribution of expense amounts" />
        </Card>
        <Card
          title="Top places and payees"
          subtitle="Grouped by the note on each expense"
          actions={<input type="search" placeholder="Search" aria-label="Search places" value={q} onChange={(e) => setQ(e.target.value)} />}
        >
          <DataTable
            rows={shown}
            rowKey={(r) => r.key}
            limit={10}
            initialSort={{ key: 't', desc: true }}
            onRowClick={(r) => go('transactions', { q: r.name })}
            columns={[
              { key: 'n', label: 'Name', render: (r) => r.name, sort: (r) => r.name },
              { key: 't', label: 'Total', num: true, render: (r) => fmt.money(r.total), sort: (r) => r.total },
              { key: 'c', label: 'Visits', num: true, render: (r) => r.count, sort: (r) => r.count },
              { key: 'a', label: 'Avg', num: true, render: (r) => fmt.money(r.avgTicket), sort: (r) => r.avgTicket },
              { key: 'l', label: 'Last', render: (r) => fmtDate(r.last), sort: (r) => r.last },
            ]}
          />
        </Card>
      </Grid>
    </>
  );
}
