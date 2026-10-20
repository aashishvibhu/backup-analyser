import { useMemo } from 'react';
import { Badge, Card, DataTable, Empty, Grid, Tile, Tiles } from '../components/ui';
import { useRecurring } from '../derived';
import { fmtDate } from '../format';
import { go } from '../router';
import { useApp } from '../store';

const CADENCE = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' } as const;

export function Recurring() {
  const { fmt, ledger } = useApp();
  const items = useRecurring();
  const active = items.filter((r) => r.active);
  const stopped = items.filter((r) => !r.active);
  const monthly = active.reduce((a, r) => a + r.monthlyCost, 0);
  const rules = useMemo(
    () =>
      ledger.ds.recurring.map((r) => ({
        ...r,
        account: ledger.accountById.get(r.accountId)?.name ?? '–',
        category: ledger.categoryById.get(r.categoryId ?? '')?.name ?? '–',
      })),
    [ledger],
  );

  const columns = [
    { key: 'n', label: 'Name', render: (r: (typeof items)[number]) => r.name, sort: (r: (typeof items)[number]) => r.name },
    { key: 'c', label: 'Category', render: (r: (typeof items)[number]) => r.category, sort: (r: (typeof items)[number]) => r.category },
    { key: 'f', label: 'How often', render: (r: (typeof items)[number]) => CADENCE[r.cadence], sort: (r: (typeof items)[number]) => r.cadence },
    {
      key: 'a',
      label: 'Amount',
      num: true,
      render: (r: (typeof items)[number]) => (
        <>
          {fmt.money(r.lastAmount)} {r.priceIncrease && <Badge kind="warning">Price up</Badge>}
        </>
      ),
      sort: (r: (typeof items)[number]) => r.lastAmount,
    },
    { key: 'm', label: 'Per month', num: true, render: (r: (typeof items)[number]) => fmt.money(r.monthlyCost), sort: (r: (typeof items)[number]) => r.monthlyCost },
    { key: 'k', label: 'Times', num: true, render: (r: (typeof items)[number]) => r.occurrences, sort: (r: (typeof items)[number]) => r.occurrences },
    { key: 'l', label: 'Last', render: (r: (typeof items)[number]) => fmtDate(r.last), sort: (r: (typeof items)[number]) => r.last },
  ];

  return (
    <>
      <p className="muted small intro">
        Found automatically from your full history: the same note (or category and amount) charged on a steady schedule.
        This page always uses all your data, not the date range.
      </p>
      <Tiles>
        <Tile label="Active recurring payments" value={active.length} />
        <Tile label="Per month" value={fmt.money(monthly)} />
        <Tile label="Per year" value={fmt.money(monthly * 12)} />
        <Tile label="Price increases" value={active.filter((r) => r.priceIncrease).length} sub="Latest charge more than 10% above the previous one" />
      </Tiles>
      <Grid>
        <Card wide title="Active" subtitle="Still being charged">
          {active.length ? (
            <DataTable
              rows={active}
              rowKey={(r) => r.key}
              initialSort={{ key: 'm', desc: true }}
              onRowClick={(r) => go('transactions', { q: r.name, from: r.first })}
              columns={[
                ...columns,
                { key: 'x', label: 'Next expected', render: (r) => fmtDate(r.nextExpected), sort: (r) => r.nextExpected },
                { key: 'src', label: '', render: (r) => (r.fromRule ? <Badge kind="neutral">Set up in app</Badge> : null) },
              ]}
            />
          ) : (
            <Empty>No recurring payments detected.</Empty>
          )}
        </Card>
        <Card wide title="Stopped" subtitle="Recurring in the past, no recent charge">
          {stopped.length ? (
            <DataTable rows={stopped} rowKey={(r) => r.key} initialSort={{ key: 'l', desc: true }} limit={10} columns={columns} />
          ) : (
            <Empty>Nothing here.</Empty>
          )}
        </Card>
        {rules.length > 0 && (
          <Card wide title="Repeat rules in the app" subtitle="Recurring entries you set up in Money Manager">
            <DataTable
              rows={rules}
              rowKey={(r) => r.id}
              columns={[
                { key: 'c', label: 'Category', render: (r) => r.category },
                { key: 'a', label: 'Account', render: (r) => r.account },
                { key: 'm', label: 'Amount', num: true, render: (r) => fmt.money(r.amount) },
                { key: 'n', label: 'Next', render: (r) => (r.nextDate ? fmtDate(new Date(r.nextDate).toISOString().slice(0, 10)) : '–') },
              ]}
            />
          </Card>
        )}
      </Grid>
    </>
  );
}
