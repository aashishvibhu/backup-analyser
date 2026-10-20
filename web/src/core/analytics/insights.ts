import type { BudgetReport } from './budgets';
import type { CardReport } from './cards';
import type { FlowRow, FlowSummary } from './cashflow';
import { mean, stdDev } from './cashflow';
import type { CategoryChange } from './categories';
import type { Anomaly } from './forecast';
import type { RecurringItem } from './recurring';

export type Tone = 'good' | 'warning' | 'info';

export interface Insight {
  tone: Tone;
  title: string;
  detail?: string;
}

export interface InsightInput {
  rangeLabel: string;
  current: FlowSummary;
  previous: FlowSummary;
  /** Complete months in the last year, for "typical" comparisons. */
  lastYear: FlowRow[];
  categoryChanges: CategoryChange[];
  recurring: RecurringItem[];
  budgets: BudgetReport[];
  cards: CardReport[];
  anomalies: Anomaly[];
  noSpendDays: number;
  days: number;
  liquid: number;
  fmt: (n: number) => string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Plain-language observations about the selected range, most important first. */
export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  const { current: c, previous: p, fmt } = i;

  if (c.income > 0) {
    const typical = mean(i.lastYear.filter((r) => r.income > 0).map((r) => r.savingsRate ?? 0));
    const sr = c.savingsRate ?? 0;
    out.push({
      tone: sr >= 0.2 ? 'good' : sr >= 0 ? 'info' : 'warning',
      title: sr >= 0 ? `You saved ${pct(sr)} of your income (${fmt(c.net)})` : `You spent ${fmt(-c.net)} more than you earned`,
      detail: i.lastYear.length ? `Your typical monthly savings rate over the last year is ${pct(typical)}.` : undefined,
    });
  } else if (c.expense > 0) {
    out.push({ tone: 'info', title: `No income recorded ${i.rangeLabel}`, detail: `Spending was ${fmt(c.expense)}.` });
  }

  if (p.expense > 0 && c.expense > 0) {
    const change = (c.expense - p.expense) / p.expense;
    if (Math.abs(change) >= 0.1) {
      out.push({
        tone: change > 0 ? 'warning' : 'good',
        title: `Spending is ${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} on the previous period`,
        detail: `${fmt(c.expense)} vs ${fmt(p.expense)}.`,
      });
    }
  }

  for (const ch of i.categoryChanges.slice(0, 3)) {
    if (Math.abs(ch.delta) < Math.max(1000, c.expense * 0.05)) continue;
    out.push({
      tone: ch.delta > 0 ? 'warning' : 'good',
      title: `${ch.name} ${ch.delta > 0 ? 'rose' : 'fell'} by ${fmt(Math.abs(ch.delta))}`,
      detail: ch.previous ? `${fmt(ch.current)} vs ${fmt(ch.previous)} in the previous period.` : `Nothing was spent here in the previous period.`,
    });
  }

  for (const b of i.budgets) {
    if (b.current.status === 'over') {
      out.push({ tone: 'warning', title: `Over the ${b.name} budget`, detail: `${fmt(b.current.actual)} of ${fmt(b.amount)} this month.` });
    } else if (b.current.status === 'at-risk') {
      out.push({
        tone: 'warning',
        title: `On pace to exceed the ${b.name} budget`,
        detail: `Projected ${fmt(b.current.projected)} against ${fmt(b.amount)}.`,
      });
    }
  }

  const active = i.recurring.filter((r) => r.active);
  if (active.length) {
    const monthly = active.reduce((a, r) => a + r.monthlyCost, 0);
    out.push({
      tone: 'info',
      title: `${active.length} recurring payments cost about ${fmt(monthly)} a month`,
      detail: active.slice(0, 4).map((r) => r.name).join(', ') + (active.length > 4 ? '…' : ''),
    });
    for (const r of active.filter((r) => r.priceIncrease).slice(0, 2)) {
      out.push({ tone: 'warning', title: `${r.name} now costs ${fmt(r.lastAmount)}`, detail: `Up from about ${fmt(r.avgAmount)}.` });
    }
  }

  for (const card of i.cards) {
    const missed = card.cycles.filter((cy) => cy.status === 'partial' || cy.status === 'unpaid');
    if (missed.length) {
      out.push({
        tone: 'warning',
        title: `${card.account.name}: ${missed.length} statement${missed.length > 1 ? 's' : ''} not paid in full by the due date`,
        detail: `Latest: statement ${missed.at(-1)!.statement}, owed ${fmt(missed.at(-1)!.owed)}, paid ${fmt(missed.at(-1)!.paidByDue)}.`,
      });
    }
  }

  if (i.anomalies.length) {
    const a = i.anomalies[0];
    out.push({
      tone: 'info',
      title: `${i.anomalies.length} unusually large expense${i.anomalies.length > 1 ? 's' : ''}`,
      detail: `Largest: ${fmt(a.txn.amountMain)} on ${a.txn.date}${a.txn.memo ? ` (${a.txn.memo})` : ''}, ${a.reason}.`,
    });
  }

