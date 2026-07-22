import { describe, expect, it } from "vitest";
import { analyzeStages, calculateFeatures } from "../src/domain/stageEngine";
import type { WeeklyBar } from "../src/domain/types";

function series(changes: number[]): WeeklyBar[] {
  let close = 100;
  return changes.map((change, index) => {
    const open = close;
    close = Math.max(5, close * (1 + change));
    const date = new Date(Date.UTC(2020, 0, 3 + index * 7)).toISOString().slice(0, 10);
    return {
      date,
      open,
      high: Math.max(open, close) * 1.018,
      low: Math.min(open, close) * 0.982,
      close,
      volume: 1_000_000 + index * 5_000,
    };
  });
}

describe("stage engine", () => {
  it("recognizes a sustained advancing trend", () => {
    const result = analyzeStages(series(Array.from({ length: 120 }, () => 0.012)));
    expect(result.at(-1)?.stableStage).toBe(2);
  });

  it("recognizes a sustained declining trend", () => {
    const result = analyzeStages(series(Array.from({ length: 120 }, () => -0.011)));
    expect(result.at(-1)?.stableStage).toBe(4);
  });

  it("is causal and does not change an earlier result when future bars are appended", () => {
    const bars = series([
      ...Array.from({ length: 80 }, () => 0.01),
      ...Array.from({ length: 50 }, () => -0.012),
    ]);
    const prefix = analyzeStages(bars.slice(0, 100));
    const full = analyzeStages(bars);
    expect(full.slice(0, 100)).toEqual(prefix);
  });

  it("reports insufficient data before a full weekly history exists", () => {
    const result = analyzeStages(series(Array.from({ length: 40 }, () => 0.01)));
    expect(result.every((point) => point.state === "insufficient_data")).toBe(true);
  });

  it("keeps the confirmed stage when a later weekly score is inconclusive", () => {
    const changes = [
      ...Array.from({ length: 85 }, () => 0.011),
      ...Array.from({ length: 35 }, (_, index) => index % 2 === 0 ? 0.004 : -0.004),
      ...Array.from({ length: 20 }, () => 0),
    ];
    const result = analyzeStages(series(changes));
    const inconclusive = result.filter(
      (point) => point.stableStage !== null && point.candidateStage === null,
    );
    expect(inconclusive.length).toBeGreaterThan(0);
    expect(inconclusive.every((point) => point.state !== "unclear")).toBe(true);
  });

  it("scores an advance followed by consolidation closer to Stage 3 than Stage 1", () => {
    const result = analyzeStages(series([
      ...Array.from({ length: 100 }, () => 0.01),
      ...Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? 0.002 : -0.002),
    ]));
    const scores = result.at(-1)?.scores;
    expect(scores).not.toBeNull();
    expect(scores![3]).toBeGreaterThan(scores![1]);
  });

  it("scores a decline followed by consolidation closer to Stage 1 than Stage 3", () => {
    const result = analyzeStages(series([
      ...Array.from({ length: 100 }, () => -0.009),
      ...Array.from({ length: 20 }, (_, index) => index % 2 === 0 ? 0.002 : -0.002),
    ]));
    const scores = result.at(-1)?.scores;
    expect(scores).not.toBeNull();
    expect(scores![1]).toBeGreaterThan(scores![3]);
  });

  it("reports mixed prior trend when multi-period direction signals conflict", () => {
    const bars = series([
      ...Array.from({ length: 70 }, (_, index) => index % 8 < 4 ? 0.018 : -0.017),
      ...Array.from({ length: 30 }, (_, index) => index % 2 === 0 ? 0.003 : -0.003),
    ]);
    const features = calculateFeatures(bars, bars.length - 1);
    expect(features.priorTrend).toBe("mixed");
    expect(features.priorTrendQuality).toBeLessThan(0.75);
  });

  it("marks a strong V-shaped recovery from Stage 4 before confirming Stage 2", () => {
    const result = analyzeStages(series([
      ...Array.from({ length: 90 }, () => -0.008),
      ...Array.from({ length: 9 }, () => 0.055),
      -0.025,
      0.045,
    ]));
    const recovery = result.find((point) => point.state === "stage_4_to_2");
    expect(recovery).toBeDefined();
    expect(recovery?.stableStage).toBe(4);
    expect(recovery?.candidateStage).toBe(2);
    expect(recovery?.scores?.[2]).toBeGreaterThan(recovery?.scores?.[4] ?? 0);

    const confirmedAdvance = result.find((point) => point.state === "stage_2");
    expect(confirmedAdvance).toBeDefined();
    expect(confirmedAdvance?.features.normalizedSlope).toBeGreaterThanOrEqual(0.015);
  });
});
