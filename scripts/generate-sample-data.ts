import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeStages } from "../src/domain/stageEngine";
import type { AssetAnalysis, AssetSummary, WeeklyBar } from "../src/domain/types";

const outputDirectory = join(process.cwd(), "public", "data");

function seededNoise(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
}

function buildBars(seed: number, phases: Array<{ weeks: number; drift: number; noise: number }>) {
  const random = seededNoise(seed);
  const bars: WeeklyBar[] = [];
  let close = 3.8 + seed * 0.07;
  let week = 0;

  for (const phase of phases) {
    for (let i = 0; i < phase.weeks; i += 1) {
      const open = close * (1 + random() * phase.noise * 0.5);
      close = Math.max(0.5, close * (1 + phase.drift + random() * phase.noise));
      const spread = 0.012 + Math.abs(random()) * 0.025;
      const date = new Date(Date.UTC(2021, 0, 8 + week * 7)).toISOString().slice(0, 10);
      bars.push({
        date,
        open: Number(open.toFixed(3)),
        high: Number((Math.max(open, close) * (1 + spread)).toFixed(3)),
        low: Number((Math.min(open, close) * (1 - spread)).toFixed(3)),
        close: Number(close.toFixed(3)),
        volume: Math.round((4_000_000 + seed * 500_000) * (0.8 + Math.abs(random()) * 0.7)),
      });
      week += 1;
    }
  }
  return bars;
}

const assets: Array<AssetSummary & { seed: number; phases: Array<{ weeks: number; drift: number; noise: number }> }> = [
  {
    symbol: "510300.SH",
    name: "沪深300ETF",
    assetType: "etf",
    exchange: "SSE",
    benchmark: "000300.SH",
    dataStatus: "sample",
    seed: 3,
    phases: [
      { weeks: 70, drift: -0.004, noise: 0.025 },
      { weeks: 30, drift: 0.001, noise: 0.012 },
      { weeks: 85, drift: 0.009, noise: 0.022 },
      { weeks: 35, drift: 0.001, noise: 0.028 },
      { weeks: 40, drift: -0.008, noise: 0.025 },
      { weeks: 28, drift: 0.0005, noise: 0.012 },
    ],
  },
  {
    symbol: "510500.SH",
    name: "中证500ETF",
    assetType: "etf",
    exchange: "SSE",
    benchmark: "000905.SH",
    dataStatus: "sample",
    seed: 7,
    phases: [
      { weeks: 55, drift: -0.006, noise: 0.03 },
      { weeks: 34, drift: 0.001, noise: 0.014 },
      { weeks: 110, drift: 0.01, noise: 0.028 },
      { weeks: 45, drift: 0.0002, noise: 0.03 },
      { weeks: 44, drift: -0.006, noise: 0.027 },
    ],
  },
  {
    symbol: "159915.SZ",
    name: "创业板ETF",
    assetType: "etf",
    exchange: "SZSE",
    benchmark: "399006.SZ",
    dataStatus: "sample",
    seed: 11,
    phases: [
      { weeks: 65, drift: 0.008, noise: 0.032 },
      { weeks: 42, drift: 0.0001, noise: 0.034 },
      { weeks: 92, drift: -0.009, noise: 0.03 },
      { weeks: 38, drift: 0.0008, noise: 0.014 },
      { weeks: 51, drift: 0.008, noise: 0.026 },
    ],
  },
];

await mkdir(outputDirectory, { recursive: true });

const summaries: AssetSummary[] = assets.map(({ seed: _seed, phases: _phases, ...summary }) => summary);
await writeFile(join(outputDirectory, "assets.json"), JSON.stringify(summaries, null, 2));

for (const asset of assets) {
  const { seed, phases, ...summary } = asset;
  const bars = buildBars(seed, phases);
  const analysis: AssetAnalysis = {
    ...summary,
    generatedAt: new Date().toISOString(),
    bars,
    stages: analyzeStages(bars),
  };
  await writeFile(
    join(outputDirectory, `${asset.symbol}.json`),
    JSON.stringify(analysis),
  );
}

console.log(`Generated ${assets.length} sample assets in ${outputDirectory}`);