  const typicalCore = mean(i.lastYear.map((r) => r.coreExpense));
  if (typicalCore > 0) {
    const months = i.liquid / typicalCore;
    out.push({
      tone: months >= 6 ? 'good' : months >= 3 ? 'info' : 'warning',
      title: `Cash and bank balances cover ${months.toFixed(1)} months of typical spending`,
      detail: `A common target is 6 months (${fmt(typicalCore * 6)}).`,
    });
  }

  if (i.days >= 7 && i.noSpendDays > 0) {
    out.push({ tone: 'info', title: `${i.noSpendDays} no-spend days out of ${i.days}` });
  }
  return out;
}

export interface HealthComponent {
  key: string;
  label: string;
  /** 0–1, or null when there is not enough data (excluded from the score). */
  score: number | null;
  weight: number;
  value: string;
  explanation: string;
}

export interface HealthScore {
  score: number;
  components: HealthComponent[];
}

export interface HealthInput {
  lastYear: FlowRow[];
  liquid: number;
  liabilities: number;
  budgets: BudgetReport[];
  cards: CardReport[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** A 0–100 score built from transparent, documented components. */
export function healthScore(h: HealthInput): HealthScore {
  const income = h.lastYear.reduce((a, r) => a + r.income, 0);
  const expense = h.lastYear.reduce((a, r) => a + r.expense, 0);
  const core = h.lastYear.map((r) => r.coreExpense);
  const avgCore = mean(core);
  const sr = income > 0 ? (income - expense) / income : null;
  const untracked = h.lastYear.reduce((a, r) => a + r.adjustIn + r.adjustOut + r.correctionIncome + r.correctionExpense, 0);
  const flow = income + expense;
  const adherence = h.budgets.map((b) => b.adherence).filter((x): x is number => x !== null);
  const cardRates = h.cards.map((c) => c.paidInFullRate).filter((x): x is number => x !== null);

  const components: HealthComponent[] = [
    {
      key: 'savings',
      label: 'Savings rate',
      weight: 25,
      score: sr === null ? null : clamp01(sr / 0.3),
      value: sr === null ? '–' : pct(sr),
      explanation: 'Share of the last 12 months of income not spent. 30% or more scores full marks.',
    },
    {
      key: 'buffer',
      label: 'Emergency buffer',
      weight: 20,
      score: avgCore > 0 ? clamp01(h.liquid / avgCore / 6) : null,
      value: avgCore > 0 ? `${(h.liquid / avgCore).toFixed(1)} months` : '–',
      explanation: 'Cash and bank balances divided by typical monthly core spending. 6 months scores full marks.',
    },
    {
      key: 'debt',
      label: 'Debt load',
      weight: 10,
      score: income > 0 ? clamp01(1 - -h.liabilities / income) : null,
      value: income > 0 ? `${pct(-h.liabilities / income)} of yearly income` : '–',
      explanation: 'Everything owed (cards, loans) compared with a year of income. No debt scores full marks.',
    },
    {
      key: 'cards',
      label: 'Card bills paid in full',
      weight: 15,
      score: cardRates.length ? mean(cardRates) : null,
      value: cardRates.length ? pct(mean(cardRates)) : 'No cards',
      explanation: 'Share of credit-card statements paid in full by the due date.',
    },
    {
      key: 'stability',
      label: 'Spending stability',
      weight: 10,
      score: core.length >= 3 && avgCore > 0 ? clamp01(1 - stdDev(core) / avgCore) : null,
      value: core.length >= 3 && avgCore > 0 ? `±${pct(stdDev(core) / avgCore)} month to month` : '–',
      explanation: 'How much monthly core spending (excluding one-offs) swings around its average.',
    },
    {
      key: 'budgets',
      label: 'Budget adherence',
      weight: 10,
      score: adherence.length ? mean(adherence) : null,
      value: adherence.length ? pct(mean(adherence)) : 'No budgets',
      explanation: 'Share of past months that stayed within each budget set in the app.',
    },
    {
      key: 'tracking',
      label: 'Tracking accuracy',
      weight: 10,
      score: flow > 0 ? clamp01(1 - (untracked / flow) * 10) : null,
      value: flow > 0 ? `${pct(untracked / flow)} corrected` : '–',
      explanation: 'Balance corrections ("Difference" entries) relative to all income and spending. Fewer corrections mean money is tracked as it moves.',
    },
  ];
  const scored = components.filter((c) => c.score !== null);
  const totalWeight = scored.reduce((a, c) => a + c.weight, 0);
  const score = totalWeight ? Math.round((scored.reduce((a, c) => a + c.score! * c.weight, 0) / totalWeight) * 100) : 0;
  return { score, components };
}
