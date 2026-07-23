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
 * Creates a presentation-only long-cycle series. Transition states remain part
 * of their confirmed source stage, while a new core stage must persist before
 * the historical background changes. The scoring engine remains untouched.
 */
export function resolveLongCycleStages(
  points: StageHistoryPoint[],
  confirmationWeeks = 5,
): Array<CoreStage | null> {
  let current: CoreStage | null = null;
  let pending: CoreStage | null = null;
  let pendingStart = -1;
  let pendingWeeks = 0;
  const resolved: Array<CoreStage | null> = [];

  points.forEach((point, index) => {
    const observed = sourceStage[point.state] ?? null;

    if (observed === null) {
      pending = null;
      pendingStart = -1;
      pendingWeeks = 0;
      resolved.push(current);
      return;
    }

    if (current === null) {
      current = observed;
      resolved.push(current);
      return;
    }

    if (observed === current) {
      pending = null;
      pendingStart = -1;
      pendingWeeks = 0;
      resolved.push(current);
      return;
    }

    if (observed !== nextStage(current)) {
      pending = null;
      pendingStart = -1;
      pendingWeeks = 0;
      resolved.push(current);
      return;
    }

    if (pending === observed) {
      pendingWeeks += 1;
    } else {
      pending = observed;
      pendingStart = index;
      pendingWeeks = 1;
    }
    resolved.push(current);

    if (pendingWeeks >= confirmationWeeks) {
      for (let backfill = pendingStart; backfill <= index; backfill += 1) {
        resolved[backfill] = observed;
      }
      current = observed;
      pending = null;
      pendingStart = -1;
      pendingWeeks = 0;
    }
  });

  return resolved;
}

export function buildLongCycleSegments(
  points: StageHistoryPoint[],
  confirmationWeeks = 5,
): LongCycleSegment[] {
  return resolveLongCycleStages(points, confirmationWeeks).reduce<LongCycleSegment[]>(
    (segments, stage, index) => {
      const previous = segments.at(-1);
      if (previous && previous.stage === stage) previous.end = index;
      else segments.push({ start: index, end: index, stage });
      return segments;
    },
    [],
  );
}
