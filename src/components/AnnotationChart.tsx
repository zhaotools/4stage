import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, LineSeries, createChart, type Time } from "lightweight-charts";
import type { WeeklyBar } from "../domain/types";

function movingAverage(bars: WeeklyBar[], period: number) {
  return bars.flatMap((bar, index) => {
    if (index < period - 1) return [];
    const values = bars.slice(index - period + 1, index + 1);
    return [{ time: bar.date as Time, value: values.reduce((sum, item) => sum + item.close, 0) / period }];
  });
}

export function AnnotationChart({ bars, height = 390 }: { bars: WeeklyBar[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      height,
      layout: { background: { type: ColorType.Solid, color: "#fffdf6" }, textColor: "#66736d" },
      grid: { vertLines: { color: "#ecebe4" }, horzLines: { color: "#e6e6df" } },
      rightPriceScale: { borderColor: "#cbd0ca" },
      timeScale: { borderColor: "#cbd0ca", timeVisible: false, rightOffset: 2 },
      crosshair: {
        vertLine: { color: "#65736d", width: 1, labelBackgroundColor: "#263c34" },
        horzLine: { color: "#65736d", width: 1, labelBackgroundColor: "#263c34" },
      },
      handleScale: false,
      handleScroll: false,
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#d5484f", downColor: "#15965e",
      borderUpColor: "#b83840", borderDownColor: "#11794c",
      wickUpColor: "#b83840", wickDownColor: "#11794c",
      priceLineVisible: true,
    });
    candles.setData(bars.map((bar) => ({
      time: bar.date as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })));
    const average = chart.addSeries(LineSeries, {
      color: "#7a817e", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: "MA30",
    });
    average.setData(movingAverage(bars, 30));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, height]);

  return <div className="annotation-chart" style={{ height }} ref={containerRef} />;
}
