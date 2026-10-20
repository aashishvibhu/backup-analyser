# Backup Analyser

Private, in-browser analytics for **Money Manager** backup files (`.mmbak`).

Open a backup and get dashboards the app itself doesn't show: cash flow by any period, category trends,
net worth over time, credit-card statement tracking, subscriptions, budgets, forecasts and a financial
health score. Everything runs in your browser: the file is never uploaded anywhere.

> **Independent project.** Backup Analyser is not affiliated with, endorsed by, or sponsored by
> Realbyte or the makers of Money Manager. See [Legal](#legal).

## Features

- **Overview:** income, spending, savings and net worth, compared with the previous period, plus generated insights.
- **Cash flow:** weekly, monthly, quarterly, financial-year and yearly totals; savings rate; CSV export.
- **Categories:** treemap, monthly stacks, heat map, fixed vs. occasional spending, period comparison.
- **Accounts & net worth:** every balance rebuilt from history; assets, debts and net worth over time.
- **Credit cards:** statement cycles, amount owed, and whether each bill was paid in full by the due date.
- **Investments & loans:** monthly contributions, loan payoff estimates, shared-expense balances.
- **Money flow:** income-to-spending Sankey diagram and transfers between accounts.
- **Spending habits:** weekday and time-of-day patterns, no-spend days, top places and payees.
- **Subscriptions & bills:** recurring payments detected automatically, including price increases.
- **Budgets, forecasts and alerts:** budget pace, next-month forecast, unusual expenses, category spikes.
- **Financial health:** a 0–100 score built from documented, explained parts.
- **Transactions:** search, filters and CSV export; every chart drills down here.
- **Works offline** and installs to a phone or desktop home screen (PWA). Light and dark themes.

Try it without a backup: the start screen has **Try with sample data**, which generates a fictional dataset
on your device.

## Privacy

- **Local only.** The backup is read inside the browser tab with SQLite compiled to WebAssembly. There is no
  server, account, analytics, tracking or cookies.
- **Enforced, not just promised.** Production builds set a Content-Security-Policy that blocks connections to
  any other site, so the page cannot send your data anywhere.
- **Nothing is kept by default.** If you tick "Keep it on this device", the file is stored in your browser's
  own storage (IndexedDB) on that device only. Remove it from **Settings → Privacy and storage**, or by
  clearing the site's data.
- Display settings (theme, date range, which categories count as one-off) are saved in the browser's local
  storage on that device.

## Getting started

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

Other commands (run inside `web/`):

| Command | What it does |
|---|---|
| `npm test` | Unit and end-to-end tests on a synthetic backup |
| `npm run build` | Production build into `web/dist/` |
| `npm run preview` | Serves the production build at http://localhost:4173 |
| `npm run report -- <file.mmbak>` | Prints rebuilt balances and monthly totals in the terminal, for checking against the app |
| `npm run notices` | Regenerates `THIRD_PARTY_NOTICES.md` after dependency changes |

### Getting a backup file

In the Money Manager app, use its backup option to save a backup file (it ends in `.mmbak`), then copy it
to the device where you open Backup Analyser.

### Deploying

The production build is a static site. Run `npm run build` and upload **only the `web/dist` folder** to any
static host (Netlify, Cloudflare Pages, Vercel, GitHub Pages). HTTPS is required for offline use and
"Add to Home Screen".

More detail on the code layout and each page is in [web/README.md](web/README.md). Format notes and design
decisions are in [docs/ANALYTICS_PLAN.md](docs/ANALYTICS_PLAN.md).

## Legal

**Trademarks.** "Money Manager" is a product and trademark of its owner, Realbyte. The name is used here only
to describe which files this tool can read. This project uses no Realbyte logos, artwork, code or other
assets, and nothing in it suggests endorsement. The Apache License does not grant rights to any trademarks,
including the "Backup Analyser" name.

**Compatibility.** Backup Analyser reads backup files that users export themselves from their own app. The
backup is a standard, unencrypted SQLite database. No software was decompiled to build this tool, and no
encryption or other protection measure is bypassed. It only reads the file and never writes back to it or to
the app.

**Not financial advice.** The dashboards, forecasts, insights and health score summarise your own records.
They are not financial, investment, tax or legal advice. Figures are rebuilt from the backup and may differ
from what the Money Manager app shows; check anything important in the app itself.

**No warranty.** The software is provided "as is", without warranties or conditions of any kind, as set out in
the [LICENSE](LICENSE). You use it at your own risk.

**Your data.** You are responsible for the backup files you open and share. Never commit a real backup,
or screenshots of real financial data, to this repository. `*.mmbak` files are already excluded by
`.gitignore`. Use the built-in sample data for demos, screenshots and bug reports.

## Contributing

Issues and pull requests are welcome. Please:

- Reproduce problems with the sample data (`web/src/demo/generateBackup.ts`), never with a real backup.
- If a bug only shows with your own file, describe the structure (table, column, value types), not the contents.
- Run `npm test`, `npx tsc -b` and `npm run lint` in `web/` before opening a pull request.

By contributing, you agree that your contributions are licensed under the Apache License 2.0.

## Licence

Copyright 2026 Aashish Vibhu.

Licensed under the [Apache License, Version 2.0](LICENSE). See [NOTICE](NOTICE).

Bundled third-party libraries (React, sql.js, Apache ECharts, ZRender, tslib) keep their own licences, listed
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The same file ships with the app as
`third-party-notices.txt`.
