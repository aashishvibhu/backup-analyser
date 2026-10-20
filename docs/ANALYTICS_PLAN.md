# Money Manager Analyser — Data Findings, Analytics Catalogue & Plan

Based on an Android Money Manager (Realbyte) backup with `user_version = 19`. All figures below are from the synthetic sample backup in `web/src/demo/generateBackup.ts`, not from a real user.

---

## 1. What the `.mmbak` file actually is

A plain **SQLite 3 database** (renamed). No encryption and no compression, so any SQLite engine can read it, including `sql.js` (WASM) in a browser.

### 1.1 Tables and what they mean

| Table | Meaning | Key columns |
|---|---|---|
| `INOUTCOME` | **All transactions** | `DO_TYPE`, `ZMONEY`, `WDATE`, `ZDATE`, `assetUid`, `toAssetUid`, `ctgUid`, `ZCONTENT`, `txUidTrans`, `currencyUid`, `AMOUNT_ACCOUNT` |
| `ASSETS` | Accounts (bank, cash, card, loan, FD, shared-expense groups, etc.) | `NIC_NAME`, `groupUid`, `CARD_DAY_FIN`, `CARD_DAY_PAY`, `cardAssetUid`, `ZDATA` (hidden/status flag), `ORDERSEQ` |
| `ASSETGROUP` | Account groups (`TYPE`: 1 Accounts, 2 Card, 3 Debit card, 4 Deposit, 5 Loan, 6 Prepaid, 7 Others, 8 Investments, 9 Overdraft, 10 Insurance, 11 Cash, 0 user-defined) | `ACC_GROUP_NAME`, `TYPE`, `IS_DEL` |
| `ZCATEGORY` | Category tree, 2 levels | `NAME`, `TYPE` (0 income, 1 expense), `pUid` (parent), `C_IS_DEL` (null = active, 1 = deleted) |
| `BUDGET` + `BUDGET_AMOUNT` | Budgets per category per period | `targetUid`, `PERIOD_TYPE`, `AMOUNT`, `IS_TOTAL` |
| `REPEATTRANSACTION` | Recurring transactions (subscriptions, EMIs) | `REPEAT_TYPE`, `AMOUNT_SUB`, `NEXT_DATE`, `END_DATE` |
| `TAG` / `TX_TAG` | Tags and links to transactions | `name` |
| `CURRENCY` | Currencies and FX rates (one is marked as the main currency) | `ISO`, `RATE`, `IS_MAIN_CURRENCY` |
| `ZETC` | **App settings** (start day of month, week start, carry-over, card accounting type, and so on) | `dataTypeKey`, `ZDATA` |
| `FAVTRANSACTION`, `MEMO`, `PHOTO`, `SMS_RAW_READ`, `MESSAGEMACRO2`, `CODE_*` | Favourites, notes, receipt photos, SMS parsing. Often empty, but they must still be supported. | — |

### 1.2 Transaction type decoding (`INOUTCOME.DO_TYPE`)

| DO_TYPE | Meaning | Rows in the sample backup | Notes |
|---|---|---|---|
| 0 | Income | 75 | has `ctgUid` |
| 1 | Expense | 907 | has `ctgUid` |
| 3 | Transfer **out** | 148 | paired with a type-4 row through `txUidTrans` |
| 4 | Transfer **in** | 148 | mirror row. **Count only one side, or totals double.** |
| 7 | Balance adjustment **+** | 4 | memo is "Difference", made when the user edits a balance |
| 8 | Balance adjustment **−** | 1 | same as 7, in the other direction |

### 1.3 Format quirks the parser must handle

