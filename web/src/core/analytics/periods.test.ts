import { describe, expect, it } from 'vitest';
import { elapsedFraction, listPeriods, monthlyPeriodOf, periodOf, previousRange, rangeForPreset } from './periods';

describe('monthlyPeriodOf', () => {
  it('uses calendar months when the start day is 1', () => {
    expect(monthlyPeriodOf('2026-02-14', 1)).toMatchObject({ key: '2026-02', start: '2026-02-01', end: '2026-02-28' });
  });

  it('assigns dates before the start day to the previous period', () => {
    expect(monthlyPeriodOf('2026-08-10', 25)).toMatchObject({ key: '2026-07', start: '2026-07-25', end: '2026-08-24' });
    expect(monthlyPeriodOf('2026-08-25', 25).key).toBe('2026-08');
  });

  it('clamps a start day past the month length', () => {
    expect(monthlyPeriodOf('2026-02-28', 30)).toMatchObject({ key: '2026-02', start: '2026-02-28', end: '2026-03-29' });
    expect(monthlyPeriodOf('2026-04-30', 30)).toMatchObject({ key: '2026-04', start: '2026-04-30', end: '2026-05-29' });
    expect(monthlyPeriodOf('2024-02-29', 30).start).toBe('2024-02-29');
  });

  it('wraps across the year boundary', () => {
    expect(monthlyPeriodOf('2026-01-05', 30)).toMatchObject({ key: '2025-12', start: '2025-12-30', end: '2026-01-29' });
  });
});

describe('periodOf', () => {
  const o = { monthStartDay: 1, weekStartsOn: 1, fyStartMonth: 4 };

  it('handles Indian financial years', () => {
    expect(periodOf('2026-03-31', 'fy', o)).toMatchObject({ label: 'FY 2025-26', start: '2025-04-01', end: '2026-03-31' });
    expect(periodOf('2026-04-01', 'fy', o).label).toBe('FY 2026-27');
  });

  it('starts weeks on the configured day', () => {
    expect(periodOf('2025-03-16', 'week', o)).toMatchObject({ start: '2025-03-10', end: '2025-03-16' }); // Sunday
    expect(periodOf('2025-03-16', 'week', { ...o, weekStartsOn: 0 }).start).toBe('2025-03-16');
  });

  it('lists quarters including empty ones', () => {
    expect(listPeriods('2025-11-15', '2026-04-02', 'quarter', o).map((p) => p.key)).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
  });
});

describe('rangeForPreset', () => {
  const o = { monthStartDay: 30, weekStartsOn: 1, fyStartMonth: 4 };

  it('resolves month presets with a custom start day', () => {
    expect(rangeForPreset('thisMonth', '2026-06-12', '2024-01-01', o)).toEqual({ from: '2026-05-30', to: '2026-06-29' });
    expect(rangeForPreset('last3', '2026-06-12', '2024-01-01', o)).toEqual({ from: '2026-03-30', to: '2026-06-29' });
  });

  it('gives the previous range of equal length', () => {
    expect(previousRange({ from: '2026-04-01', to: '2026-04-30' })).toEqual({ from: '2026-03-02', to: '2026-03-31' });
  });

  it('counts elapsed time within a period', () => {
    expect(elapsedFraction({ key: '', label: '', start: '2026-04-01', end: '2026-04-30' }, '2026-04-15')).toBeCloseTo(0.5);
  });
});
