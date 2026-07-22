import type { AssetAnalysis, PublishedAssetAnalysis } from "../src/domain/types";

export function toPublishedAnalysis(analysis: AssetAnalysis): PublishedAssetAnalysis {
  const lastIndex = analysis.stages.length - 1;
  return {
    ...analysis,
    stages: analysis.stages.map((point, index) => index === lastIndex
      ? point
      : { date: point.date, state: point.state }),
  };
}