- **Amounts are stored as TEXT** (`'120.50'`). Cast them, and expect the odd null amount.
- **Two dates per row.** `WDATE` = `YYYY-MM-DD` (the date the user assigned). `ZDATE` = epoch milliseconds that **includes a time of day**, so time-of-day analytics are possible. Back-dated entries keep the time they were typed in, so treat time as approximate.
- **Soft deletes use different conventions per table**: `IS_DEL`, `C_IS_DEL` (null means active), `isDel`.
- The denormalised columns `ASSET_NIC` and `CATEGORY_NAME` can be **empty**. Always join through the uid columns.
- **The user's own settings change the results**:
  - `start_day` is the day the user's month begins on. Someone paid on the 25th might set it to 25; a calendar-month view would then put each salary in the wrong month, making one month look rich and the next look empty. **We must honour this setting.**
  - `week_start_day` sets the first day of the week.
  - `carry_over` controls whether the remaining balance carries into the next period.
  - `card_accounting_type` controls whether a card expense counts on the purchase date or on the payment date.
- **Credit-card cycles** are in `ASSETS`. For example, a card with its statement on the 2nd and payment due on the 22nd.
- **Account balances are not stored.** They have to be **rebuilt** from the full transaction history: income − expense − transfer out + transfer in + adjustments.
- Some users have multiple currencies. `AMOUNT_ACCOUNT` holds the amount in the account's own currency. Convert through `CURRENCY.RATE`.
- The schema version (`PRAGMA user_version`) and the iOS/Android variants can differ. Detect the version and fail gracefully.

### 1.4 Sample data profile

From the synthetic sample backup (`web/src/demo/generateBackup.ts`):

- Period: 1 Jan 2024 → 31 Dec 2025 (24 months), all in INR. File size 160 KB.
- Income ₹22.5 L in 75 entries. Expense ₹16.0 L in 907 entries. Internal transfers ₹14.8 L.
- 10 accounts in 7 groups: cash, 2 bank accounts, 2 credit cards, a fixed deposit, 2 investment accounts, a car loan and a shared trip account.
- 28 categories (14 top-level, 14 subcategories).
- Every row has a memo. In real backups memos are optional and often hold the merchant or payee name.
- Real backups may also hold GPS, photos, SMS-parsing data, payees and tags; the sample uses tags only.

---

## 2. Analytics catalogue (everything this file supports)

✅ = works directly from the data · 🧮 = derived or inferred · ⚠️ = depends on how the user entered data

### A. Overview and cash flow
1. ✅ Income, expense, net savings and **savings rate** per day, week, month, quarter, year and **Indian financial year (Apr–Mar)**, using the user's custom month start.
2. ✅ Cumulative cash-flow curve. Rolling 3-, 6- and 12-month averages.
3. ✅ Month-on-month and year-on-year deltas. "This period vs your average" cards.
4. 🧮 Lifestyle-inflation index: core spend (excluding one-offs) growth year over year.
5. 🧮 Burn rate and runway: liquid balance ÷ average monthly spend.

### B. Categories
6. ✅ Category tree as a sunburst or treemap (parent → sub). Share %. Top-N.
7. ✅ Trend per category and subcategory. Heat-map of category × month.
8. 🧮 Fixed vs variable vs discretionary split (auto-classified by regularity; the user can override).
9. 🧮 Category volatility (std-dev, coefficient of variation) to find unpredictable spend.
10. 🧮 One-off big-ticket detection (furniture, a car, a wedding), so they can be shown separately from normal spending.
11. ✅ Income source mix: salary vs passive (interest, dividends, capital gains) vs rewards.

### C. Accounts and net worth
12. 🧮 **Rebuilt running balance per account** on any date.
13. 🧮 **Net-worth timeline**: assets (cash, bank, deposits, investments) − liabilities (cards, loans).
14. ✅ Allocation by account group: liquid vs locked (FD, investments).
15. 🧮 Dormant or archived account detection. Accounts with very many adjustments.
16. ✅ Spend per account or payment method (UPI vs card vs cash).

### D. Credit cards (from statement-day and due-day settings)
17. 🧮 Spend per **statement cycle** per card. Outstanding at each statement.
18. 🧮 Payment discipline: was the card paid in full and before the due date? (Detect transfer → card.)
19. 🧮 Card-wise reward ROI: reward income ÷ card spend.
20. ✅ Card EMI and split-month (`CARDDIVIDMONTH`) tracking.

