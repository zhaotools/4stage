import { describe, expect, it } from "vitest";
import { toPublishedAnalysis } from "../scripts/publish-analysis";
import type { AssetAnalysis, StagePoint } from "../src/domain/types";

function stage(date: string): StagePoint {
  return {
    date,
    state: "stage_1",
    stableStage: 1,
    candidateStage: 1,
    nextStage: 2,
    transitionProgress: 25,
    transitionChecks: [{ key: "slope", label: "均线转升", detail: "测试", passed: true }],
    matchScore: 75,
    scores: { 1: 75, 2: 20, 3: 30, 4: 10 },
    features: {
      sma30: 1, atr20: 1, normalizedSlope: 0, previousSlope: 0,
      consolidationScore: 80, priorTrend: "down", priorTrendQuality: 1,
      priorTrendSlope: -0.1, priorTrendReturn13: -0.1, priorTrendReturn26: -0.2,
      priorTrendReturn39: -0.3, priceDistance: 0, rangePosition52: 0.2,
      momentum13: 0, breakout26: false, breakdown26: false,
      volumeRatio: 1, volatilityRatio: 1,
    },
    reasons: [{ tone: "positive", text: "测试" }],
  };
}

describe("published analysis", () => {
  it("keeps the latest point complete and compacts history", () => {
    const analysis = {
      symbol: "510300.SH", name: "沪深300ETF", assetType: "etf", exchange: "SSE",
      benchmark: "000300.SH", dataStatus: "live", generatedAt: "2026-07-22",
      bars: [], stages: [stage("2026-07-11"), stage("2026-07-18")],
    } satisfies AssetAnalysis;
    const published = toPublishedAnalysis(analysis);
    expect(published.stages[0]).toEqual({ date: "2026-07-11", state: "stage_1" });
    expect(published.stages[1]).toHaveProperty("features");
  });
});
