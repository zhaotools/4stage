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
  return `${from}→${to}转换`;
}

export function analyze(inputBars, asset = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const source = completedWeeklyBars(inputBars, asset, now);
  let previous = null;

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
    const metrics = scoreStages(bar, ma10, ma30, slope, position, volume, previous);
    let stage = chooseStage(metrics.score, previous);
    let transition = null;

    const hardBreakdown = metrics.distance <= -0.05;
    const hardRecovery = metrics.distance >= 0.05;

    if ((previous === 2 || stage === 2) && hardBreakdown) {
      transition = { from: previous || 2, to: 4, type: "breakdown", label: transitionLabel(previous || 2, 4, "breakdown") };
      stage = 4;
    } else if ((previous === 4 || stage === 4) && hardRecovery) {
      transition = { from: previous || 4, to: 2, type: "recovery", label: transitionLabel(previous || 4, 2, "recovery") };
      stage = 2;
    } else if (previous && stage !== previous) {
      transition = { from: previous, to: stage, type: "normal", label: transitionLabel(previous, stage, "normal") };
    }

    previous = stage;
    return {
      ...bar,
      ma30,
      slope,
      recentSlope,
      stage,
      transition,
      scores: metrics.score,
      distance: metrics.distance,
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

  return {
    bars,
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
      confidence,
      asOf: latest.time,
      usesCompletedWeek: true,
    },
  };
}
