import { useCallback, useMemo } from 'react';
import { incomeToSpendSankey, transferMatrix } from '../../core/analytics/flows';
import { Chart } from '../components/Chart';
import { Card, DataTable, Empty, Grid } from '../components/ui';
import { useApp } from '../store';
import type { ChartTheme } from '../theme';

export function Flow() {
  const { ledger, txns, fmt } = useApp();
  const sankey = useMemo(() => incomeToSpendSankey(txns, 10), [txns]);
  const edges = useMemo(() => transferMatrix(ledger, txns), [ledger, txns]);

  const option = useCallback(
    (t: ChartTheme) => {
      const color = (kind: string) => (kind === 'income' ? t.series[0] : kind === 'expense' ? t.series[1] : kind === 'saving' ? t.series[2] : t.textSecondary);
      return {
        tooltip: {
          trigger: 'item',
          formatter: (p: { dataType: string; name: string; value: number; data: { source?: string; target?: string } }) =>
            p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}<br/><b>${fmt.money(p.value)}</b>` : `${p.name}<br/><b>${fmt.money(p.value)}</b>`,
        },
        series: [
          {
            type: 'sankey',
            left: 8,
            right: 140,
            top: 8,
            bottom: 8,
            nodeWidth: 10,
            nodeGap: 10,
            draggable: false,
            emphasis: { focus: 'adjacency' },
            label: { color: t.text, fontSize: 12, formatter: (p: { name: string; value: number }) => `${p.name.trim()}  ${fmt.compact(p.value)}` },
            lineStyle: { color: 'gradient', opacity: 0.3, curveness: 0.5 },
            itemStyle: { borderWidth: 0 },
            data: sankey.nodes.map((n) => ({ name: n.name, itemStyle: { color: color(n.kind) } })),
            links: sankey.links,
          },
        ],
      };
    },
    [sankey, fmt],
  );

  const height = Math.max(320, sankey.nodes.length * 28);
  return (
    <Grid>
      <Card
        wide
        title="From income to spending"
        subtitle="Income categories on the left, spending categories on the right. The difference is what you saved (or drew from savings)."
        table={
          <DataTable
            rows={sankey.links}
            rowKey={(r, i) => `${r.source}-${r.target}-${i}`}
            columns={[
              { key: 's', label: 'From', render: (r) => r.source.trim() },
              { key: 't', label: 'To', render: (r) => r.target.trim() },
              { key: 'v', label: 'Amount', num: true, render: (r) => fmt.money(r.value) },
            ]}
          />
        }
      >
        {sankey.links.length ? <Chart option={option} label="Flow of money from income to spending categories" height={height} /> : <Empty>No income or spending in this period.</Empty>}
      </Card>
      <Card wide title="Money moved between accounts" subtitle="Transfers between account groups (card bill payments, savings, investments, top-ups)">
        {edges.length ? (
          <DataTable
            rows={edges}
            rowKey={(r) => `${r.from}-${r.to}`}
            initialSort={{ key: 'v', desc: true }}
            columns={[
              { key: 'f', label: 'From', render: (r) => r.from, sort: (r) => r.from },
              { key: 't', label: 'To', render: (r) => r.to, sort: (r) => r.to },
              { key: 'n', label: 'Transfers', num: true, render: (r) => r.count, sort: (r) => r.count },
              { key: 'v', label: 'Amount', num: true, render: (r) => fmt.money(r.total), sort: (r) => r.total },
            ]}
          />
        ) : (
          <Empty>No transfers in this period.</Empty>
        )}
      </Card>
    </Grid>
  );
}
