import { useMemo, useState, type ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  table,
  children,
  wide,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A table twin of the chart; the card gets a Chart/Table switch. */
  table?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`card ${wide ? 'wide' : ''}`}>
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <div className="card-actions">
          {actions}
          {table && (
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={!showTable} onClick={() => setShowTable(false)}>
                Chart
              </button>
              <button aria-pressed={showTable} onClick={() => setShowTable(true)}>
                Table
              </button>
            </div>
          )}
        </div>
      </header>
      {showTable && table ? <div className="scroll">{table}</div> : children}
    </section>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid">{children}</div>;
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>;
}

export function Tile({
  label,
  value,
  sub,
  delta,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** e.g. "+12% vs previous" */
  delta?: { text: string; good: boolean | null };
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <strong className={`tile-value ${tone ?? ''}`}>{value}</strong>
      {delta && (
        <span className={`delta ${delta.good === null ? '' : delta.good ? 'good' : 'bad'}`}>
          {delta.text}
        </span>
      )}
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

export type StatusKind = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

const STATUS_ICON: Record<StatusKind, string> = { good: '✓', warning: '!', serious: '!', critical: '✕', neutral: '•' };

/** Status always carries an icon and a label, never colour alone. */
export function Badge({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return (
    <span className={`badge ${kind}`}>
      <span aria-hidden="true">{STATUS_ICON[kind]}</span> {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => number | string;
  num?: boolean;
}

/** Sortable table. */
export function DataTable<T>({
  rows,
  columns,
  initialSort,
  rowKey,
  limit,
  onRowClick,
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  initialSort?: { key: string; desc: boolean };
  rowKey: (row: T, i: number) => string;
  limit?: number;
  onRowClick?: (row: T) => void;
  footer?: ReactNode;
}) {
  const [sort, setSort] = useState(initialSort);
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, columns, sort]);
  const shown = limit && !expanded ? sorted.slice(0, limit) : sorted;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''} aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                {c.sort ? (
                  <button
                    className="th-btn"
                    onClick={() => setSort((s) => ({ key: c.key, desc: s?.key === c.key ? !s.desc : c.num ?? false }))}
                  >
                    {c.label}
                    {sort?.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? 'clickable' : ''}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
      {limit && sorted.length > limit && (
        <button className="link-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

export function Meter({ value, max, marker, kind = 'neutral' }: { value: number; max: number; marker?: number; kind?: StatusKind }) {
  const w = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const m = marker !== undefined && max > 0 ? Math.min(100, (marker / max) * 100) : undefined;
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={Math.round(max)}>
      <div className={`meter-fill ${kind}`} style={{ width: `${w}%` }} />
      {m !== undefined && <div className="meter-marker" style={{ left: `${m}%` }} />}
    </div>
  );
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
