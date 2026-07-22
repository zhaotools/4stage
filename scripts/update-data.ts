import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeStages } from "../src/domain/stageEngine";
import type { AssetAnalysis, AssetSummary } from "../src/domain/types";
import { aggregateWeekly, type DailyBar } from "../src/data/weekly";
import { loadEastmoneyBoardConstituents, loadEastmoneyDailyBars } from "./eastmoney";
import { TushareClient } from "./tushare";
import { toPublishedAnalysis } from "./publish-analysis";
import { loadYahooDailyBars } from "./yahoo";

interface AssetConfig {
  symbol: string;
  name: string;
  benchmark: string;
  exchange: AssetSummary["exchange"];
  category?: string;
  searchTerms?: string[];
  providerSymbol?: string;
  minimumWeeklyBars?: number;
}

interface RuntimeAsset extends AssetSummary {
  providerSymbol?: string;
  minimumWeeklyBars?: number;
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
) as AssetConfig[];
const indexes = JSON.parse(
  await readFile(join(process.cwd(), "config", "indexes.json"), "utf8"),
) as AssetConfig[];
const crypto = JSON.parse(
  await readFile(join(process.cwd(), "config", "crypto.json"), "utf8"),
) as AssetConfig[];
const cryptoStocks = JSON.parse(
  await readFile(join(process.cwd(), "config", "crypto-stocks.json"), "utf8"),
) as AssetConfig[];

const numberValue = (value: unknown) => Number(value);
const isoDate = (value: unknown) => {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
};

