import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(ROOT, "data");
const CACHE_DIR = process.env.CACHE_DIR || join(ROOT, "data");
const SCOPE = process.env.DATA_SCOPE || "full";
const baseUniverse = JSON.parse(await readFile(join(ROOT, "config", "universe.json"), "utf8"));
const etfUniverse = JSON.parse(await readFile(join(ROOT, "config", "etf-universe.json"), "utf8"));
const configuredEtfs = Object.entries(etfUniverse).flatMap(([group, entries]) => entries.map((asset, sortOrder) => ({
  ...asset,
  group,
  sortOrder,
  providerSymbol: asset.symbol,
  provider: group === "a_etf" ? "eastmoney" : "yahoo",
  exchange: group === "a_etf"
    ? (asset.symbol.endsWith(".SH") ? "SSE" : "SZSE")
    : "NYSEARCA",
  assetType: "etf",
})));
const configuredUniverse = [
  ...baseUniverse.filter((asset) => asset.group !== "a_etf" && asset.group !== "us_etf"),
  ...configuredEtfs,
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(bars, index, period) {
  if (index < period - 1) return null;
  return average(bars.slice(index - period + 1, index + 1).map((bar) => bar.close));
}

function rangePosition(bars, index, lookback) {
  const slice = bars.slice(Math.max(0, index - lookback + 1), index + 1);
  const high = Math.max(...slice.map((bar) => bar.high));
  const low = Math.min(...slice.map((bar) => bar.low));
  return high === low ? 0.5 : (bars[index].close - low) / (high - low);
}

function volumeRatio(bars, index) {
  if (index < 10) return 1;
  const current = average(bars.slice(index - 3, index + 1).map((bar) => bar.volume));
  const baseline = average(bars.slice(index - 10, index - 3).map((bar) => bar.volume));
  return baseline > 0 ? current / baseline : 1;
}

function chooseStage(bar, ma10, ma30, slope, position, volume, previous) {
  const distance = bar.close / ma30 - 1;
  const fastDistance = ma10 / ma30 - 1;
  const score = { 1: 0, 2: 0, 3: 0, 4: 0 };

  score[2] += distance > 0.02 ? 3 : distance > 0 ? 1 : 0;
  score[2] += slope > 0.008 ? 3 : slope > 0.002 ? 2 : 0;
  score[2] += fastDistance > 0.01 ? 2 : fastDistance > 0 ? 1 : 0;
  score[2] += position > 0.72 ? 2 : position > 0.55 ? 1 : 0;
  score[2] += volume > 1.15 && distance > 0 ? 1 : 0;

  score[4] += distance < -0.02 ? 3 : distance < 0 ? 1 : 0;
  score[4] += slope < -0.008 ? 3 : slope < -0.002 ? 2 : 0;
  score[4] += fastDistance < -0.01 ? 2 : fastDistance < 0 ? 1 : 0;
  score[4] += position < 0.28 ? 2 : position < 0.45 ? 1 : 0;
  score[4] += volume > 1.15 && distance < 0 ? 1 : 0;

  const flat = Math.abs(slope);
  score[1] += flat < 0.006 ? 3 : flat < 0.012 ? 1 : 0;
  score[1] += Math.abs(distance) < 0.06 ? 2 : 0;
  score[1] += position < 0.58 ? 2 : 0;
  score[1] += previous === 4 || previous === 1 ? 2 : 0;

  score[3] += flat < 0.008 ? 3 : flat < 0.015 ? 1 : 0;
  score[3] += Math.abs(distance) < 0.08 ? 2 : 0;
  score[3] += position > 0.48 ? 2 : 0;
  score[3] += previous === 2 || previous === 3 ? 2 : 0;

  const ranked = Object.entries(score)
    .map(([stage, value]) => ({ stage: Number(stage), value }))
    .sort((a, b) => b.value - a.value);
  if (previous && ranked[0].stage !== previous && score[previous] >= ranked[0].value - 1) return previous;
  return ranked[0].stage;
}

function analyze(inputBars) {
  const source = inputBars
    .map((bar) => ({
      time: String(bar.time || bar.date).slice(0, 10),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume || 0),
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))
    .sort((a, b) => a.time.localeCompare(b.time));

  let previous = null;
  const bars = source.map((bar, index) => {
    const ma10 = sma(source, index, 10);
    const ma30 = sma(source, index, 30);
    const oldMa30 = index >= 34 ? sma(source, index - 5, 30) : null;
    if (ma10 === null || ma30 === null || oldMa30 === null) {
      return { ...bar, ma30, slope: null, stage: null };
    }
    const slope = ma30 / oldMa30 - 1;
    const stage = chooseStage(
      bar,
      ma10,
      ma30,
      slope,
      rangePosition(source, index, 52),
      volumeRatio(source, index),
      previous,
    );
    previous = stage;
    return { ...bar, ma30, slope, stage };
  });

  const latest = bars.at(-1);
  if (!latest?.stage || !latest.ma30) throw new Error("至少需要35根完整周线");
  const distance = latest.close / latest.ma30 - 1;
  const position = rangePosition(source, source.length - 1, 52);
  const fit = latest.stage === 2
    ? Math.max(0, latest.slope) + Math.max(0, distance)
    : latest.stage === 4
      ? Math.max(0, -latest.slope) + Math.max(0, -distance)
      : Math.max(0, 0.025 - Math.abs(latest.slope)) + Math.max(0, 0.08 - Math.abs(distance));
  const confidence = Math.round(Math.max(55, Math.min(94, 61 + fit * 220 + Math.abs(position - 0.5) * 12)));
  return {
    bars,
    current: {
      stage: latest.stage,
      close: latest.close,
      ma30: latest.ma30,
      slope: latest.slope,
      distance,
      confidence,
      asOf: latest.time,
    },
  };
}

async function requestJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 4StageDataService/1.0",
        },
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchBinance(asset) {
  let lastError;
  for (const host of ["https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com"]) {
    try {
      const rows = await requestJson(`${host}/api/v3/klines?symbol=${encodeURIComponent(asset.providerSymbol)}&interval=1w&limit=520`, 2);
      return {
        source: "Binance Public API",
        bars: rows.map((row) => ({
          time: new Date(Number(row[0])).toISOString().slice(0, 10),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        })),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchYahoo(asset) {
  let lastError;
  for (const host of ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"]) {
    try {
      const symbol = encodeURIComponent(asset.providerSymbol || asset.symbol);
      const payload = await requestJson(`${host}/v8/finance/chart/${symbol}?interval=1wk&range=10y&events=div%2Csplits`, 2);
      if (payload.chart?.error) throw new Error(payload.chart.error.description || "Yahoo Finance 返回错误");
      const data = payload.chart?.result?.[0];
      const quote = data?.indicators?.quote?.[0];
      if (!data?.timestamp || !quote) throw new Error("Yahoo Finance 没有历史行情");
      const bars = data.timestamp.flatMap((timestamp, index) => {
        const values = [
          quote.open?.[index],
          quote.high?.[index],
          quote.low?.[index],
          quote.close?.[index],
          quote.volume?.[index],
        ];
        if (values.some((value) => value == null || !Number.isFinite(Number(value)))) return [];
        return [{
          time: new Date(timestamp * 1000).toISOString().slice(0, 10),
          open: Number(values[0]),
          high: Number(values[1]),
          low: Number(values[2]),
          close: Number(values[3]),
          volume: Number(values[4]),
        }];
      });
      return {
        name: data.meta?.longName || data.meta?.shortName,
        source: "Yahoo Finance",
        bars,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchEastmoney(asset) {
  const code = asset.symbol.replace(/\.(SH|SZ)$/, "");
  const market = asset.symbol.endsWith(".SH") ? "1" : "0";
  const params = new URLSearchParams({
    secid: `${market}.${code}`,
    klt: "102",
    fqt: "1",
    lmt: "520",
    end: "20500101",
    fields1: "f1,f2,f3,f4,f5,f6",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f61",
  });
  const payload = await requestJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, 3);
  const data = payload?.data;
  if (!data?.klines?.length) throw new Error("东方财富没有历史行情");
  return {
    name: data.name,
    source: "东方财富 · 前复权",
    bars: data.klines.flatMap((line) => {
      const [time, open, close, high, low, volume] = line.split(",");
      const values = [open, high, low, close, volume].map(Number);
      if (values.some((value) => !Number.isFinite(value))) return [];
      return [{
        time,
        open: values[0],
        high: values[1],
        low: values[2],
        close: values[3],
        volume: values[4],
      }];
    }),
  };
}

async function refreshHs300Universe(baseUniverse) {
  if (SCOPE !== "full") return baseUniverse;
  try {
    const params = new URLSearchParams({
      pn: "1",
      pz: "500",
      po: "1",
      np: "1",
      fid: "f3",
      fs: "b:BK0500",
      fields: "f12,f13,f14",
    });
    const payload = await requestJson(`https://push2.eastmoney.com/api/qt/clist/get?${params}`, 2);
    const rows = Array.isArray(payload?.data?.diff)
      ? payload.data.diff
      : Object.values(payload?.data?.diff || {});
    if (rows.length < 250) throw new Error(`only ${rows.length} constituents returned`);
    const refreshed = rows.map((row) => {
      const code = String(row.f12).padStart(6, "0");
      const suffix = Number(row.f13) === 1 || code.startsWith("6") ? "SH" : "SZ";
      return {
        symbol: `${code}.${suffix}`,
        name: row.f14 || code,
        exchange: suffix === "SH" ? "SSE" : "SZSE",
        category: "沪深300成分股",
        assetType: "stock",
        group: "hs300",
        provider: "eastmoney",
      };
    });
    const nonHs300 = baseUniverse.filter((asset) => asset.group !== "hs300");
    console.log(`[universe] refreshed ${refreshed.length} HS300 constituents`);
    return [...nonHs300, ...refreshed];
  } catch (error) {
    console.warn(`[universe] HS300 refresh failed, using configured snapshot: ${error.message}`);
    return baseUniverse;
  }
}

async function readCache(asset) {
  for (const directory of [...new Set([CACHE_DIR, join(ROOT, "data")])]) {
    try {
      const payload = JSON.parse(await readFile(join(directory, `${asset.symbol}.json`), "utf8"));
      const bars = payload.analysis?.bars || payload.bars;
      if (!Array.isArray(bars) || bars.length < 35) continue;
      return {
        name: payload.name,
        source: `${payload.source || "内置行情"} · 缓存`,
        bars,
      };
    } catch {
      // Try the next cache location.
    }
  }
  return null;
}

async function fetchAsset(asset) {
  try {
    if (asset.provider === "binance") {
      try {
        return await fetchBinance(asset);
      } catch {
        const yahooSymbol = (asset.aliases || []).find((alias) => alias.endsWith("-USD"));
        if (yahooSymbol) return await fetchYahoo({ ...asset, providerSymbol: yahooSymbol });
        throw new Error("加密行情源不可用");
      }
    }
    if (asset.provider === "yahoo") return await fetchYahoo(asset);
    return await fetchEastmoney(asset);
  } catch (error) {
    const cached = await readCache(asset);
    if (cached) {
      console.warn(`[cache] ${asset.symbol}: ${error.message}`);
      return cached;
    }
    throw error;
  }
}

async function buildAsset(asset) {
  const marketData = await fetchAsset(asset);
  const analysis = analyze(marketData.bars);
  const payload = {
    symbol: asset.symbol,
    providerSymbol: asset.providerSymbol || asset.symbol,
    name: asset.name || marketData.name,
    group: asset.group,
    exchange: asset.exchange,
    category: asset.category,
    section: asset.section,
    sortOrder: asset.sortOrder,
    source: marketData.source,
    generatedAt: new Date().toISOString(),
    analysis,
  };
  await writeFile(join(OUTPUT_DIR, `${asset.symbol}.json`), `${JSON.stringify(payload)}\n`);
  if (CACHE_DIR !== OUTPUT_DIR) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${asset.symbol}.json`), `${JSON.stringify(payload)}\n`);
  }
  return {
    symbol: asset.symbol,
    providerSymbol: payload.providerSymbol,
    name: payload.name,
    group: asset.group,
    exchange: asset.exchange,
    category: asset.category,
    section: asset.section,
    sortOrder: asset.sortOrder,
    aliases: asset.aliases || [],
    searchTerms: asset.searchTerms || [],
    asOf: analysis.current.asOf,
    stage: analysis.current.stage,
  };
}

async function mapConcurrent(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await task(items[index], index);
        console.log(`[ok] ${items[index].symbol}`);
      } catch (error) {
        console.error(`[failed] ${items[index].symbol}: ${error.message}`);
        results[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results.filter(Boolean);
}

const universe = await refreshHs300Universe(configuredUniverse);
const selected = SCOPE === "sample"
  ? universe.filter((asset) => ["BTC", "588000.SH", "MSTR", "SPY"].includes(asset.symbol))
  : universe;

await mkdir(OUTPUT_DIR, { recursive: true });
const fastAssets = selected.filter((asset) => asset.provider !== "yahoo");
const yahooAssets = selected.filter((asset) => asset.provider === "yahoo");
const successfulAssets = [
  ...await mapConcurrent(fastAssets, 5, buildAsset),
  ...await mapConcurrent(yahooAssets, 2, buildAsset),
];
const successfulBySymbol = new Map(successfulAssets.map((asset) => [asset.symbol, asset]));
const manifest = selected.map((asset) => successfulBySymbol.get(asset.symbol) || {
  symbol: asset.symbol,
  providerSymbol: asset.providerSymbol || asset.symbol,
  name: asset.name,
  group: asset.group,
  exchange: asset.exchange,
  category: asset.category,
  section: asset.section,
  sortOrder: asset.sortOrder,
  aliases: asset.aliases || [],
  searchTerms: asset.searchTerms || [],
  available: false,
}).sort((a, b) => a.group.localeCompare(b.group)
  || (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
  || a.symbol.localeCompare(b.symbol));

const output = {
  version: "V1.0.4",
  generatedAt: new Date().toISOString(),
  count: manifest.length,
  availableCount: successfulAssets.length,
  assets: manifest,
};
await writeFile(join(OUTPUT_DIR, "assets.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${manifest.length}/${selected.length} assets in ${OUTPUT_DIR}`);
if (SCOPE === "full" && successfulAssets.length < 400) {
  throw new Error(`Only ${successfulAssets.length}/${selected.length} assets generated; deployment aborted to protect the live site.`);
}
