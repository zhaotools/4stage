import type {
  CoreStage,
  StageFeatures,
  StagePoint,
  StageReason,
  StageScores,
  StageState,
  StageTransitionCheck,
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

const nextStage = (stage: CoreStage): CoreStage =>
  stage === 4 ? 1 : (stage + 1) as CoreStage;

const transitionState = (from: CoreStage, to: CoreStage): StageState => {
  if (from === 1 && to === 2) return "stage_1_to_2";
  if (from === 2 && to === 3) return "stage_2_to_3";
  if (from === 3 && to === 4) return "stage_3_to_4";
  if (from === 4 && to === 1) return "stage_4_to_1";
  return "unclear";
};

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

interface TransitionEvaluation {
  target: CoreStage;
  checks: StageTransitionCheck[];
  structuralReady: boolean;
  confirmed: boolean;
}

const valueText = (value: number | null, digits = 2) =>
  value === null ? "数据不足" : value.toFixed(digits);

function structuralTransitionChecks(
  from: CoreStage,
  features: StageFeatures,
): StageTransitionCheck[] {
  const slope = features.normalizedSlope;
  const distance = features.priceDistance;
  const momentum = features.momentum13;
  const consolidation = features.consolidationScore;
  const range = features.rangePosition52;
  const slopeImprovement = slope === null || features.previousSlope === null
    ? null
    : slope - features.previousSlope;

  if (from === 1) {
    return [
      {
        key: "above_ma30",
        label: "有效站上30周均线",
        detail: `当前距离 ${valueText(distance)} ATR，要求 ≥ 0.50 ATR`,
        passed: distance !== null && distance >= 0.5,
      },
      {
        key: "ma30_rising",
        label: "30周均线转为上升",
        detail: `当前斜率 ${valueText(slope, 3)}，要求 ≥ 0.020`,
        passed: slope !== null && slope >= 0.02,
      },
      {
        key: "upside_confirmation",
        label: "向上突破得到确认",
        detail: features.breakout26
          ? "已突破过去26周高点"
          : `13周动能 ${valueText(momentum === null ? null : momentum * 100, 1)}%，要求 ≥ 12%`,
        passed: features.breakout26 || (momentum !== null && momentum >= 0.12),
      },
    ];
  }

  if (from === 2) {
    return [
      {
        key: "ma30_flat",
        label: "30周均线明显走平",
        detail: `当前斜率 ${valueText(slope, 3)}，要求在 -0.045～0.045`,
        passed: slope !== null && Math.abs(slope) <= 0.045,
      },
      {
        key: "high_consolidation",
        label: "形成高位横盘结构",
        detail: `横盘成立度 ${consolidation ?? "—"}/100，要求 ≥ 55`,
        passed: consolidation !== null && consolidation >= 55,
      },
      {
        key: "upper_range",
        label: "仍处于52周高位区域",
        detail: `当前位置 ${range === null ? "—" : `${Math.round(range * 100)}%`}，要求 ≥ 60%`,
        passed: range !== null && range >= 0.6,
      },
      {
        key: "not_broken",
        label: "尚未发生深度破位",
        detail: `距离30周均线 ${valueText(distance)} ATR，要求 > -1.00 ATR`,
        passed: distance !== null && distance > -1,
      },
    ];
  }

  if (from === 3) {
    return [
      {
        key: "below_ma30",
        label: "有效跌破30周均线",
        detail: `当前距离 ${valueText(distance)} ATR，要求 ≤ -0.50 ATR`,
        passed: distance !== null && distance <= -0.5,
      },
      {
        key: "negative_momentum",
        label: "中期动能转负",
        detail: `13周动能 ${valueText(momentum === null ? null : momentum * 100, 1)}%，要求 ≤ -8%`,
        passed: momentum !== null && momentum <= -0.08,
      },
      {
        key: "downside_confirmation",
        label: "下跌结构得到确认",
        detail: features.breakdown26
          ? "已跌破过去26周低点"
          : `30周均线斜率 ${valueText(slope, 3)}，要求 ≤ -0.020`,
        passed: features.breakdown26 || (slope !== null && slope <= -0.02),
      },
    ];
  }

  return [
    {
      key: "ma30_stabilizing",
      label: "30周均线下降趋缓",
      detail: `当前斜率 ${valueText(slope, 3)}，要求 ≥ -0.040`,
      passed: slope !== null && slope >= -0.04,
    },
    {
      key: "slope_improving",
      label: "均线斜率持续改善",
      detail: `较前值改善 ${valueText(slopeImprovement, 3)}，要求 ≥ 0.020`,
      passed: slopeImprovement !== null && slopeImprovement >= 0.02,
    },
    {
      key: "low_consolidation",
      label: "形成低位横盘结构",
      detail: `横盘成立度 ${consolidation ?? "—"}/100，要求 ≥ 50`,
      passed: consolidation !== null && consolidation >= 50,
    },
    {
      key: "no_new_low",
      label: "价格停止创新低",
      detail: features.breakdown26 ? "本周仍在跌破26周低点" : "本周未跌破26周低点",
      passed: !features.breakdown26,
    },
  ];
}

function evaluateTransition(
  from: CoreStage,
  featureHistory: StageFeatures[],
  consecutiveWeeks: number,
  stageAdvance: number,
): TransitionEvaluation {
  const currentFeatures = featureHistory.at(-1) ?? emptyFeatures();
  const structuralChecks = structuralTransitionChecks(from, currentFeatures);
  const structuralReady = structuralChecks.every((check) => check.passed);
  const target = nextStage(from);

  if (from === 4) {
    const recoveryChecks: StageTransitionCheck[] = [
      {
        key: "recovery_above_ma30",
        label: "价格强势站回30周均线",
        detail: `当前距离 ${valueText(currentFeatures.priceDistance)} ATR，要求 ≥ 0.50 ATR`,
        passed: currentFeatures.priceDistance !== null && currentFeatures.priceDistance >= 0.5,
      },
      {
        key: "recovery_ma30_rising",
        label: "30周均线重新上升",
        detail: `当前斜率 ${valueText(currentFeatures.normalizedSlope, 3)}，要求 ≥ 0.040`,
        passed: currentFeatures.normalizedSlope !== null && currentFeatures.normalizedSlope >= 0.04,
      },
      {
        key: "recovery_momentum",
        label: "中期上涨动能恢复",
        detail: `13周动能 ${valueText(currentFeatures.momentum13 === null ? null : currentFeatures.momentum13 * 100, 1)}%，要求 ≥ 8%`,
        passed: currentFeatures.momentum13 !== null && currentFeatures.momentum13 >= 0.08,
      },
    ];
    const recoveryReady = recoveryChecks.every((check) => check.passed);
    let recoveryWeeks = 0;
    for (let index = featureHistory.length - 1; index >= 0; index -= 1) {
      const features = featureHistory[index];
      if (
        features.priceDistance !== null && features.priceDistance >= 0.5
        && features.normalizedSlope !== null && features.normalizedSlope >= 0.04
        && features.momentum13 !== null && features.momentum13 >= 0.08
      ) recoveryWeeks += 1;
      else break;
    }
    if (recoveryReady) {
      const confirmationCheck: StageTransitionCheck = {
        key: "recovery_confirmation",
        label: "强势修复连续确认",
        detail: `已连续满足 ${Math.min(recoveryWeeks, 2)}/2 周`,
        passed: recoveryWeeks >= 2,
      };
      return {
        target,
        structuralReady: true,
        confirmed: confirmationCheck.passed,
        checks: [...recoveryChecks, confirmationCheck],
      };
    }
  }

  if (from === 1 || from === 3 || from === 4) {
    const requiredWeeks = 2;
    const confirmationCheck: StageTransitionCheck = {
      key: "consecutive_confirmation",
      label: "连续周线确认",
      detail: `已连续满足 ${Math.min(consecutiveWeeks, requiredWeeks)}/${requiredWeeks} 周`,
      passed: consecutiveWeeks >= requiredWeeks,
    };
    return {
      target,
      structuralReady,
      confirmed: structuralReady && confirmationCheck.passed,
      checks: [...structuralChecks, confirmationCheck],
    };
  }

  const recent = featureHistory.slice(-8);
  const emergencyChecks: StageTransitionCheck[] = [
    {
      key: "sharp_ma30_break",
      label: "价格快速跌破30周均线",
      detail: `当前距离 ${valueText(currentFeatures.priceDistance)} ATR，要求 ≤ -0.50 ATR`,
      passed: currentFeatures.priceDistance !== null && currentFeatures.priceDistance <= -0.5,
    },
    {
      key: "sharp_momentum_loss",
      label: "中期动能快速转弱",
      detail: `13周动能 ${valueText(currentFeatures.momentum13 === null ? null : currentFeatures.momentum13 * 100, 1)}%，要求 ≤ -8%`,
      passed: currentFeatures.momentum13 !== null && currentFeatures.momentum13 <= -0.08,
    },
    {
      key: "bearish_structure",
      label: "成熟上涨或长期结构转弱",
      detail: stageAdvance >= 0.25
        ? `Stage 2 阶段内最高涨幅已达 ${valueText(stageAdvance * 100, 1)}%`
        : currentFeatures.breakdown26
          ? "已跌破过去26周低点"
          : `阶段最高涨幅不足25%，且30周均线斜率 ${valueText(currentFeatures.normalizedSlope, 3)}，要求 ≤ -0.020`,
      passed: stageAdvance >= 0.25 || currentFeatures.breakdown26
        || (currentFeatures.normalizedSlope !== null && currentFeatures.normalizedSlope <= -0.02),
    },
  ];
  const emergencyReady = emergencyChecks.every((check) => check.passed);
  let emergencyWeeks = 0;
  for (let index = featureHistory.length - 1; index >= 0; index -= 1) {
    const features = featureHistory[index];
    if (
      features.priceDistance !== null && features.priceDistance <= -0.5
      && features.momentum13 !== null && features.momentum13 <= -0.08
      && (
        stageAdvance >= 0.25
        || features.breakdown26
        || (features.normalizedSlope !== null && features.normalizedSlope <= -0.02)
      )
    ) emergencyWeeks += 1;
    else break;
  }
  if (emergencyReady) {
    const confirmationCheck: StageTransitionCheck = {
      key: "emergency_confirmation",
      label: "快速破位连续确认",
      detail: `已连续满足 ${Math.min(emergencyWeeks, 2)}/2 周`,
      passed: emergencyWeeks >= 2,
    };
    return {
      target,
      structuralReady: true,
      confirmed: confirmationCheck.passed,
      checks: [...emergencyChecks, confirmationCheck],
    };
  }

  const qualifyingWeeks = recent.filter((features) =>
    structuralTransitionChecks(from, features).every((check) => check.passed),
  ).length;
  const maturityCheck: StageTransitionCheck = {
    key: "mature_advance",
    label: "上涨阶段已充分展开",
    detail: `Stage 2 阶段内最高涨幅 ${valueText(stageAdvance * 100, 1)}%，要求 ≥ 25%`,
    passed: stageAdvance >= 0.25,
  };
  const confirmationCheck: StageTransitionCheck = {
    key: "rolling_confirmation",
    label: from === 2 ? "高位结构持续形成" : "底部结构持续形成",
    detail: `最近${recent.length}周满足 ${qualifyingWeeks} 周，要求至少 5/8 周`,
    passed: recent.length >= 8 && qualifyingWeeks >= 5,
  };
  return {
    target,
    structuralReady: structuralReady && maturityCheck.passed,
    confirmed: structuralReady && maturityCheck.passed && confirmationCheck.passed,
    checks: [...structuralChecks, maturityCheck, confirmationCheck],
  };
}

const transitionProgress = (checks: StageTransitionCheck[]) =>
  checks.length === 0
    ? null
    : Math.round(100 * checks.filter((check) => check.passed).length / checks.length);

export function analyzeStages(bars: WeeklyBar[]): StagePoint[] {
  let stableStage: CoreStage | null = null;
  let stableStageStartClose: number | null = null;
  let stableStagePeakClose: number | null = null;
  let pendingWeeks = 0;
  const featureHistory: StageFeatures[] = [];

  return bars.map((bar, index) => {
    const features = calculateFeatures(bars, index);
    featureHistory.push(features);
    const baseScores = scoreFeatures(features);
    if (baseScores === null) {
      return {
        date: bar.date,
        state: "insufficient_data",
        stableStage: null,
        candidateStage: null,
        nextStage: null,
        transitionProgress: null,
        transitionChecks: [],
        matchScore: null,
        scores: null,
        features,
        reasons: [],
      };
    }

    const scores: StageScores = baseScores;
    const ranked = rankScores(scores);
    const [best, second] = ranked;
    const decisive = best.score >= 54 && best.score - second.score >= 6;
    const rawCandidate = decisive ? best.stage : null;

    if (stableStage === null && rawCandidate !== null) {
      stableStage = rawCandidate;
      stableStageStartClose = bar.close;
      stableStagePeakClose = bar.close;
    }

    if (stableStage === null) {
      return {
        date: bar.date,
        state: "unclear",
        stableStage: null,
        candidateStage: null,
        nextStage: null,
        transitionProgress: null,
        transitionChecks: [],
        matchScore: best.score,
        scores,
        features,
        reasons: [],
      };
    }

    stableStagePeakClose = Math.max(stableStagePeakClose ?? bar.close, bar.close);
    const stageAdvance = stableStageStartClose === null
      ? 0
      : stableStagePeakClose / stableStageStartClose - 1;
    let evaluation = evaluateTransition(stableStage, featureHistory, pendingWeeks, stageAdvance);
    if (stableStage === 1 || stableStage === 3 || stableStage === 4) {
      pendingWeeks = evaluation.structuralReady ? pendingWeeks + 1 : 0;
      evaluation = evaluateTransition(stableStage, featureHistory, pendingWeeks, stageAdvance);
    } else {
      pendingWeeks = 0;
    }

    let candidateStage: CoreStage | null = evaluation.structuralReady ? evaluation.target : null;
    let state: StageState = evaluation.structuralReady
      ? transitionState(stableStage, evaluation.target)
      : stageKey(stableStage);

    if (evaluation.confirmed) {
      stableStage = evaluation.target;
      stableStageStartClose = bar.close;
      stableStagePeakClose = bar.close;
      pendingWeeks = 0;
      candidateStage = null;
      state = stageKey(stableStage);
      evaluation = evaluateTransition(stableStage, featureHistory, 0, 0);
    }

    return {
      date: bar.date,
      state,
      stableStage,
      candidateStage,
      nextStage: evaluation.target,
      transitionProgress: transitionProgress(evaluation.checks),
      transitionChecks: evaluation.checks,
      matchScore: scores[stableStage],
      scores,
      features,
      reasons: buildReasons(features, stableStage),
    };
  });
}