async function loadAdjustedBars(asset: RuntimeAsset) {
  if (asset.dataSource === "yahoo") {
    const daily = await loadYahooDailyBars(asset.providerSymbol ?? asset.symbol, startDate, endDate);
    return aggregateWeekly(daily, new Date(), { continuousMarket: asset.assetType === "crypto" });
  }
  if (provider === "eastmoney") {
    return aggregateWeekly(await loadEastmoneyDailyBars(asset.symbol, startDate, endDate));
  }
  if (!client) throw new Error("Tushare client is unavailable");
  if (asset.assetType === "index") {
    const prices = await client.query(
      "index_daily",
      { ts_code: asset.symbol, start_date: startDate, end_date: endDate },
      ["ts_code", "trade_date", "open", "high", "low", "close", "vol"],
    );
    return aggregateWeekly(prices.map((row) => ({
      date: isoDate(row.trade_date),
      open: numberValue(row.open),
      high: numberValue(row.high),
      low: numberValue(row.low),
      close: numberValue(row.close),
      volume: row.vol === null ? null : numberValue(row.vol),
    })));
  }
  const priceApi = asset.assetType === "stock" ? "daily" : "fund_daily";
  const factorApi = asset.assetType === "stock" ? "adj_factor" : "fund_adj";
  const prices = await client.query(
    priceApi,
    { ts_code: asset.symbol, start_date: startDate, end_date: endDate },
    ["ts_code", "trade_date", "open", "high", "low", "close", "vol"],
  );
  const factors = await client.query(
    factorApi,
    { ts_code: asset.symbol, start_date: startDate, end_date: endDate },
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
    throw new Error(`No valid adjustment factor for ${asset.symbol}`);
  }

  const daily: DailyBar[] = prices.map((row) => {
    const factor = factorByDate.get(String(row.trade_date));
    if (!factor) throw new Error(`Missing adjustment factor for ${asset.symbol} on ${row.trade_date}`);
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
  if (process.env.INCLUDE_HS300 === "false") return [];
  if (!client) {
    try {
      const constituents = await loadEastmoneyBoardConstituents("BK0500");
      return constituents.map((asset) => ({
        ...asset,
        assetType: "stock" as const,
        benchmark: "000300.SH",
        category: "沪深300",
        indexMemberships: ["沪深300"],
        dataStatus: "live" as const,
        dataSource: provider,
      }));
    } catch (error) {
      console.warn("Current HS300 list is unavailable; using the checked-in constituent snapshot", error);
      const cached = JSON.parse(
        await readFile(join(outputDirectory, "assets.json"), "utf8"),
      ) as AssetSummary[];
      const stocks = cached.filter((asset) => asset.assetType === "stock");
      if (stocks.length < 250) throw error;
      return stocks;
    }
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
    ["ts_code", "name", "exchange", "industry", "list_date"],
  );
  return basics
    .filter((row) => codes.has(String(row.ts_code)))
    .map((row) => ({
      symbol: String(row.ts_code),
      name: String(row.name),
      assetType: "stock" as const,
      exchange: String(row.exchange) === "SSE" ? "SSE" as const : "SZSE" as const,
      benchmark: "000300.SH",
      category: "沪深300",
      industry: row.industry ? String(row.industry) : undefined,
      indexMemberships: ["沪深300"],
      listDate: row.list_date ? isoDate(row.list_date) : undefined,
      dataStatus: "live" as const,
      dataSource: provider,
    }));
}

await mkdir(outputDirectory, { recursive: true });
const overseasAssets: RuntimeAsset[] = [
  ...crypto.map((asset) => ({
    ...asset,
    assetType: "crypto" as const,
    dataStatus: "live" as const,
    dataSource: "yahoo" as const,
  })),
  ...cryptoStocks.map((asset) => ({
    ...asset,
    assetType: "crypto_stock" as const,
    dataStatus: "live" as const,
    dataSource: "yahoo" as const,
  })),
];
const onlyOverseas = process.env.DATA_ONLY === "overseas";
const domesticAssets: RuntimeAsset[] = onlyOverseas ? [] : [
  ...etfs.map((etf) => ({
    ...etf,
    assetType: "etf" as const,
    dataStatus: "live" as const,
    dataSource: provider,
  })),
  ...indexes.map((index) => ({
    ...index,
    assetType: "index" as const,
    dataStatus: "live" as const,
    dataSource: provider,
  })),
  ...(await currentHs300()),
];
const assets: RuntimeAsset[] = [...domesticAssets, ...overseasAssets];

function publishedSummary(asset: RuntimeAsset): AssetSummary {
  const { providerSymbol: _providerSymbol, minimumWeeklyBars: _minimumWeeklyBars, ...summary } = asset;
  return summary;
}

const successful: Array<AssetSummary | undefined> = new Array(assets.length);
let nextAssetIndex = 0;
async function updateNextAsset() {
  while (nextAssetIndex < assets.length) {
    const index = nextAssetIndex;
    nextAssetIndex += 1;
    const asset = assets[index];
  try {
    console.log(`[${index + 1}/${assets.length}] ${asset.symbol} ${asset.name}`);
      const bars = await loadAdjustedBars(asset);
    if (bars.length < (asset.minimumWeeklyBars ?? 60)) {
      throw new Error(`Insufficient weekly history: ${bars.length}`);
    }
    const summary = publishedSummary(asset);
    const analysis: AssetAnalysis = {
      ...summary,
      generatedAt: new Date().toISOString(),
      bars,
      stages: analyzeStages(bars),
    };
    await writeFile(
      join(outputDirectory, `${asset.symbol}.json`),
      JSON.stringify(toPublishedAnalysis(analysis)),
    );
      successful[index] = summary;
  } catch (error) {
    console.error(`Skipped ${asset.symbol}:`, error);
      try {
        await readFile(join(outputDirectory, `${asset.symbol}.json`), "utf8");
        successful[index] = publishedSummary(asset);
        console.warn(`Using cached analysis for ${asset.symbol}`);
      } catch {
        // Newly listed assets without enough history are intentionally omitted.
      }
  }
  }
}

const concurrency = provider === "eastmoney"
  ? Math.max(1, Number(process.env.DATA_CONCURRENCY ?? 4))
  : 1;
await Promise.all(Array.from({ length: concurrency }, () => updateNextAsset()));

const updated = successful.filter((asset): asset is AssetSummary => asset !== undefined);
const missingOverseas = overseasAssets.filter(
  (asset) => !updated.some((updatedAsset) => updatedAsset.symbol === asset.symbol),
);
if (missingOverseas.length > 0) {
  throw new Error(`Missing required overseas assets: ${missingOverseas.map((asset) => asset.symbol).join(", ")}`);
}
let completed = updated;
if (onlyOverseas) {
  const cached = JSON.parse(
    await readFile(join(outputDirectory, "assets.json"), "utf8"),
  ) as AssetSummary[];
  completed = [
    ...cached.filter((asset) => asset.assetType !== "crypto" && asset.assetType !== "crypto_stock"),
    ...updated,
  ];
}
if (completed.length === 0) throw new Error("No asset data was generated");
await writeFile(join(outputDirectory, "assets.json"), JSON.stringify(completed, null, 2));
console.log(`Generated live analysis for ${updated.length}/${assets.length} requested assets; ${completed.length} published`);
