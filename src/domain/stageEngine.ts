import type {
  CoreStage,
  StageFeatures,
  StagePoint,
  StageReason,
  StageScores,
  StageState,
  WeeklyBar,
} from "./types";

const MIN_HISTORY = 52;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const smaAt = (bars: WeeklyBar[], index: number, period: number) => {
  if (index < period - 1) return null;
  return mean(bars.slice(index - period + 1, index + 1).map((bar) => bar.close));
};

const atrAt = (bars: WeeklyBar[], index: number, period: number) => {
  if (index < period) return null;
  const trueRanges: number[] = [];
  for (let i = index - period + 1; i <= index; i += 1) {
    const bar = bars[i];
    const previousClose = bars[i - 1].close;
    trueRanges.push(
      Math.max(
        bar.high - bar.low,
        Math.abs(bar.high - previousClose),
        Math.abs(bar.low - previousClose),
      ),
    );
  }
  return mean(trueRanges);
};

const emptyFeatures = (): StageFeatures => ({
  sma30: null,
  atr20: null,
  normalizedSlope: null,
  previousSlope: null,
  consolidationScore: null,
  priorTrend: null,
  priorTrendQuality: null,
  priorTrendSlope: null,
  priorTrendReturn13: null,
  priorTrendReturn26: null,
  priorTrendReturn39: null,
  priceDistance: null,
  rangePosition52: null,
  momentum13: null,
  breakout26: false,
  breakdown26: false,
  volumeRatio: null,
  volatilityRatio: null,
});

export function calculateFeatures(bars: WeeklyBar[], index: number): StageFeatures {
  const sma30 = smaAt(bars, index, 30);
  const atr20 = atrAt(bars, index, 20);
  if (sma30 === null || atr20 === null || atr20 <= 0 || index < MIN_HISTORY - 1) {
    return emptyFeatures();
  }

  const sma5Ago = smaAt(bars, index - 5, 30);
  const sma10Ago = smaAt(bars, index - 10, 30);
  const sma13Ago = smaAt(bars, index - 13, 30);
  const sma26Ago = smaAt(bars, index - 26, 30);
  const normalizedSlope = sma5Ago === null ? null : (sma30 - sma5Ago) / (5 * atr20);
  const previousSlope =
    sma5Ago === null || sma10Ago === null ? null : (sma5Ago - sma10Ago) / (5 * atr20);
  const priorTrendSlope =
    sma13Ago === null || sma26Ago === null ? null : (sma13Ago - sma26Ago) / (13 * atr20);
  const priorTrendReturn13 = index < 26 ? null : bars[index - 13].close / bars[index - 26].close - 1;
  const priorTrendReturn26 = index < 39 ? null : bars[index - 13].close / bars[index - 39].close - 1;
  const priorTrendReturn39 = index < 52 ? null : bars[index - 13].close / bars[index - 52].close - 1;

  const lookback52 = bars.slice(index - 51, index + 1);
  const high52 = Math.max(...lookback52.map((bar) => bar.high));
  const low52 = Math.min(...lookback52.map((bar) => bar.low));
  const prior26 = bars.slice(index - 26, index);
  const priorHigh26 = Math.max(...prior26.map((bar) => bar.high));
  const priorLow26 = Math.min(...prior26.map((bar) => bar.low));
  const current = bars[index];
  const close13Ago = bars[index - 13].close;
  const breakout26 = current.close > priorHigh26;
  const breakdown26 = current.close < priorLow26;

  const recentAtr = atrAt(bars, index, 8);
  const earlierAtr = atrAt(bars, index - 8, 8);
  const volumes = bars
    .slice(index - 29, index + 1)
    .map((bar) => bar.volume)
    .filter((volume): volume is number => volume !== null && volume > 0);
  const averageVolume = mean(volumes);
  const priceDistance = (current.close - sma30) / atr20;
  const volatilityRatio =
    recentAtr && earlierAtr && earlierAtr > 0 ? recentAtr / earlierAtr : null;
  const flatness = normalizedSlope === null ? 0 : 1 - clamp(Math.abs(normalizedSlope) / 0.075);
  const proximity = 1 - clamp(Math.abs(priceDistance) / 1.5);
  const contraction = volatilityRatio === null ? 0.5 : 1 - clamp((volatilityRatio - 0.65) / 0.75);
  const consolidationScore = Math.round(
    100 * (0.4 * flatness + 0.25 * proximity + 0.2 * contraction + 0.15 * Number(!breakout26 && !breakdown26)),
  );
  const trendSignals = [
    { value: priorTrendSlope, threshold: 0.025 },
    { value: priorTrendReturn13, threshold: 0.03 },
    { value: priorTrendReturn26, threshold: 0.05 },
    { value: priorTrendReturn39, threshold: 0.08 },
  ];
  const upVotes = trendSignals.filter(({ value, threshold }) => value !== null && value >= threshold).length;
  const downVotes = trendSignals.filter(({ value, threshold }) => value !== null && value <= -threshold).length;
  // A-share ETFs have a structural upward drift, so a convincing prior advance
  // must agree across all horizons. Declines tend to be faster; two aligned
  // horizons are enough to call the direction clear. Everything else abstains.
  const priorTrend = upVotes === 4 && downVotes === 0 ? "up" : downVotes >= 2 && upVotes === 0 ? "down" : "mixed";
  const priorTrendQuality = Math.max(upVotes, downVotes) / trendSignals.length;

  return {
    sma30: round(sma30),
    atr20: round(atr20),
    normalizedSlope: normalizedSlope === null ? null : round(normalizedSlope),
    previousSlope: previousSlope === null ? null : round(previousSlope),
    consolidationScore,
    priorTrend,
    priorTrendQuality: round(priorTrendQuality),
    priorTrendSlope: priorTrendSlope === null ? null : round(priorTrendSlope),
    priorTrendReturn13: priorTrendReturn13 === null ? null : round(priorTrendReturn13),
    priorTrendReturn26: priorTrendReturn26 === null ? null : round(priorTrendReturn26),
    priorTrendReturn39: priorTrendReturn39 === null ? null : round(priorTrendReturn39),
    priceDistance: round(priceDistance),
    rangePosition52: round((current.close - low52) / Math.max(high52 - low52, atr20)),
    momentum13: round(current.close / close13Ago - 1),
    breakout26,
    breakdown26,
    volumeRatio:
      averageVolume && current.volume ? round(current.volume / averageVolume) : null,
    volatilityRatio: volatilityRatio === null ? null : round(volatilityRatio),
  };
}

