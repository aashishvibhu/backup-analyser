# Backup Analyser (web)

A private, in-browser analytics app for Money Manager `.mmbak` backups. The file is parsed in the browser with sql.js
(SQLite compiled to WebAssembly) and never uploaded. Production builds carry a Content-Security-Policy that blocks
connections to other origins. The app installs as a PWA and works offline.

```
npm install
npm run dev                         # http://localhost:5173 ("Try with sample data" needs no real backup)
npm test                            # unit + end-to-end analytics tests on a synthetic backup
npm run build && npm run preview    # production build at http://localhost:4173 (CSP + service worker active)
npm run report -- <file.mmbak>                # balances and monthly totals in the terminal
npm run report -- <file.mmbak> --all          # plus a smoke run of every analytic
npm run report -- <file.mmbak> --calendar --as-of 2026-09-30
```

## Pages

| Page | What it shows |
|---|---|
| Overview | Income, spending, saved, net worth and health score with change against the previous period; monthly chart; top categories; generated insights; upcoming recurring payments |
| Cash flow | Weekly, monthly, quarterly, financial-year and yearly totals; 3-period average; savings and cumulative savings; savings rate; full table with CSV export |
| Categories | Category tree with subcategories, treemap, stacked monthly bars, category × month heat map, fixed/regular/occasional/one-off patterns, comparison with the previous period |
| Accounts & net worth | Net worth over time (cash, investments, other assets, debts), balances by group, per-account balance history, dormant accounts |
| Credit cards | Statement cycles from each card's statement and payment days; owed vs paid by the due date; paid / paid late / partly paid / not paid |
| Investments & loans | Monthly contributions, consistency, per-account totals, loan balances and payoff estimate, shared-expense and wallet account balances |
| Money flow | Sankey from income categories to spending categories and savings; transfers between account groups |
| Spending habits | Weekday and day-of-month patterns, weekday × hour heat map, expense size bands, no-spend days, top places and payees |
| Subscriptions & bills | Recurring payments detected from history (cadence, monthly cost, price increases, next charge) plus the app's repeat rules |
| Budgets | The app's budgets against actual spending, pace for the current month, history and adherence, suggested budgets |
| Forecast & alerts | Next month's income and core spending (median of recent months), current-month and financial-year projections, unusual expenses, category spikes |
| Financial health | A 0–100 score from documented parts (savings rate, emergency buffer, debt, card bills, stability, budgets, tracking accuracy) and last month in brief |
| Transactions | Search and filters (type, category, account, amount), sorting, paging, CSV export; every chart links here |
| Settings | Month start day, financial-year start, counting balance corrections, one-off categories (with suggestions), excluded accounts and tags, theme, saved backup |

Settings are stored per backup in `localStorage`. "Keep it on this device" stores the backup file in IndexedDB.

## Layout

- `src/core/parser/mmbak.ts`: the only code that knows the raw schema. Produces a `Dataset` (`src/core/model.ts`).
- `src/core/ledger.ts`: enriched transactions, user prefs, filtering.
- `src/core/analytics/*`: pure functions, one module per area, all covered by `analytics.test.ts`.
- `src/demo/generateBackup.ts`: deterministic synthetic `.mmbak` used by the tests and the "sample data" button.
- `src/app/*`: React UI (store, router, ECharts wrapper, pages). Chart colours are the validated reference palette, with separate light and dark steps.
- `scripts/report.ts`: command-line report for checking numbers against the app.

See `../docs/ANALYTICS_PLAN.md` for the format notes, assumptions and open questions.