### E. Transfers and money movement
21. ✅ **Sankey diagram**: income → accounts → expense categories and investments.
22. ✅ Investment contributions (transfers into the Investments and Deposit groups). SIP consistency.
23. 🧮 Loan tracking: principal repaid over time, projected payoff date.
24. ✅ Shared-expense and wallet accounts: **who owes whom**, plus ageing of receivables.

### F. Behaviour
25. ✅ Day-of-week and day-of-month spend patterns (for example, the post-salary spike).
26. ⚠️ Time-of-day patterns (from `ZDATE`; approximate).
27. ✅ Transaction-size histogram. Micro-spend leakage (many small amounts).
28. 🧮 No-spend-day streaks. Spend-frequency per category.
29. 🧮 **Merchant analytics** from memo text (normalised): top merchants, visit frequency, average ticket.
30. 🧮 **Recurring and subscription detection** (similar amount and memo on a periodic schedule) in addition to `REPEATTRANSACTION`. Projects the monthly committed outflow.

### G. Budgets and planning
31. ✅ Budget vs actual per category and period. Historical adherence %.
32. 🧮 Mid-month pace: "at this rate you will exceed Food by ₹X".
33. 🧮 Suggested budgets (based on the historical median or a percentile).
34. 🧮 Forecasting: next-month spend and year-end savings (seasonality and trend).

### H. Insights and data health
35. 🧮 Anomaly alerts: unusual amounts, new merchants, category spikes.
36. ⚠️ **Tracking-accuracy score**: the volume of "Difference" adjustments measures how much money went untracked.
37. ✅ Tag-based views, for example excluding a "Reimbursable" tag from normal spend.
38. 🧮 Plain-language monthly report ("You saved 34 %, Food up 22 %, 3 subscriptions renewing"). This could be LLM-generated.
39. ✅ Full transaction explorer: search, filters, pivot, export to CSV/Excel.
40. 🧮 Comparing **two backups**: what changed, and edits to past entries.

---

## 3. Proposed high-level design (draft — depends on answers to §5)

Recommended: **privacy-first and client-side**. The `.mmbak` is parsed and analysed in the browser, so the financial data never leaves the device.

```
 ┌──────────── Browser / PWA ────────────────────────────────────┐
 │ Upload (.mmbak) → Validator → sql.js (SQLite WASM)            │
 │        → Normaliser (canonical model: Txn, Account, Category, │
 │          Transfer, Budget, Settings; decode types, dates, FX) │
 │        → Analytics engine (pure TS functions, unit-tested)    │
 │        → Dashboards (React + ECharts) · Explorer · Export     │
 │ IndexedDB: optional local cache, user overrides, history      │
 └───────────────────────────────────────────────────────────────┘
 Optional backend (only if accounts, sync or AI are required):
   Auth · encrypted snapshot storage · LLM insight service · billing
```

Module boundaries:
1. **`parser`**: detects the version, maps the raw schema → a canonical JSON model. This is the only part that knows Realbyte table names, so a schema change stays isolated here.
2. **`model`**: types plus the canonical dataset, independent of the source format. It could later accept CSV exports or other apps.
3. **`analytics`**: pure functions `(dataset, period, filters) → result`. Golden tests use sample backups.
4. **`ui`**: global period and filter bar, dashboard pages, drill-down from every chart to its transactions.

---

## 4. Phased plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Discovery and spike** (now) | Schema decoding. Collect 3–5 more backups (other users, iOS, older versions). Parser prototype. | Rebuilt balances and monthly totals **match what the Money Manager app shows** for the test backups. |
| **1 — MVP** | Upload and validation, Overview (A), Categories (B), Accounts and net worth (C), Transaction explorer, custom month start, FY view, CSV export. | A consumer uploads a file and sees correct dashboards in under 3 s. |
| **2 — Depth** | Credit cards (D), Sankey and investments and loans (E), budgets (G 31–33), behaviour (F), merchant normalisation, recurring detection. | |
| **3 — Intelligence** | Forecasts, anomalies, health score, plain-language report, two-backup comparison. | |
| **4 — Product** | PWA or mobile packaging, optional accounts and sync, sharing and export to PDF, monetisation. | |

