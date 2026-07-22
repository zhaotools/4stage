import type { DailyBar } from "../src/data/weekly";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseYahooChart(payload: YahooChartResponse): DailyBar[] {
  const result = payload.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) {
    throw new Error(payload.chart?.error?.description ?? "Yahoo returned no chart data");
  }
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose;
  const bars: DailyBar[] = [];
  for (let index = 0; index < result.timestamp.length; index += 1) {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (!validPrice(open) || !validPrice(high) || !validPrice(low) || !validPrice(close)) continue;
    const adjustedClose = adjusted?.[index];
    const multiplier = validPrice(adjustedClose) ? adjustedClose / close : 1;
    const bar = {
      date: new Date(result.timestamp[index] * 1_000).toISOString().slice(0, 10),
      open: open * multiplier,
      high: high * multiplier,
      low: low * multiplier,
      close: close * multiplier,
      volume: typeof quote.volume?.[index] === "number" && Number.isFinite(quote.volume[index])
        ? quote.volume[index]
        : null,
    };
    if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) continue;
    bars.push(bar);
  }
  bars.sort((a, b) => a.date.localeCompare(b.date));
  return bars.filter((bar, index) => index === 0 || bar.date !== bars[index - 1].date);
}

function unixDate(value: string) {
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
  return Math.floor(new Date(iso).getTime() / 1_000);
}

export async function loadYahooDailyBars(symbol: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({
    period1: String(unixDate(startDate)),
    period2: String(unixDate(endDate) + 86_400),
    interval: "1d",
    events: "div,splits",
    includeAdjustedClose: "true",
  });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`,
        {
          headers: { "user-agent": "4stage/0.1" },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}: ${symbol}`);
      const bars = parseYahooChart(await response.json() as YahooChartResponse);
      if (bars.length === 0) throw new Error(`Yahoo returned no usable data for ${symbol}`);
      return bars;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`Yahoo request failed for ${symbol}`, { cause: lastError });
}
