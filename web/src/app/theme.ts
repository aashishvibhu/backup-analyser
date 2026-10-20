import { useEffect, useState } from 'react';
import { readJson, writeJson } from './storage';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface ChartTheme {
  surface: string;
  text: string;
  textSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
  other: string;
  seq: string[];
  diverging: [string, string, string];
  status: { good: string; warning: string; serious: string; critical: string };
  font: string;
}

function readTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface-1'),
    text: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    muted: v('--muted'),
    grid: v('--grid'),
    axis: v('--axis'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--series-${i}`)),
    other: v('--series-other'),
    seq: ['--seq-100', '--seq-250', '--seq-400', '--seq-550', '--seq-700'].map(v),
    diverging: [v('--div-neg'), v('--div-mid'), v('--div-pos')],
    status: {
      good: v('--status-good'),
      warning: v('--status-warning'),
      serious: v('--status-serious'),
      critical: v('--status-critical'),
    },
    font: cs.fontFamily,
  };
}

const EVENT = 'app-theme-change';

export function applyThemeChoice(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  writeJson('theme', { choice });
  window.dispatchEvent(new Event(EVENT));
}

export function storedThemeChoice(): ThemeChoice {
  return readJson<{ choice: ThemeChoice }>('theme', { choice: 'system' }).choice;
}

/** Live chart tokens; re-reads when the OS scheme or the in-app theme changes. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    window.addEventListener(EVENT, update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return theme;
}

/** Colour for a category slot from the store (0 = "other"). */
export function slotColor(t: ChartTheme, slot: number): string {
  return slot >= 1 && slot <= 8 ? t.series[slot - 1] : t.other;
}
