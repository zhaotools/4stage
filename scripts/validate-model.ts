import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetAnalysis, AssetSummary, StageState } from "../src/domain/types";

const dataDirectory = join(process.cwd(), "public", "data");
const assets = JSON.parse(
  await readFile(join(dataDirectory, "assets.json"), "utf8"),
) as AssetSummary[];

const coreStage = (state: StageState) => {
  const match = /^stage_([1-4])$/.exec(state);
  return match ? Number(match[1]) : null;
};

interface Metrics {
  symbol: string;
  classifiedWeeks: number;
  unclearRate: number;
  transitionRate: number;
  coreChanges: number;
  averageCoreRun: number;
  latestState: StageState;
  latestScore: number | null;
}

function calculateMetrics(analysis: AssetAnalysis): Metrics {
  const usable = analysis.stages.filter((point) => point.state !== "insufficient_data");
  const unclear = usable.filter((point) => point.state === "unclear").length;
  const transitions = usable.filter((point) => point.state.includes("_to_")).length;
  const runs: number[] = [];
  let previous: number | null = null;
  let runLength = 0;
  let coreChanges = 0;

  for (const point of usable) {
    const stage = coreStage(point.state);
    if (stage === null) continue;
    if (previous === null || stage === previous) runLength += 1;
    else {
      runs.push(runLength);
      runLength = 1;
      coreChanges += 1;
    }
    previous = stage;
  }
  if (runLength > 0) runs.push(runLength);
  const latest = analysis.stages.at(-1)!;
  return {
    symbol: analysis.symbol,
    classifiedWeeks: usable.length,
    unclearRate: usable.length ? unclear / usable.length : 0,
    transitionRate: usable.length ? transitions / usable.length : 0,
    coreChanges,
    averageCoreRun: runs.length ? runs.reduce((sum, value) => sum + value, 0) / runs.length : 0,
    latestState: latest.state,
    latestScore: latest.matchScore,
  };
}

const metrics = await Promise.all(assets.map(async (asset) => {
  const analysis = JSON.parse(
    await readFile(join(dataDirectory, `${asset.symbol}.json`), "utf8"),
  ) as AssetAnalysis;
  return calculateMetrics(analysis);
}));

console.table(metrics.map((metric) => ({
  symbol: metric.symbol,
  weeks: metric.classifiedWeeks,
  unclear: `${(metric.unclearRate * 100).toFixed(1)}%`,
  transition: `${(metric.transitionRate * 100).toFixed(1)}%`,
  changes: metric.coreChanges,
  avgRun: metric.averageCoreRun.toFixed(1),
  latest: metric.latestState,
  score: metric.latestScore,
})));

const weightedWeeks = metrics.reduce((sum, metric) => sum + metric.classifiedWeeks, 0);
const weightedUnclear = metrics.reduce(
  (sum, metric) => sum + metric.unclearRate * metric.classifiedWeeks,
  0,
);
const portfolioUnclearRate = weightedUnclear / weightedWeeks;
const maxUnclearRate = Number(process.env.MODEL_MAX_UNCLEAR_RATE ?? 0.25);
console.log(`Portfolio unclear rate: ${(100 * portfolioUnclearRate).toFixed(1)}%`);
if (!Number.isFinite(maxUnclearRate) || maxUnclearRate <= 0 || maxUnclearRate >= 1) {
  throw new Error("MODEL_MAX_UNCLEAR_RATE must be between 0 and 1");
}
if (portfolioUnclearRate > maxUnclearRate) {
  throw new Error(
    `Model quality gate failed: ${(100 * portfolioUnclearRate).toFixed(1)}% unclear > ${(100 * maxUnclearRate).toFixed(1)}%`,
  );
}
