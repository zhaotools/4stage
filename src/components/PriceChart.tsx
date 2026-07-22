import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  createChart,
  type Time,
} from "lightweight-charts";
import type { StagePoint, WeeklyBar } from "../domain/types";
import { stageMeta } from "../lib/stageMeta";

interface PriceChartProps {
  bars: WeeklyBar[];
  stages: StagePoint[];
}

interface StageSegment {
  start: number;
  end: number;
  state: StagePoint["state"];
}

const VISIBLE_WEEKS = 96;

function movingAverage(bars: WeeklyBar[], period: number) {
  return bars.flatMap((bar, index) => {
    if (index < period - 1) return [];
    const window = bars.slice(index - period + 1, index + 1);
    return [{
      time: bar.date as Time,
      value: window.reduce((sum, item) => sum + item.close, 0) / period,
    }];
  });
}

export function PriceChart({ bars, stages }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleBars = bars.slice(-VISIBLE_WEEKS);
  const visibleStages = stages.slice(-VISIBLE_WEEKS);

  const segments = useMemo(
    () => visibleStages.reduce<StageSegment[]>((result, point, index) => {
      const previous = result.at(-1);
      if (previous && previous.state === point.state) previous.end = index;
      else result.push({ start: index, end: index, state: point.state });
      return result;
    }, []),
    [visibleStages],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 520,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
        textColor: "#52615b",
        fontFamily: '"DM Sans", "Noto Sans SC", sans-serif',
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(50, 67, 60, 0.10)" },
        horzLines: { color: "rgba(50, 67, 60, 0.13)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#65736d", width: 1, labelBackgroundColor: "#263c34" },
        horzLine: { color: "#65736d", width: 1, labelBackgroundColor: "#263c34" },
      },
      rightPriceScale: {
        borderColor: "#b8c0ba",
        scaleMargins: { top: 0.11, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#b8c0ba",
        timeVisible: false,
        rightOffset: 3,
        barSpacing: 10,
        minBarSpacing: 5,
        fixLeftEdge: true,
      },
      handleScale: true,
      handleScroll: true,
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#d83f43",
      downColor: "#11855e",
      borderUpColor: "#a91f2b",
      borderDownColor: "#087047",
      wickUpColor: "#a91f2b",
      wickDownColor: "#087047",
      borderVisible: true,
      priceLineVisible: true,
      lastValueVisible: true,
    });
    candles.setData(visibleBars.map((bar) => ({
      time: bar.date as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })));

    const average = chart.addSeries(LineSeries, {
      color: "#7a817e",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: "MA30",
    });
    average.setData(movingAverage(bars, 30).slice(-VISIBLE_WEEKS));
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [bars, visibleBars]);

  return (
    <div className="financial-chart-shell">
      <div className="stage-timeline" aria-label="历史阶段时间轴">
        {segments.map((segment) => {
          const meta = stageMeta[segment.state];
          const weeks = segment.end - segment.start + 1;
          return (
            <div
              key={`${segment.start}-${segment.state}`}
              className="stage-timeline-segment"
              style={{
                "--zone-color": meta.color,
                flexGrow: weeks,
                flexBasis: 0,
              } as React.CSSProperties}
            >
              <strong>{meta.short}</strong>
              {weeks >= 7 && <span>{meta.title}</span>}
            </div>
          );
        })}
      </div>

      <div className="professional-chart-wrap">
        <div className="stage-zone-layer" aria-hidden="true">
          {segments.map((segment) => {
            const meta = stageMeta[segment.state];
            return (
              <div
                key={`${segment.start}-${segment.state}`}
                className="stage-zone"
                style={{
                  "--zone-color": meta.color,
                  flexGrow: segment.end - segment.start + 1,
                  flexBasis: 0,
                } as React.CSSProperties}
              />
            );
          })}
        </div>
        <div ref={containerRef} className="trading-chart" />
      </div>

      <div className="chart-legend professional-legend">
        <span><i className="legend-up" />上涨周K线</span>
        <span><i className="legend-down" />下跌周K线</span>
        <span><i className="legend-average" />30周均线</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView</a>
      </div>
    </div>
  );
}
