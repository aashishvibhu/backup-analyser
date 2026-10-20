import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react';
import './App.css';
import { Shell } from './app/Shell';
import { loadBackup, saveBackup, type StoredBackup } from './app/storage';
import { AppProvider } from './app/store';
import { buildLedger } from './core/ledger';
import type { Dataset } from './core/model';
import { parseMmbak } from './core/parser/mmbak';
import { loadSqlJs } from './core/sqlite';

const FEATURES = [
  ['Cash flow', 'Income, spending and savings rate by week, month, quarter or financial year, using your own month start day.'],
  ['Categories', 'Treemap, heat map, trends, fixed vs. occasional spend, and what changed since last period.'],
  ['Net worth', 'Every account balance rebuilt from history, with assets, debts and net worth over time.'],
  ['Credit cards', 'Statement cycles, what was owed, and whether each bill was paid in full by the due date.'],
  ['Subscriptions', 'Recurring payments found automatically, with price increases and upcoming charges.'],
  ['Forecasts & alerts', 'Next month’s likely spending, unusual expenses and category spikes.'],
  ['Habits', 'Weekday and time-of-day patterns, no-spend days, and your top places and payees.'],
  ['Health score', 'A transparent score built from savings, buffer, debt, card discipline and more.'],
];

export default function App() {
  const [dataset, setDataset] = useState<Dataset>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<StoredBackup>();

  const open = useCallback(async (bytes: Uint8Array, name: string, persist: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const SQL = await loadSqlJs();
      const ds = parseMmbak(SQL, bytes, name);
      if (!ds.transactions.length) throw new Error('This backup has no transactions yet.');
      if (persist) await saveBackup({ name, savedAt: Date.now(), bytes });
      setDataset(ds);
      if (!window.location.hash) window.location.hash = '#/overview';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Installed app opened with a .mmbak file (PWA file handler).
  useEffect(() => {
    const queue = (window as { launchQueue?: { setConsumer: (fn: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void } }).launchQueue;
    queue?.setConsumer(async (p) => {
      const file = await p.files[0]?.getFile();
      if (file) void open(new Uint8Array(await file.arrayBuffer()), file.name, false);
    });
  }, [open]);

  useEffect(() => {
    loadBackup().then((b) => {
      if (b) {
        setSaved(b);
        setRemember(true);
      }
    });
  }, []);

  const openFile = async (file: File) => open(new Uint8Array(await file.arrayBuffer()), file.name, remember);
  const openDemo = async () => {
    setBusy(true);
    const [{ generateDemoBackup }, SQL] = await Promise.all([import('./demo/generateBackup'), loadSqlJs()]);
    await open(generateDemoBackup(SQL), 'Sample data.mmbak', false);
  };

  const ledger = useMemo(() => (dataset ? buildLedger(dataset) : undefined), [dataset]);
  const close = useCallback(() => {
    setDataset(undefined);
    window.location.hash = '';
  }, []);

  if (ledger) {
    return (
      <AppProvider ledger={ledger} onClose={close}>
        <Shell />
      </AppProvider>
    );
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void openFile(file);
  };

  return (
    <div className="landing">
      <header>
        <span className="logo big" aria-hidden="true">
          ◔
        </span>
        <h1>Backup Analyser</h1>
        <p className="lead">Deeper insights from your Money Manager backup — privately, in your browser.</p>
      </header>

      <label
        className={`drop ${dragging ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input type="file" accept=".mmbak,application/octet-stream" onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])} disabled={busy} />
        <strong>{busy ? 'Reading your backup…' : 'Drop your .mmbak backup here'}</strong>
        <span className="muted small">or click to choose a file</span>
      </label>

      <div className="landing-actions">
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep it on this device so it opens automatically next time
        </label>
        {saved && (
          <button className="btn primary" disabled={busy} onClick={() => open(saved.bytes, saved.name, false)}>
            Reopen {saved.name}
          </button>
        )}
        <button className="btn" disabled={busy} onClick={openDemo}>
          Try with sample data
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="how">
        <h2>Getting your backup</h2>
        <p>
          In the Money Manager app, use its backup option to save a backup file (it ends in <code>.mmbak</code>), then copy
          that file to this device. Automatic backups work too.
        </p>
        <h2>Private by design</h2>
        <ul>
          <li>The file is opened inside this browser tab. There is no server and no account.</li>
          <li>The page blocks connections to other sites, so your data cannot be sent anywhere.</li>
          <li>Nothing is kept after you close the tab unless you choose to keep it on this device.</li>
        </ul>
      </section>

      <section className="features">
        {FEATURES.map(([title, text]) => (
          <div key={title} className="feature">
            <strong>{title}</strong>
            <p className="muted small">{text}</p>
          </div>
        ))}
      </section>
      <footer className="muted small">
        Independent tool, not affiliated with or endorsed by Realbyte or the makers of Money Manager. Not financial advice.{' '}
        <a href="./third-party-notices.txt" target="_blank" rel="noopener">
          Licences
        </a>
      </footer>
    </div>
  );
}