function scoreFeatures(features: StageFeatures): StageScores | null {
  const {
    normalizedSlope: slope,
    consolidationScore,
    priorTrend,
    priorTrendQuality,
    priorTrendSlope,
    priorTrendReturn13,
    priorTrendReturn26,
    priorTrendReturn39,
    priceDistance,
    rangePosition52,
    momentum13,
    breakout26,
    breakdown26,
  } = features;

  if (
    slope === null || consolidationScore === null || priorTrendQuality === null || priorTrendSlope === null ||
    priorTrendReturn13 === null || priorTrendReturn26 === null || priorTrendReturn39 === null ||
    priceDistance === null ||
    rangePosition52 === null ||
    momentum13 === null
  ) {
    return null;
  }

  const positiveSlope = clamp(slope / 0.12);
  const negativeSlope = clamp(-slope / 0.12);
  const aboveAverage = clamp((priceDistance + 0.15) / 1.5);
  const belowAverage = clamp((-priceDistance + 0.15) / 1.5);
  const positiveMomentum = clamp((momentum13 + 0.02) / 0.22);
  const negativeMomentum = clamp((-momentum13 + 0.02) / 0.22);
  const rawPriorAdvance =
    0.3 * clamp(priorTrendSlope / 0.08) +
    0.2 * clamp(priorTrendReturn13 / 0.1) +
    0.25 * clamp(priorTrendReturn26 / 0.18) +
    0.25 * clamp(priorTrendReturn39 / 0.25);
  const rawPriorDecline =
    0.3 * clamp(-priorTrendSlope / 0.08) +
    0.2 * clamp(-priorTrendReturn13 / 0.1) +
    0.25 * clamp(-priorTrendReturn26 / 0.18) +
    0.25 * clamp(-priorTrendReturn39 / 0.25);
  const priorAdvance = rawPriorAdvance * (priorTrend === "up" ? priorTrendQuality : priorTrend === "mixed" ? 0.2 : 0);
  const priorDecline = rawPriorDecline * (priorTrend === "down" ? priorTrendQuality : priorTrend === "mixed" ? 0.2 : 0);
  const consolidation = consolidationScore / 100;

  return {
    1: Math.round(
      100 *
        (0.55 * consolidation +
          0.3 * priorDecline +
          0.15 * (1 - rangePosition52)),
    ),
    2: Math.round(
      100 *
        (0.3 * positiveSlope +
          0.22 * aboveAverage +
          0.18 * positiveMomentum +
          0.15 * rangePosition52 +
          0.15 * Number(breakout26)),
    ),
    3: Math.round(
      100 *
        (0.55 * consolidation +
          0.3 * priorAdvance +
          0.15 * rangePosition52),
    ),
    4: Math.round(
      100 *
        (0.3 * negativeSlope +
          0.22 * belowAverage +
          0.18 * negativeMomentum +
          0.15 * (1 - rangePosition52) +
          0.15 * Number(breakdown26)),
    ),
  };
}

const stageKey = (stage: CoreStage): StageState => `stage_${stage}` as StageState;

const transitionState = (from: CoreStage, to: CoreStage): StageState => {
  if (from === 1 && to === 2) return "stage_1_to_2";
  if (from === 2 && to === 3) return "stage_2_to_3";
  if (from === 3 && to === 4) return "stage_3_to_4";
  if (from === 4 && to === 1) return "stage_4_to_1";
  return "unclear";
};

