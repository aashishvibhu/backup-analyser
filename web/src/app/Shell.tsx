import { useState, type ComponentType } from 'react';
import { RANGE_PRESETS, type RangePreset } from '../core/analytics/periods';
import { fmtRange } from './format';
import { href, useRoute } from './router';
import { useApp } from './store';
import { Accounts } from './pages/Accounts';
import { Budgets } from './pages/Budgets';
import { Cards } from './pages/Cards';
import { CashFlow } from './pages/CashFlow';
import { Categories } from './pages/Categories';
import { Flow } from './pages/Flow';
import { Forecast } from './pages/Forecast';
import { Habits } from './pages/Habits';
import { Health } from './pages/Health';
import { Investments } from './pages/Investments';
import { Overview } from './pages/Overview';
import { Recurring } from './pages/Recurring';
import { Settings } from './pages/Settings';
import { Transactions } from './pages/Transactions';

const PAGES: { id: string; label: string; component: ComponentType; usesRange: boolean }[] = [
  { id: 'overview', label: 'Overview', component: Overview, usesRange: true },
  { id: 'cashflow', label: 'Cash flow', component: CashFlow, usesRange: true },
  { id: 'categories', label: 'Categories', component: Categories, usesRange: true },
  { id: 'accounts', label: 'Accounts & net worth', component: Accounts, usesRange: true },
  { id: 'cards', label: 'Credit cards', component: Cards, usesRange: true },
  { id: 'investments', label: 'Investments & loans', component: Investments, usesRange: true },
  { id: 'flow', label: 'Money flow', component: Flow, usesRange: true },
  { id: 'habits', label: 'Spending habits', component: Habits, usesRange: true },
  { id: 'recurring', label: 'Subscriptions & bills', component: Recurring, usesRange: false },
  { id: 'budgets', label: 'Budgets', component: Budgets, usesRange: false },
  { id: 'forecast', label: 'Forecast & alerts', component: Forecast, usesRange: true },
  { id: 'health', label: 'Financial health', component: Health, usesRange: false },
  { id: 'transactions', label: 'Transactions', component: Transactions, usesRange: true },
  { id: 'settings', label: 'Settings', component: Settings, usesRange: false },
];

export function Shell() {
  const { ledger, close } = useApp();
  const { page, params } = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const Page = current.component;

  return (
    <div className="shell">
      <aside className={`nav ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◔
          </span>
          Backup Analyser
        </div>
        <nav aria-label="Sections">
          {PAGES.map((p) => (
            <a key={p.id} href={href(p.id)} aria-current={p.id === current.id ? 'page' : undefined} onClick={() => setNavOpen(false)}>
              {p.label}
            </a>
          ))}
        </nav>
        <div className="nav-foot">
          <span className="muted small" title={ledger.ds.meta.sourceName}>
            {ledger.ds.meta.sourceName}
          </span>
          <button className="link-btn" onClick={close}>
            Open another backup
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
            ☰
          </button>
          <h1>{current.label}</h1>
          {current.usesRange && <RangeBar />}
        </header>
        <main className="content" key={`${current.id}?${params.toString()}`}>
          <Page />
        </main>
        <footer className="foot muted small">
          Processed on this device only. Not affiliated with the makers of Money Manager. Not financial advice.{' '}
          <a href="./third-party-notices.txt" target="_blank" rel="noopener">
            Licences
          </a>
        </footer>
      </div>
    </div>
  );
}

function RangeBar() {
  const { preset, setPreset, range, setCustomRange, ledger } = useApp();
  return (
    <div className="rangebar">
      <select aria-label="Date range" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
        {RANGE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {preset === 'custom' ? (
        <span className="custom-range">
          <input
            type="date"
            aria-label="From"
            value={range.from}
            min={ledger.first}
            max={range.to}
            onChange={(e) => e.target.value && setCustomRange({ from: e.target.value, to: range.to })}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="To"
            value={range.to}
            min={range.from}
            onChange={(e) => e.target.value && setCustomRange({ from: range.from, to: e.target.value })}
          />
        </span>
      ) : (
        <span className="muted small">{fmtRange(range.from, range.to)}</span>
      )}
    </div>
  );
}
