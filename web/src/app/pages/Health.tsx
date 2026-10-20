import { useMemo } from 'react';
import { spendDays } from '../../core/analytics/behaviour';
import { summarize } from '../../core/analytics/cashflow';
import { compareCategories } from '../../core/analytics/categories';
import { findAnomalies } from '../../core/analytics/forecast';
import { buildInsights, healthScore, type Insight } from '../../core/analytics/insights';
import { periodOf, addDays } from '../../core/analytics/periods';
import { Badge, Card, Empty, Grid, Meter } from '../components/ui';
import { useBalances, useBudgets, useCards, useLastYear, useRecurring } from '../derived';
import { fmtRange } from '../format';
import { useApp } from '../store';

const TONE = { good: 'good', warning: 'warning', info: 'neutral' } as const;
const TONE_LABEL = { good: 'Good', warning: 'Watch', info: 'Note' } as const;

export function InsightList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return <Empty>Nothing to report.</Empty>;
  return (
    <ul className="insights">
      {insights.map((i, n) => (
        <li key={n}>
          <Badge kind={TONE[i.tone]}>{TONE_LABEL[i.tone]}</Badge>
          <div>
            <strong>{i.title}</strong>
            {i.detail && <p className="muted small">{i.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Health() {
  const { ledger, allTxns, o, oneOff, fmt } = useApp();
  const lastYear = useLastYear();
  const { liquid, liabilities } = useBalances();
  const budgets = useBudgets();
  const cards = useCards();
  const recurring = useRecurring();
  const health = useMemo(() => healthScore({ lastYear, liquid, liabilities, budgets, cards }), [lastYear, liquid, liabilities, budgets, cards]);

  // Insights here always describe the latest complete month against the one before.
  const insights = useMemo(() => {
    const current = periodOf(ledger.anchor, 'month', o);
    const last = periodOf(addDays(current.start, -1), 'month', o);
    const before = periodOf(addDays(last.start, -1), 'month', o);
    const inRange = (p: { start: string; end: string }) => allTxns.filter((t) => t.date >= p.start && t.date <= p.end);
    const cur = inRange(last);
    const prev = inRange(before);
    const days = spendDays(cur, last.start, last.end);
    return {
      period: last,
      list: buildInsights({
        rangeLabel: 'last month',
        current: summarize(cur, oneOff),
        previous: summarize(prev, oneOff),
        lastYear,
        categoryChanges: compareCategories(cur, prev, 'expense'),
        recurring,
        budgets,
        cards,
        anomalies: findAnomalies(allTxns, cur),
        noSpendDays: days.noSpendDays,
        days: days.days,
        liquid,
        fmt: fmt.money,
      }),
    };
  }, [ledger, o, allTxns, oneOff, lastYear, recurring, budgets, cards, liquid, fmt]);

  const band = health.score >= 75 ? 'good' : health.score >= 50 ? 'warning' : 'critical';
  const bandLabel = health.score >= 75 ? 'Strong' : health.score >= 50 ? 'Fair' : 'Needs attention';

  return (
    <Grid>
      <Card title="Financial health score" subtitle="Based on the last 12 complete months and current balances">
        <div className="hero">
          <span className="hero-number">{health.score}</span>
          <span className="muted">/ 100</span>
          <Badge kind={band}>{bandLabel}</Badge>
        </div>
        <p className="muted small">
          A weighted average of the parts below. Parts without enough data (for example, no budgets) are left out and the
          others are re-weighted. It is a summary of your own records, not financial advice.
        </p>
      </Card>
      <Card title={`Last month in brief`} subtitle={fmtRange(insights.period.start, insights.period.end)}>
        <InsightList insights={insights.list} />
      </Card>
      <Card wide title="What the score is made of">
        <ul className="components">
          {health.components.map((c) => (
            <li key={c.key}>
              <div className="row-between">
                <strong>{c.label}</strong>
                <span>
                  {c.value} <span className="muted small">· weight {c.weight}</span>
                </span>
              </div>
              {c.score === null ? (
                <p className="muted small">Not enough data — left out of the score.</p>
              ) : (
                <Meter value={c.score} max={1} kind={c.score >= 0.75 ? 'good' : c.score >= 0.5 ? 'warning' : 'critical'} />
              )}
              <p className="muted small">{c.explanation}</p>
            </li>
          ))}
        </ul>
      </Card>
    </Grid>
  );
}
