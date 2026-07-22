import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeStages } from "../src/domain/stageEngine";
import type { AssetAnalysis, AssetSummary } from "../src/domain/types";
import { aggregateWeekly, type DailyBar } from "../src/data/weekly";
import { loadEastmoneyDailyBars } from "./eastmoney";
import { TushareClient } from "./tushare";

interface EtfConfig {
  symbol: string;
  name: string;
  benchmark: string;
  exchange: "SSE" | "SZSE";
}

const token = process.env.TUSHARE_TOKEN;
const providerInput = process.env.DATA_PROVIDER ?? (token ? "tushare" : "eastmoney");
if (providerInput !== "eastmoney" && providerInput !== "tushare") {
  throw new Error(`Unsupported DATA_PROVIDER: ${providerInput}`);
}
const provider: "eastmoney" | "tushare" = providerInput;
if (provider === "tushare" && !token) throw new Error("TUSHARE_TOKEN is required for Tushare");
const client = token ? new TushareClient(token) : null;
const outputDirectory = join(process.cwd(), "public", "data");
const startDate = process.env.DATA_START_DATE ?? "20180101";
const endDate = new Date().toISOString().slice(0, 10).replaceAll("-", "");

const etfs = JSON.parse(
  await readFile(join(process.cwd(), "config", "etfs.json"), "utf8"),
) as EtfConfig[];

const numberValue = (value: unknown) => Number(value);
const isoDate = (value: unknown) => {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
};

async function loadAdjustedBars(symbol: string, assetType: "stock" | "etf") {
  if (provider === "eastmoney") {
    return aggregateWeekly(await loadEastmoneyDailyBars(symbol, startDate, endDate));
  }
  if (!client) throw new Error("Tushare client is unavailable");
  const priceApi = assetType === "stock" ? "daily" : "fund_daily";
  const factorApi = assetType === "stock" ? "adj_factor" : "fund_adj";
  const prices = await client.query(
    priceApi,
    { ts_code: symbol, start_date: startDate, end_date: endDate },
    ["ts_code", "trade_date", "open", "high", "low", "close", "vol"],
  );
  const factors = await client.query(
    factorApi,
    { ts_code: symbol, start_date: startDate, end_date: endDate },
    ["ts_code", "trade_date", "adj_factor"],
  );
  const factorByDate = new Map(
    factors.map((row) => [String(row.trade_date), numberValue(row.adj_factor)]),
  );
  const latestFactorRow = [...factors].sort((a, b) =>
    String(a.trade_date).localeCompare(String(b.trade_date)),
  ).at(-1);
  const latestFactor = latestFactorRow ? numberValue(latestFactorRow.adj_factor) : Number.NaN;
  if (!Number.isFinite(latestFactor) || latestFactor <= 0) {
    throw new Error(`No valid adjustment factor for ${symbol}`);
  }

  const daily: DailyBar[] = prices.map((row) => {
    const factor = factorByDate.get(String(row.trade_date));
    if (!factor) throw new Error(`Missing adjustment factor for ${symbol} on ${row.trade_date}`);
    const multiplier = factor / latestFactor;
    return {
      date: isoDate(row.trade_date),
      open: numberValue(row.open) * multiplier,
      high: numberValue(row.high) * multiplier,
      low: numberValue(row.low) * multiplier,
      close: numberValue(row.close) * multiplier,
      volume: row.vol === null ? null : numberValue(row.vol),
    };
  });
  return aggregateWeekly(daily);
}

async function currentHs300(): Promise<AssetSummary[]> {
  if (process.env.INCLUDE_HS300 !== "true") return [];
  if (provider !== "tushare" || !client) {
    console.warn("INCLUDE_HS300 requires DATA_PROVIDER=tushare; skipping constituents");
    return [];
  }
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 180);
  const weights = await client.query(
    "index_weight",
    {
      index_code: "000300.SH",
      start_date: start.toISOString().slice(0, 10).replaceAll("-", ""),
      end_date: endDate,
    },
    ["index_code", "con_code", "trade_date", "weight"],
  );
  const latestDate = weights.map((row) => String(row.trade_date)).sort().at(-1);
  const codes = new Set(
    weights.filter((row) => String(row.trade_date) === latestDate).map((row) => String(row.con_code)),
  );
  const basics = await client.query(
    "stock_basic",
    { list_status: "L" },
    ["ts_code", "name", "exchange", "list_date"],
  );
  return basics
    .filter((row) => codes.has(String(row.ts_code)))
    .map((row) => ({
      symbol: String(row.ts_code),
      name: String(row.name),
      assetType: "stock" as const,
      exchange: String(row.exchange) === "SSE" ? "SSE" as const : "SZSE" as const,
      benchmark: "000300.SH",
      dataStatus: "live" as const,
    }));
}

await mkdir(outputDirectory, { recursive: true });
const assets: AssetSummary[] = [
  ...etfs.map((etf) => ({
    ...etf,
    assetType: "etf" as const,
    dataStatus: "live" as const,
    dataSource: provider,
  })),
  ...(await currentHs300()),
];

const successful: AssetSummary[] = [];
for (const [index, asset] of assets.entries()) {
  try {
    console.log(`[${index + 1}/${assets.length}] ${asset.symbol} ${asset.name}`);
    const bars = await loadAdjustedBars(asset.symbol, asset.assetType === "stock" ? "stock" : "etf");
    if (bars.length < 60) throw new Error(`Insufficient weekly history: ${bars.length}`);
    const analysis: AssetAnalysis = {
      ...asset,
      generatedAt: new Date().toISOString(),
      bars,
      stages: analyzeStages(bars),
    };
    await writeFile(join(outputDirectory, `${asset.symbol}.json`), JSON.stringify(analysis));
    successful.push(asset);
  } catch (error) {
    console.error(`Skipped ${asset.symbol}:`, error);
  }
}

if (successful.length === 0) throw new Error("No asset data was generated");
await writeFile(join(outputDirectory, "assets.json"), JSON.stringify(successful, null, 2));
console.log(`Generated live analysis for ${successful.length}/${assets.length} assets via ${provider}`);
