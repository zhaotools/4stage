import type { CoreStage, StageHistoryPoint, StageState } from "../domain/types";

export interface LongCycleSegment {
  start: number;
  end: number;
  stage: CoreStage | null;
}

const sourceStage: Partial<Record<StageState, CoreStage>> = {
  stage_1: 1,
  stage_1_to_2: 1,
  stage_2: 2,
  stage_2_to_3: 2,
  stage_3: 3,
  stage_3_to_4: 3,
  stage_4: 4,
  stage_4_to_1: 4,
  stage_4_to_2: 4,
};

const nextStage = (stage: CoreStage): CoreStage =>
  stage === 4 ? 1 : (stage + 1) as CoreStage;

/**
 * Creates a presentation-only long-cycle series from the engine's confirmed
 * states. Transition states remain part of their source stage; the chart adds
 * no second confirmation delay of its own.
 */
export function resolveLongCycleStages(
  points: StageHistoryPoint[],
): Array<CoreStage | null> {
  let current: CoreStage | null = null;
  const resolved: Array<CoreStage | null> = [];

  points.forEach((point) => {
    const observed = sourceStage[point.state] ?? null;

    if (observed === null) {
      resolved.push(current);
      return;
    }

    if (current === null) {
      current = observed;
      resolved.push(current);
      return;
    }

    if (observed === current) {
      resolved.push(current);
      return;
    }

    if (observed !== nextStage(current)) {
      resolved.push(current);
      return;
    }
    current = observed;
    resolved.push(current);
  });

  return resolved;
}

export function buildLongCycleSegments(
  points: StageHistoryPoint[],
): LongCycleSegment[] {
  return resolveLongCycleStages(points).reduce<LongCycleSegment[]>(
    (segments, stage, index) => {
      const previous = segments.at(-1);
      if (previous && previous.stage === stage) previous.end = index;
      else segments.push({ start: index, end: index, stage });
      return segments;
    },
    [],
  );
}
