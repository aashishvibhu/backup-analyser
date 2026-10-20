import { useEffect, useMemo, useState } from 'react';
import { categoryMatrix, suggestOneOffCategories } from '../../core/analytics/categories';
import { listPeriods } from '../../core/analytics/periods';
import { DEFAULT_PREFS } from '../../core/ledger';
import { Badge, Card, Grid } from '../components/ui';
import { fmtDate } from '../format';
import { forgetBackup, loadBackup, type StoredBackup } from '../storage';
import { useApp } from '../store';
import { applyThemeChoice, storedThemeChoice, type ThemeChoice } from '../theme';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function Settings() {
  const { ledger, prefs, setPrefs, allTxns, o, fmt } = useApp();
  const [theme, setTheme] = useState<ThemeChoice>(storedThemeChoice);
  const [stored, setStored] = useState<Omit<StoredBackup, 'bytes'> | undefined>();
  useEffect(() => {
    loadBackup().then((b) => setStored(b && { name: b.name, savedAt: b.savedAt }));
  }, []);

  const expenseTops = useMemo(() => {
    const totals = new Map<string, number>();
    for (const t of ledger.txns) if (t.kind === 'expense' && t.topCategory) totals.set(t.topCategory.id, (totals.get(t.topCategory.id) ?? 0) + t.amountMain);
    return ledger.ds.categories
      .filter((c) => c.type === 'expense' && !c.parentId && totals.has(c.id))
      .map((c) => ({ ...c, total: totals.get(c.id)! }))
      .sort((a, b) => b.total - a.total);
  }, [ledger]);

  const suggested = useMemo(
    () => new Set(suggestOneOffCategories(categoryMatrix(allTxns, 'expense', listPeriods(ledger.first, ledger.anchor, 'month', o), o, 100))),
    [allTxns, ledger, o],
  );

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const appStart = ledger.ds.settings.monthStartDay;
  const meta = ledger.ds.meta;

  return (
    <Grid>
      <Card title="Periods">
        <div className="form">
          <label>
            Month starts on
            <select
              value={prefs.monthStartDay ?? 'app'}
              onChange={(e) => setPrefs({ monthStartDay: e.target.value === 'app' ? null : Number(e.target.value) })}
            >
              <option value="app">Same as the app (day {appStart})</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Day {d}
                  {d === 1 ? ' (calendar months)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            If your salary arrives at the end of the month, starting months on that day keeps each salary with the spending it pays for.
          </p>
          <label>
            Financial year starts in
            <select value={prefs.fyStartMonth} onChange={(e) => setPrefs({ fyStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                  {i === 3 ? ' (India)' : i === 0 ? ' (calendar year)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card title="Counting rules">
        <div className="form">
          <label className="check">
            <input type="checkbox" checked={prefs.includeCorrections} onChange={(e) => setPrefs({ includeCorrections: e.target.checked })} />
            Count balance corrections as income and spending
          </label>
          <p className="muted small">
            When you edit an account balance in the app it can record the difference as income or spending ("Difference"
            entries). Turn this off to see only what you recorded on purpose.
          </p>
          {ledger.ds.tags.length > 0 && (
            <>
              <strong className="small">Leave out transactions tagged</strong>
              {ledger.ds.tags.map((t) => (
                <label key={t.id} className="check">
                  <input
                    type="checkbox"
                    checked={prefs.excludedTagIds.includes(t.id)}
                    onChange={() => setPrefs({ excludedTagIds: toggle(prefs.excludedTagIds, t.id) })}
                  />
                  {t.name}
                </label>
              ))}
            </>
          )}
          <label>
            Theme
            <select
              value={theme}
              onChange={(e) => {
                const c = e.target.value as ThemeChoice;
                setTheme(c);
                applyThemeChoice(c);
              }}
            >
              <option value="system">Match device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </Card>

      <Card wide title="One-off categories" subtitle="Big, rare purchases (furniture, a car, a wedding) are kept out of 'core' spending, forecasts and stability scores.">
        <div className="check-grid">
          {expenseTops.map((c) => (
            <label key={c.id} className="check">
              <input
                type="checkbox"
                checked={prefs.oneOffCategoryIds.includes(c.id)}
                onChange={() => setPrefs({ oneOffCategoryIds: toggle(prefs.oneOffCategoryIds, c.id) })}
              />
              <span>
                {c.name} <span className="muted small">{fmt.compact(c.total)}</span>
              </span>
              {suggested.has(c.id) && <Badge kind="neutral">Suggested</Badge>}
            </label>
          ))}
        </div>
        {suggested.size > 0 && (
          <button
            className="btn"
            onClick={() => setPrefs({ oneOffCategoryIds: [...new Set([...prefs.oneOffCategoryIds, ...suggested])] })}
          >
            Mark all suggested
          </button>
        )}
      </Card>

      <Card wide title="Accounts to leave out" subtitle="Excluded accounts are dropped from every page (their spending, income and balances).">
        <div className="check-grid">
          {ledger.ds.accounts.map((a) => (
            <label key={a.id} className="check">
              <input
                type="checkbox"
                checked={prefs.excludedAccountIds.includes(a.id)}
                onChange={() => setPrefs({ excludedAccountIds: toggle(prefs.excludedAccountIds, a.id) })}
              />
              <span>
                {a.name} <span className="muted small">{ledger.groupById.get(a.groupId)?.name}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="This backup">
        <dl className="facts-list">
          <dt>File</dt>
          <dd>{meta.sourceName}</dd>
          <dt>Transactions</dt>
          <dd>
            {ledger.txns.length.toLocaleString('en-IN')} ({fmtDate(ledger.first)} – {fmtDate(ledger.anchor)})
          </dd>
          <dt>Accounts / categories</dt>
          <dd>
            {ledger.ds.accounts.length} / {ledger.ds.categories.filter((c) => !c.deleted).length}
          </dd>
          <dt>Main currency</dt>
          <dd>{meta.mainCurrency}</dd>
          <dt>Format version</dt>
          <dd>{meta.schemaVersion}</dd>
        </dl>
        {meta.warnings.map((w) => (
          <p key={w} className="notice">
            {w}
          </p>
        ))}
      </Card>

      <Card title="Privacy and storage">
        <p className="small">
          Your backup is read inside this browser. Nothing is uploaded: the app has no server, and it blocks network requests
          to other sites.
        </p>
        <p className="small">
          {stored
            ? `"${stored.name}" is saved on this device (since ${new Date(stored.savedAt).toLocaleDateString()}) so it opens automatically.`
            : 'No backup is saved on this device.'}
        </p>
        <div className="row-gap">
          {stored && (
            <button
              className="btn"
              onClick={async () => {
                await forgetBackup();
                setStored(undefined);
              }}
            >
              Remove saved backup
            </button>
          )}
          <button className="btn" onClick={() => setPrefs(DEFAULT_PREFS)}>
            Reset these settings
          </button>
        </div>
      </Card>
    </Grid>
  );
}
