function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sma(bars, index, period) {
  if (index < period - 1) return null;
  return average(bars.slice(index - period + 1, index + 1).map((bar) => bar.close));
}

function rangePosition(bars, index, lookback) {
  const slice = bars.slice(Math.max(0, index - lookback + 1), index + 1);
  const high = Math.max(...slice.map((bar) => bar.high));
  const low = Math.min(...slice.map((bar) => bar.low));
  return high === low ? 0.5 : (bars[index].close - low) / (high - low);
}

function volumeRatio(bars, index) {
  if (index < 10) return 1;
  const current = average(bars.slice(index - 3, index + 1).map((bar) => bar.volume));
  const baseline = average(bars.slice(index - 10, index - 3).map((bar) => bar.volume));
  return baseline > 0 ? current / baseline : 1;
}

function normalizeBars(inputBars) {
  return inputBars
    .map((bar) => ({
      time: String(bar.time || bar.date).slice(0, 10),
      open: Number(bar.open),
      high: Number(bar.high),
      low: Number(bar.low),
      close: Number(bar.close),
      volume: Number(bar.volume || 0),
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function aggregateDailyToWeekly(inputBars) {
  const daily = normalizeBars(inputBars);
  const weeks = [];

  daily.forEach((bar) => {
    const date = new Date(`${bar.time}T00:00:00Z`);
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday);
    const weekKey = date.toISOString().slice(0, 10);
    const current = weeks.at(-1);

    if (!current || current.weekKey !== weekKey) {
      weeks.push({ ...bar, weekKey });
      return;
    }

    current.time = bar.time;
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  });

  return weeks.map(({ weekKey, ...bar }) => bar);
}

function utcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function completedWeeklyBars(inputBars, asset = {}, now = new Date()) {
  const bars = normalizeBars(inputBars);
  const today = utcDay(now);
  const crypto = asset.exchange === "CRYPTO" || asset.category === "加密货币";

  if (crypto) {
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    const currentWeekStart = new Date(today);
    currentWeekStart.setUTCDate(today.getUTCDate() - daysSinceMonday);
    const cutoff = currentWeekStart.toISOString().slice(0, 10);
    return bars.filter((bar) => bar.time < cutoff);
  }

  let daysSinceFriday = (today.getUTCDay() + 2) % 7;
  if (today.getUTCDay() === 5 && now.getUTCHours() < 22) daysSinceFriday = 7;
  const completedFriday = new Date(today);
  completedFriday.setUTCDate(today.getUTCDate() - daysSinceFriday);
  const cutoff = completedFriday.toISOString().slice(0, 10);
  return bars.filter((bar) => bar.time <= cutoff);
}

export function scoreStages(bar, ma10, ma30, slope, position, volume, previous) {
  const distance = bar.close / ma30 - 1;
  const fastDistance = ma10 / ma30 - 1;
  const score = { 1: 0, 2: 0, 3: 0, 4: 0 };

  score[2] += distance > 0.02 ? 3 : distance > 0 ? 1 : 0;
  score[2] += slope > 0.008 ? 3 : slope > 0.002 ? 2 : 0;
  score[2] += fastDistance > 0.01 ? 2 : fastDistance > 0 ? 1 : 0;
  score[2] += position > 0.72 ? 2 : position > 0.55 ? 1 : 0;
  score[2] += volume > 1.15 && distance > 0 ? 1 : 0;

  score[4] += distance < -0.02 ? 3 : distance < 0 ? 1 : 0;
  score[4] += slope < -0.008 ? 3 : slope < -0.002 ? 2 : 0;
  score[4] += fastDistance < -0.01 ? 2 : fastDistance < 0 ? 1 : 0;
  score[4] += position < 0.28 ? 2 : position < 0.45 ? 1 : 0;
  score[4] += volume > 1.15 && distance < 0 ? 1 : 0;

  const flat = Math.abs(slope);
  score[1] += flat < 0.006 ? 3 : flat < 0.012 ? 1 : 0;
  score[1] += Math.abs(distance) < 0.06 ? 2 : 0;
  score[1] += position < 0.58 ? 2 : 0;
  score[1] += previous === 4 || previous === 1 ? 2 : 0;

  score[3] += flat < 0.008 ? 3 : flat < 0.015 ? 1 : 0;
  score[3] += Math.abs(distance) < 0.08 ? 2 : 0;
  score[3] += position > 0.48 ? 2 : 0;
  score[3] += previous === 2 || previous === 3 ? 2 : 0;

  return { score, distance, fastDistance };
}

function chooseStage(score, previous) {
  const ranked = Object.entries(score)
    .map(([stage, value]) => ({ stage: Number(stage), value }))
    .sort((a, b) => b.value - a.value || a.stage - b.stage);
  if (previous && ranked[0].stage !== previous && score[previous] >= ranked[0].value - 1) return previous;
  return ranked[0].stage;
}

function transitionLabel(from, to, type) {
  if (type === "breakdown") return "破位转换";
  if (type === "recovery") return "修复转换";
  return "阶段转换";
}

const REQUIRED_CONFIRMATION_WEEKS = 2;

function transitionEvidence(type, candidate, target, distance, recentSlope) {
  if (type === "breakdown") {
    return distance < 0 && recentSlope !== null && recentSlope <= 0.001;
  }
  if (type === "recovery") {
    return distance > 0 && recentSlope !== null && recentSlope >= -0.001;
  }
  return candidate === target;
}

function transitionInvalidated(type, candidate, target, distance) {
  if (type === "breakdown") return distance >= 0;
  if (type === "recovery") return distance <= 0;
  return candidate !== target;
}

function transitionSnapshot(pending) {
  return {
    from: pending.from,
    to: pending.to,
    type: pending.type,
    label: pending.label,
    startedAt: pending.startedAt,
    confirmationWeeks: pending.confirmationWeeks,
    requiredWeeks: REQUIRED_CONFIRMATION_WEEKS,
  };
}

function percent(value, digits = 2) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function evidenceState(supported, contradicted = false) {
  if (supported) return "support";
  return contradicted ? "warning" : "neutral";
}

function buildStageEvidence(stage, metrics, isTransition) {
  const { distance, slope, fastDistance, position52 } = metrics;
  let evidence;

  if (stage === 2) {
    evidence = [
      {
        label: "价格与MA30",
        value: `${distance >= 0 ? "高于" : "低于"} ${Math.abs(distance * 100).toFixed(2)}%`,
        detail: "S2通常要求价格运行在30周均线上方",
        state: evidenceState(distance > 0, distance <= 0),
      },
      {
        label: "MA30方向",
        value: `5周斜率 ${percent(slope)}`,
        detail: "上升的长期均线代表趋势方向向上",
        state: evidenceState(slope > 0.002, slope < 0),
      },
      {
        label: "10/30周结构",
        value: `MA10 ${fastDistance >= 0 ? "高于" : "低于"} MA30 ${Math.abs(fastDistance * 100).toFixed(2)}%`,
        detail: "中期均线位于长期均线上方支持上涨结构",
        state: evidenceState(fastDistance > 0, fastDistance < 0),
      },
      {
        label: "52周位置",
        value: `区间 ${Math.round(position52 * 100)}%`,
        detail: "位于年度区间中上部更符合趋势发展阶段",
        state: evidenceState(position52 > 0.55, position52 < 0.45),
      },
    ];
  } else if (stage === 4) {
    evidence = [
      {
        label: "价格与MA30",
        value: `${distance < 0 ? "低于" : "高于"} ${Math.abs(distance * 100).toFixed(2)}%`,
        detail: "S4通常表现为价格运行在30周均线下方",
        state: evidenceState(distance < 0, distance >= 0),
      },
      {
        label: "MA30方向",
        value: `5周斜率 ${percent(slope)}`,
        detail: "下降的长期均线代表趋势方向向下",
        state: evidenceState(slope < -0.002, slope > 0),
      },
      {
        label: "10/30周结构",
        value: `MA10 ${fastDistance < 0 ? "低于" : "高于"} MA30 ${Math.abs(fastDistance * 100).toFixed(2)}%`,
        detail: "中期均线位于长期均线下方支持下降结构",
        state: evidenceState(fastDistance < 0, fastDistance > 0),
      },
      {
        label: "52周位置",
        value: `区间 ${Math.round(position52 * 100)}%`,
        detail: "位于年度区间中下部更符合风险释放阶段",
        state: evidenceState(position52 < 0.45, position52 > 0.55),
      },
    ];
  } else {
    const bottom = stage === 1;
    evidence = [
      {
        label: "MA30形态",
        value: `5周斜率 ${percent(slope)}`,
        detail: "横盘阶段的重要特征是长期均线逐渐走平",
        state: evidenceState(Math.abs(slope) < (bottom ? 0.012 : 0.015), Math.abs(slope) >= 0.02),
      },
      {
        label: "价格与MA30",
        value: `偏离 ${percent(distance)}`,
        detail: "价格围绕长期均线震荡，而非远离均线单边运行",
        state: evidenceState(Math.abs(distance) < (bottom ? 0.06 : 0.08), Math.abs(distance) >= 0.12),
      },
      {
        label: "52周位置",
        value: `区间 ${Math.round(position52 * 100)}%`,
        detail: bottom ? "偏低位置的横盘更接近底部构筑" : "偏高位置的横盘更接近顶部构筑",
        state: bottom
          ? evidenceState(position52 < 0.58, position52 > 0.72)
          : evidenceState(position52 > 0.48, position52 < 0.35),
      },
      {
        label: "10/30周收敛",
        value: `偏离 ${percent(fastDistance)}`,
        detail: "中长期均线靠近，说明单边趋势动能正在减弱",
        state: evidenceState(Math.abs(fastDistance) < 0.03, Math.abs(fastDistance) >= 0.06),
      },
    ];
  }

  const supporting = evidence.filter((item) => item.state === "support").map((item) => item.label);
  const warnings = evidence.filter((item) => item.state === "warning").map((item) => item.label);
  const summary = [
    supporting.length
      ? `主要支持证据来自${supporting.join("、")}。`
      : "当前核心条件尚未形成一致支持。",
    warnings.length ? `${warnings.join("、")}仍与目标阶段存在分歧。` : "",
    isTransition ? "当前仍是转换状态，需要后续完整周线继续确认。" : "",
  ].join("");

  return { evidence, summary };
}

export function analyze(inputBars, asset = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const allSource = normalizeBars(inputBars);
  const source = completedWeeklyBars(allSource, asset, now);
  let confirmedStage = null;
  let pending = null;

  const bars = source.map((bar, index) => {
    const ma10 = sma(source, index, 10);
    const ma30 = sma(source, index, 30);
    const oldMa30 = index >= 34 ? sma(source, index - 5, 30) : null;
    const priorMa30 = index >= 30 ? sma(source, index - 1, 30) : null;
    if (ma10 === null || ma30 === null || oldMa30 === null) {
      return { ...bar, ma30, slope: null, recentSlope: null, stage: null, transition: null };
    }

    const slope = ma30 / oldMa30 - 1;
    const recentSlope = priorMa30 ? ma30 / priorMa30 - 1 : null;
    const position = rangePosition(source, index, 52);
    const volume = volumeRatio(source, index);
    const metrics = scoreStages(bar, ma10, ma30, slope, position, volume, confirmedStage);
    let candidate = chooseStage(metrics.score, confirmedStage);
    let forcedType = null;
    let stage = candidate;
    let transition = null;

    const hardBreakdown = metrics.distance <= -0.05;
    const hardRecovery = metrics.distance >= 0.05;

    if ((confirmedStage === 2 || candidate === 2) && hardBreakdown) {
      candidate = 4;
      forcedType = "breakdown";
    } else if ((confirmedStage === 4 || candidate === 4) && hardRecovery) {
      candidate = 2;
      forcedType = "recovery";
    }

    if (confirmedStage === null) {
      confirmedStage = candidate;
      stage = confirmedStage;
    } else if (pending) {
      if (transitionInvalidated(pending.type, candidate, pending.to, metrics.distance)) {
        pending = null;
        if (candidate !== confirmedStage) {
          const type = forcedType || "normal";
          pending = {
            from: confirmedStage,
            to: candidate,
            type,
            label: transitionLabel(confirmedStage, candidate, type),
            startedAt: bar.time,
            confirmationWeeks: transitionEvidence(type, candidate, candidate, metrics.distance, recentSlope) ? 1 : 0,
          };
          stage = candidate;
          transition = transitionSnapshot(pending);
        } else {
          stage = confirmedStage;
        }
      } else {
        const hasEvidence = transitionEvidence(
          pending.type,
          candidate,
          pending.to,
          metrics.distance,
          recentSlope,
        );
        pending.confirmationWeeks = hasEvidence ? pending.confirmationWeeks + 1 : 0;
        if (pending.confirmationWeeks >= REQUIRED_CONFIRMATION_WEEKS) {
          confirmedStage = pending.to;
          pending = null;
          stage = confirmedStage;
        } else {
          stage = pending.to;
          transition = transitionSnapshot(pending);
        }
      }
    } else if (candidate !== confirmedStage) {
      const type = forcedType || "normal";
      pending = {
        from: confirmedStage,
        to: candidate,
        type,
        label: transitionLabel(confirmedStage, candidate, type),
        startedAt: bar.time,
        confirmationWeeks: transitionEvidence(type, candidate, candidate, metrics.distance, recentSlope) ? 1 : 0,
      };
      stage = candidate;
      transition = transitionSnapshot(pending);
    } else {
      stage = confirmedStage;
    }

    return {
      ...bar,
      ma30,
      slope,
      recentSlope,
      stage,
      transition,
      scores: metrics.score,
      distance: metrics.distance,
      fastDistance: metrics.fastDistance,
      position52: position,
      volumeRatio: volume,
    };
  });

  const latest = bars.at(-1);
  if (!latest?.stage || !latest.ma30) throw new Error("至少需要35根完整周线");
  const distance = latest.close / latest.ma30 - 1;
  const position = rangePosition(source, source.length - 1, 52);
  const fit = latest.stage === 2
    ? Math.max(0, latest.slope) + Math.max(0, distance)
    : latest.stage === 4
      ? Math.max(0, -latest.slope) + Math.max(0, -distance)
      : Math.max(0, 0.025 - Math.abs(latest.slope)) + Math.max(0, 0.08 - Math.abs(distance));
  const confidence = Math.round(Math.max(55, Math.min(94, 61 + fit * 220 + Math.abs(position - 0.5) * 12)));
  const displayBars = [...bars];
  allSource.forEach((bar, index) => {
    if (bar.time <= latest.time) return;
    const ma30 = sma(allSource, index, 30);
    displayBars.push({
      ...bar,
      ma30,
      slope: null,
      recentSlope: null,
      stage: latest.stage,
      transition: null,
      scores: null,
      distance: ma30 ? bar.close / ma30 - 1 : null,
      position52: rangePosition(allSource, index, 52),
      volumeRatio: volumeRatio(allSource, index),
      provisional: true,
    });
  });
  const latestMarketBar = displayBars.at(-1);
  const latestDistance = latestMarketBar.ma30
    ? latestMarketBar.close / latestMarketBar.ma30 - 1
    : null;
  const explanation = buildStageEvidence(
    latest.stage,
    {
      distance,
      slope: latest.slope,
      fastDistance: latest.fastDistance,
      position52: position,
    },
    Boolean(latest.transition),
  );

  return {
    bars: displayBars,
    current: {
      stage: latest.stage,
      status: latest.transition ? "transition" : "confirmed",
      transition: latest.transition,
      close: latest.close,
      ma30: latest.ma30,
      slope: latest.slope,
      recentSlope: latest.recentSlope,
      distance,
      position52: position,
      volumeRatio: latest.volumeRatio,
      scores: latest.scores,
      evidence: explanation.evidence,
      explanation: explanation.summary,
      confidence,
      asOf: latest.time,
      usesCompletedWeek: true,
      latestClose: latestMarketBar.close,
      latestMa30: latestMarketBar.ma30,
      latestDistance,
      latestAsOf: latestMarketBar.time,
      hasProvisionalBar: latestMarketBar.time !== latest.time,
    },
  };
}
