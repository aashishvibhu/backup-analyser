import type { IsoDate } from '../model';

export type Granularity = 'week' | 'month' | 'quarter' | 'year' | 'fy';

export interface Period {
  /** Sortable key, unique per granularity (e.g. 2026-07, 2026-W, 2026-Q3, FY2026). */
  key: string;
  /** Short human label. */
  label: string;
  start: IsoDate;
  /** Inclusive. */
  end: IsoDate;
}

export interface PeriodOptions {
  /** Day of month a "month" starts on (1–31, clamped to month length). */
  monthStartDay: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekStartsOn: number;
  /** Financial year start month, 1–12 (India: 4). */
  fyStartMonth: number;
}

export const DEFAULT_PERIOD_OPTIONS: PeriodOptions = { monthStartDay: 1, weekStartsOn: 1, fyStartMonth: 4 };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------- date helpers

export function parseIso(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const d = parseIso(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000);
}

/** 0 = Sunday. */
export function dayOfWeek(date: IsoDate): number {
  return parseIso(date).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function clampedDay(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const idx = year * 12 + (month - 1) + delta;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

// ---------------------------------------------------------------- periods

/**
 * Monthly period containing `date` when months start on `startDay`.
 * A start day past the month's length is clamped (start day 30 → 28/29 Feb).
 * The period is keyed and labelled by the month it starts in.
 */
export function monthlyPeriodOf(date: IsoDate, startDay: number): Period {
  const [y, m, d] = date.split('-').map(Number);
  const [year, month] = d < clampedDay(y, m, startDay) ? shiftMonth(y, m, -1) : [y, m];
  return monthlyPeriod(year, month, startDay);
}

export function monthlyPeriod(year: number, month: number, startDay: number): Period {
  const start = iso(year, month, clampedDay(year, month, startDay));
  const [ny, nm] = shiftMonth(year, month, 1);
  const end = addDays(iso(ny, nm, clampedDay(ny, nm, startDay)), -1);
  return { key: `${year}-${pad(month)}`, label: `${MONTHS[month - 1]} ${year}`, start, end };
}

export function periodOf(date: IsoDate, g: Granularity, o: PeriodOptions): Period {
  const [y, m] = date.split('-').map(Number);
  switch (g) {
    case 'month':
      return monthlyPeriodOf(date, o.monthStartDay);
    case 'week': {
      const start = addDays(date, -((dayOfWeek(date) - o.weekStartsOn + 7) % 7));
      const [, sm, sd] = start.split('-').map(Number);
      return { key: start, label: `${sd} ${MONTHS[sm - 1]}`, start, end: addDays(start, 6) };
    }
    case 'quarter': {
      const q = Math.floor((m - 1) / 3);
      const sm = q * 3 + 1;
      return {
        key: `${y}-Q${q + 1}`,
        label: `Q${q + 1} ${y}`,
        start: iso(y, sm, 1),
        end: iso(y, sm + 2, daysInMonth(y, sm + 2)),
      };
    }
    case 'year':
      return { key: String(y), label: String(y), start: iso(y, 1, 1), end: iso(y, 12, 31) };
    case 'fy': {
      const fyStartYear = m >= o.fyStartMonth ? y : y - 1;
      const [ey, em] = shiftMonth(fyStartYear, o.fyStartMonth, 11);
      const label =
        o.fyStartMonth === 1 ? `FY ${fyStartYear}` : `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;
      return {
        key: `FY${fyStartYear}`,
        label,
        start: iso(fyStartYear, o.fyStartMonth, 1),
        end: iso(ey, em, daysInMonth(ey, em)),
      };
    }
  }
}

/** Every period that overlaps [from, to], in order, including empty ones. */
export function listPeriods(from: IsoDate, to: IsoDate, g: Granularity, o: PeriodOptions): Period[] {
  const out: Period[] = [];
  let cursor = from;
  while (cursor <= to) {
    const p = periodOf(cursor, g, o);
    out.push(p);
    cursor = addDays(p.end, 1);
  }
  return out;
}

/** Fraction of `p` that has elapsed by `asOf` (0–1). */
export function elapsedFraction(p: Period, asOf: IsoDate): number {
  if (asOf < p.start) return 0;
  if (asOf >= p.end) return 1;
  return (daysBetween(p.start, asOf) + 1) / (daysBetween(p.start, p.end) + 1);
}

// ---------------------------------------------------------------- range presets

export type RangePreset =
  | 'thisMonth'
  | 'lastMonth'
  | 'last3'
  | 'last6'
  | 'last12'
  | 'thisFy'
  | 'lastFy'
  | 'thisYear'
  | 'all'
  | 'custom';

export const RANGE_PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'last3', label: 'Last 3 months' },
  { id: 'last6', label: 'Last 6 months' },
  { id: 'last12', label: 'Last 12 months' },
  { id: 'thisFy', label: 'This FY' },
  { id: 'lastFy', label: 'Last FY' },
  { id: 'thisYear', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

/** Resolves a preset relative to `anchor` (the latest date in the data). Months honour the start day. */
export function rangeForPreset(preset: RangePreset, anchor: IsoDate, first: IsoDate, o: PeriodOptions): DateRange {
  const month = periodOf(anchor, 'month', o);
  const monthsBack = (n: number): DateRange => {
    let p = month;
    for (let i = 1; i < n; i++) p = periodOf(addDays(p.start, -1), 'month', o);
    return { from: p.start, to: month.end };
  };
  switch (preset) {
    case 'thisMonth':
      return { from: month.start, to: month.end };
    case 'lastMonth': {
      const p = periodOf(addDays(month.start, -1), 'month', o);
      return { from: p.start, to: p.end };
    }
    case 'last3':
      return monthsBack(3);
    case 'last6':
      return monthsBack(6);
    case 'last12':
      return monthsBack(12);
    case 'thisFy': {
      const p = periodOf(anchor, 'fy', o);
      return { from: p.start, to: p.end };
    }
    case 'lastFy': {
      const p = periodOf(addDays(periodOf(anchor, 'fy', o).start, -1), 'fy', o);
      return { from: p.start, to: p.end };
    }
    case 'thisYear': {
      const p = periodOf(anchor, 'year', o);
      return { from: p.start, to: p.end };
    }
    case 'all':
    case 'custom':
      return { from: first, to: anchor };
  }
}

/** The range of the same length immediately before `r`. */
export function previousRange(r: DateRange): DateRange {
  const len = daysBetween(r.from, r.to);
  const to = addDays(r.from, -1);
  return { from: addDays(to, -len), to };
}
