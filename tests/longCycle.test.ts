import { describe, expect, it } from "vitest";
import type { StageHistoryPoint, StageState } from "../src/domain/types";
import { buildLongCycleSegments, resolveLongCycleStages } from "../src/lib/longCycle";

const points = (states: StageState[]): StageHistoryPoint[] =>
  states.map((state, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, state }));

describe("long-cycle presentation", () => {
  it("keeps transition and unclear weeks inside the confirmed source stage", () => {
    const result = resolveLongCycleStages(points([
      "stage_4", "stage_4_to_1", "unclear", "stage_1", "stage_1", "stage_1", "stage_1",
    ]));
    expect(result).toEqual([4, 4, 4, 1, 1, 1, 1]);
  });

  it("changes the chart as soon as the engine confirms a new core stage", () => {
    const result = buildLongCycleSegments(points([
      "stage_4", "stage_4_to_1", "stage_1", "stage_1",
    ]));
    expect(result).toEqual([
      { start: 0, end: 1, stage: 4 },
      { start: 2, end: 3, stage: 1 },
    ]);
  });

  it("ignores reverse and skipped stages in the historical display", () => {
    const result = buildLongCycleSegments(points([
      "stage_3",
      "stage_2", "stage_2", "stage_2", "stage_2", "stage_2", "stage_2",
      "stage_4", "stage_4",
    ]));
    expect(result).toEqual([
      { start: 0, end: 6, stage: 3 },
      { start: 7, end: 8, stage: 4 },
    ]);
  });
});
