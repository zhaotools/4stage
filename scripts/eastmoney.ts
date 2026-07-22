import { setDefaultResultOrder } from "node:dns";
import type { DailyBar } from "../src/data/weekly";

const API_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const LIST_API_URL = "https://push2.eastmoney.com/api/qt/clist/get";
setDefaultResultOrder("ipv4first");

interface EastmoneyResponse {
  rc: number;
  data: null | {
    code: string;
    market: number;
    name: string;
    klines: string[];
  };
}

interface EastmoneyListResponse {
  rc: number;
  data: null | {
    total: number;
    diff: Array<{ f12: string; f13: number; f14: string }>;
  };
}

export interface EastmoneyConstituent {
  symbol: string;
  name: string;
  exchange: "SSE" | "SZSE";
}

function marketId(symbol: string) {
  if (symbol.endsWith(".SH")) return "1";
  if (symbol.endsWith(".SZ")) return "0";
  throw new Error(`Unsupported Eastmoney symbol: ${symbol}`);
}

function finiteNumber(value: string, field: string, date: string) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid ${field} on ${date}`);
  return result;
}

export function parseEastmoneyKlines(klines: string[]): DailyBar[] {
  const bars = klines.map((line) => {
    const [date, openText, closeText, highText, lowText, volumeText] = line.split(",");
    if (!date || !volumeText) throw new Error(`Malformed Eastmoney kline: ${line}`);
    const open = finiteNumber(openText, "open", date);
    const close = finiteNumber(closeText, "close", date);
    const high = finiteNumber(highText, "high", date);
    const low = finiteNumber(lowText, "low", date);
    const volume = finiteNumber(volumeText, "volume", date);
    if (low > Math.min(open, close) || high < Math.max(open, close) || low > high) {
      throw new Error(`Invalid OHLC relationship on ${date}`);
    }
    return { date, open, high, low, close, volume };
  });

  bars.sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index - 1].date === bars[index].date) {
      throw new Error(`Duplicate Eastmoney kline date: ${bars[index].date}`);
    }
  }
  return bars;
}

export async function loadEastmoneyDailyBars(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<DailyBar[]> {
  const code = symbol.slice(0, 6);
  const params = new URLSearchParams({
    secid: `${marketId(symbol)}.${code}`,
    klt: "101",
    fqt: "1",
    beg: startDate,
    end: endDate,
    lmt: "10000",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56",
  });
  let response: Response | null = null;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(`${API_URL}?${params}`, {
        headers: { "user-agent": "a-share-stage-analysis/0.1" },
        signal: AbortSignal.timeout(30_000),
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  if (!response) throw new Error(`Eastmoney request failed for ${symbol}`, { cause: lastError });
  if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}: ${symbol}`);

  const payload = (await response.json()) as EastmoneyResponse;
  if (payload.rc !== 0 || !payload.data || payload.data.klines.length === 0) {
    throw new Error(`Eastmoney returned no data for ${symbol}`);
  }
  const bars = parseEastmoneyKlines(payload.data.klines);
  if (bars.length < 260) throw new Error(`Insufficient daily history for ${symbol}: ${bars.length}`);
  return bars;
}

export async function loadEastmoneyBoardConstituents(
  boardCode: string,
): Promise<EastmoneyConstituent[]> {
  const pageSize = 100;
  const result: EastmoneyConstituent[] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let page = 1; result.length < total; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(pageSize),
      po: "1",
      np: "1",
      fltt: "2",
      invt: "2",
      fid: "f3",
      fs: `b:${boardCode}`,
      fields: "f12,f14,f13",
    });
    const response = await fetch(`${LIST_API_URL}?${params}`, {
      headers: { "user-agent": "a-share-stage-analysis/0.1" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Eastmoney list HTTP ${response.status}: ${boardCode}`);
    const payload = (await response.json()) as EastmoneyListResponse;
    if (payload.rc !== 0 || !payload.data) {
      throw new Error(`Eastmoney returned no constituents for ${boardCode}`);
    }
    total = payload.data.total;
    result.push(...payload.data.diff.map((item) => ({
      symbol: `${item.f12}.${item.f13 === 1 ? "SH" : "SZ"}`,
      name: item.f14,
      exchange: item.f13 === 1 ? "SSE" as const : "SZSE" as const,
    })));
    if (payload.data.diff.length === 0) break;
  }
  if (result.length !== total) {
    throw new Error(`Incomplete Eastmoney constituent list for ${boardCode}: ${result.length}/${total}`);
  }
  return result;
}
