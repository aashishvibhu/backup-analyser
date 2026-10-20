import { BarChart, HeatmapChart, LineChart, SankeyChart, TreemapChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { useChartTheme, type ChartTheme } from '../theme';

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  SankeyChart,
  TreemapChart,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

export type EChartsOption = echarts.EChartsCoreOption;

interface Props {
  option: (t: ChartTheme) => EChartsOption;
  height?: number;
  /** Accessible summary of what the chart shows. */
  label: string;
  onClick?: (params: { name: string; seriesName?: string; dataIndex: number; data: unknown }) => void;
}

/** ECharts wrapper: themed from CSS tokens, resizes with its container, SVG-rendered. */
export function Chart({ option, height = 300, label, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const theme = useChartTheme();
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const el = ref.current!;
    const instance = echarts.init(el, undefined, { renderer: 'svg' });
    chart.current = instance;
    instance.on('click', (p) => clickRef.current?.(p as never));
    const ro = new ResizeObserver(() => instance.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ ...baseOption(theme), ...option(theme) }, { notMerge: true });
  }, [option, theme]);

  return <div ref={ref} role="img" aria-label={label} className="chart" style={{ height, cursor: onClick ? 'pointer' : undefined }} />;
}

function baseOption(t: ChartTheme): EChartsOption {
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: t.font, color: t.textSecondary, fontSize: 12 },
    animationDuration: 300,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.grid,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
      confine: true,
    },
  };
}

// ---------------------------------------------------------------- shared option pieces

export function grid(extra: Record<string, unknown> = {}) {
  return { left: 8, right: 16, top: 36, bottom: 8, containLabel: true, ...extra };
}

export function categoryAxis(t: ChartTheme, data: string[], extra: Record<string, unknown> = {}) {
  return {
    type: 'category',
    data,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, hideOverlap: true },
    ...extra,
  };
}

export function valueAxis(t: ChartTheme, format: (n: number) => string, extra: Record<string, unknown> = {}) {
  return {
    type: 'value',
    axisLabel: { color: t.muted, formatter: format },
    splitLine: { lineStyle: { color: t.grid, type: 'solid', width: 1 } },
    axisLine: { show: false },
    ...extra,
  };
}

export function legend(t: ChartTheme, extra: Record<string, unknown> = {}) {
  return {
    top: 0,
    left: 0,
    icon: 'roundRect',
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { color: t.textSecondary },
    ...extra,
  };
}

/** Bars: thin, rounded data end, 2px gap between neighbours. */
export function barSeries(name: string, data: unknown[], color: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'bar',
    name,
    data,
    barMaxWidth: 18,
    barGap: '12%',
    itemStyle: { color, borderRadius: [4, 4, 0, 0] },
    emphasis: { focus: 'series' },
    ...extra,
  };
}

export function lineSeries(name: string, data: unknown[], color: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'line',
    name,
    data,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    symbol: 'circle',
    symbolSize: 8,
    showSymbol: false,
    emphasis: { focus: 'series' },
    ...extra,
  };
}

/** Tooltip formatter for axis tooltips listing each series with a money value. */
export function axisTooltip(format: (n: number) => string) {
  return {
    trigger: 'axis',
    axisPointer: { type: 'line' },
    valueFormatter: (v: unknown) => (typeof v === 'number' ? format(v) : '–'),
  };
}