const isAdjacentTransition = (from: CoreStage, to: CoreStage) =>
  (from === 1 && to === 2) ||
  (from === 2 && to === 3) ||
  (from === 3 && to === 4) ||
  (from === 4 && to === 1);

function rankScores(scores: StageScores) {
  return (Object.entries(scores) as [string, number][])
    .map(([stage, score]) => ({ stage: Number(stage) as CoreStage, score }))
    .sort((a, b) => b.score - a.score);
}

function buildReasons(features: StageFeatures, stage: CoreStage | null): StageReason[] {
  if (stage === null || features.sma30 === null) return [];
  const reasons: StageReason[] = [];
  const slope = features.normalizedSlope ?? 0;
  const distance = features.priceDistance ?? 0;

  if (stage === 1 || stage === 3) {
    const consolidation = features.consolidationScore ?? 0;
    const trendText =
      features.priorTrend === "up" ? "上涨" : features.priorTrend === "down" ? "下跌" : "混合";
    reasons.push({
      tone: consolidation >= 60 ? "positive" : "neutral",
      text: `横盘结构成立度 ${consolidation}/100`,
    });
    reasons.push({
      tone:
        (stage === 1 && features.priorTrend === "down") || (stage === 3 && features.priorTrend === "up")
          ? "positive"
          : "neutral",
      text: `横盘前26周趋势为${trendText}`,
    });
    reasons.push({
      tone: "neutral",
      text: `当前位于52周价格区间的${Math.round((features.rangePosition52 ?? 0) * 100)}%位置`,
    });
    return reasons;
  }

  reasons.push({
    tone: Math.abs(slope) < 0.04 ? "neutral" : stage === 2 ? "positive" : "warning",
    text:
      Math.abs(slope) < 0.04
        ? "30周均线斜率接近走平"
        : slope > 0
          ? "30周均线保持上升"
          : "30周均线保持下降",
  });
  reasons.push({
    tone: distance >= 0 ? "positive" : "warning",
    text: distance >= 0 ? "收盘价位于30周均线上方" : "收盘价位于30周均线下方",
  });
  if (features.breakout26) reasons.push({ tone: "positive", text: "收盘价突破此前26周高点" });
  if (features.breakdown26) reasons.push({ tone: "warning", text: "收盘价跌破此前26周低点" });
  if (!features.breakout26 && !features.breakdown26) {
    reasons.push({ tone: "neutral", text: "尚未出现26周级别的有效突破或破位" });
  }
  return reasons;
}

export function analyzeStages(bars: WeeklyBar[]): StagePoint[] {
  let stableStage: CoreStage | null = null;
  let pendingStage: CoreStage | null = null;
  let pendingWeeks = 0;

  return bars.map((bar, index) => {
    const features = calculateFeatures(bars, index);
    const scores = scoreFeatures(features);
    if (scores === null) {
      return {
        date: bar.date,
        state: "insufficient_data",
        stableStage: null,
        candidateStage: null,
        matchScore: null,
        scores: null,
        features,
        reasons: [],
      };
    }

    const ranked = rankScores(scores);
    const [best, second] = ranked;
    const decisive = best.score >= 54 && best.score - second.score >= 6;
    const candidateStage = decisive ? best.stage : null;

    if (stableStage === null && candidateStage !== null) {
      stableStage = candidateStage;
    }

    let state: StageState = stableStage ? stageKey(stableStage) : "unclear";
    if (stableStage !== null && candidateStage !== null && candidateStage !== stableStage) {
      if (pendingStage === candidateStage) pendingWeeks += 1;
      else {
        pendingStage = candidateStage;
        pendingWeeks = 1;
      }

      const adjacent = isAdjacentTransition(stableStage, candidateStage);
      const forceChange = best.score >= 82 && best.score - second.score >= 18;
      state = adjacent ? transitionState(stableStage, candidateStage) : "unclear";

      if ((adjacent && pendingWeeks >= 2 && best.score >= 58) || forceChange) {
        stableStage = candidateStage;
        pendingStage = null;
        pendingWeeks = 0;
        state = stageKey(stableStage);
      }
    } else if (candidateStage === stableStage) {
      pendingStage = null;
      pendingWeeks = 0;
    } else if (candidateStage === null) {
      // A weak or closely split weekly score is not evidence that the existing
      // market regime ended. Preserve the last confirmed stage until a new,
      // decisive candidate appears; matchScore still communicates uncertainty.
      pendingStage = null;
      pendingWeeks = 0;
      state = stableStage ? stageKey(stableStage) : "unclear";
    }

    return {
      date: bar.date,
      state,
      stableStage,
      candidateStage,
      matchScore: candidateStage ? scores[candidateStage] : best.score,
      scores,
      features,
      reasons: buildReasons(features, candidateStage ?? stableStage),
    };
  });
}