Risks:
- The format is proprietary and undocumented, and it can change with app updates. Mitigation: version detection and a test corpus.
- Balance reconstruction has to be validated against the app.
- Trademark: do not use Realbyte's "Money Manager" name or branding for the product. Describe it as "works with Money Manager backups".

---

## 4a. Build status (18 Oct 2026)

Phases 0–3 and the PWA part of Phase 4 are built in `web/` (see `web/README.md` for the page list). Not built: comparing
two backups, PDF export (the browser's print view is print-styled), an LLM-written report.

Decisions and assumptions made while building:
- **Transfers.** The two raw rows (types 3 and 4) are paired through their shared `txUidTrans` and merged into one transfer.
- **Balance corrections.**
  - Income or expense rows with category `-4` are "modify balance" entries. They count as income or expense by default; a setting turns this off.
  - Types 7 and 8 never count as income or expense.
- **Months.** By default a month follows the app's `start_day` and is labelled by the month it starts in. With start day 25, "Jul" runs from 25 Jul to 24 Aug.
- **Weeks.** `week_start_day` is read as java.util.Calendar numbering (1 = Sunday).
- **Credit cards.**
  - The due date is the first payment day after the statement date.
  - A cycle is "paid late" when it is cleared after the due date but before the next statement.
  - If a card's payment day in the app is set earlier than the real due date, most cycles show as late; the Credit cards page tells the user to check that setting.
- **`ASSETS.ZDATA` status flag.** Still unconfirmed (values 0, 1 and 3 appear). Accounts with a non-zero flag are labelled "Hidden in app" in the accounts table but still count in totals.
- **`card_accounting_type`** is not applied yet. Card spending always counts on the purchase date.
- **Recurring detection** is heuristic: at least 3 charges at a steady interval with a stable amount. Weekly items need a very stable amount, so grocery runs are not counted.

Verified:
- 32 unit and end-to-end tests pass on the synthetic backup.
- Every analytic runs on a backup of about 8,000 transactions in under 100 ms.
- Every page renders without console errors in the production build, in light and dark mode and at phone width.
- The CSP blocks outside requests.

Not yet verified: whether the numbers match the Money Manager app, and the "keep on this device" storage flow.

## 5. Open questions for the HLD

**Decided (18 Oct 2026)**
- Processing: **in the browser only**. No server receives financial data.
- Platform: **web app / PWA** first.
- Usage: **one-shot, no login**. Optional local cache in IndexedDB only.
- Stack: **React + TypeScript** (Vite, sql.js, ECharts). No backend for now.

This settles questions 2, 3, 6, 7 and 13 below. "Optional backend" in §3 and the accounts/sync part of Phase 4 are out of scope.

**Product**
1. Who are the users? Only Realbyte Money Manager users, or later also other apps or bank CSV imports?
2. Platform: web app or PWA, native mobile, or desktop?
3. One-shot use (upload → view → leave) or a persistent workspace with history of uploads and trends across backups?
4. Free, freemium, or paid? Is there a need for login and payments?
5. Should users be able to edit or override data in our app (re-categorise, mark one-offs, merge merchants)? These edits would never go back into Money Manager.

**Data and privacy**
6. Client-side only (the data never leaves the device), or is server-side processing and storage acceptable?
7. If server-side: retention policy, encryption at rest, region (India / DPDP Act compliance)?
8. AI insights via an LLM: acceptable to send aggregated (not raw) data to an API?

**Analytics semantics**
9. Should the default month follow the app's `start_day` setting, the calendar month, or let the user pick?
10. Should transfers to investments or deposits count as "savings" or stay separate?
11. Credit-card spend: count on the purchase date or on the payment date (follow `card_accounting_type`)?
12. How should balance adjustments ("Difference") be treated: hidden, shown as "untracked", or a user choice?

**Technical**
13. Preferred stack: React + TypeScript front end. If a backend exists, Java/Spring or Node?
14. Hosting target (Vercel, Netlify, AWS, self-hosted)?
15. For validation: compare the balances the Money Manager app shows for 3–4 accounts and one month's totals with `npm run report`.
16. Can you get backups from an iOS device or an older app version for compatibility testing?
