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
    expect(result).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  it("changes the long cycle after five persistent core-stage weeks", () => {
    const result = buildLongCycleSegments(points([
      "stage_4", "stage_4_to_1", "stage_1", "stage_1", "stage_1", "stage_1", "stage_1", "stage_1",
    ]));
    expect(result).toEqual([
      { start: 0, end: 1, stage: 4 },
      { start: 2, end: 7, stage: 1 },
    ]);
  });
});
