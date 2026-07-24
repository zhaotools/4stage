import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aggregateDailyToWeekly, analyze } from "../backend/stage-engine.mjs";

const NOW = "2026-07-23T22:37:00Z";
const LAST_COMPLETE_WEEK = "2026-07-17";

const cases = [
  { symbol: "512100.SH", stage: 4, status: "transition", transition: [2, 4, "breakdown", 1, 2] },
  { symbol: "510500.SH", stage: 4, status: "transition", transition: [2, 4, "breakdown", 0, 2] },
  { symbol: "510300.SH", stage: 2, status: "confirmed" },
  { symbol: "588000.SH", stage: 2, status: "confirmed" },
  { symbol: "510880.SH", stage: 1, status: "transition", transition: [4, 1, "normal", 1, 2] },
  { symbol: "159915.SZ", stage: 2, status: "confirmed" },
  { symbol: "000300.SH", stage: 3, status: "transition", transition: [2, 3, "normal", 1, 2] },
  { symbol: "000001.SH", stage: 3, status: "confirmed" },
  { symbol: "300750.SZ", stage: 3, status: "confirmed" },
  { symbol: "600030.SH", stage: 3, status: "transition", transition: [2, 3, "normal", 1, 2] },
  { symbol: "601088.SH", stage: 1, status: "confirmed" },
  { symbol: "159611.SZ", stage: 1, status: "confirmed" },
  { symbol: "159819.SZ", stage: 2, status: "confirmed" },
  { symbol: "512480.SH", stage: 2, status: "confirmed" },
  { symbol: "518880.SH", stage: 4, status: "confirmed" },
];

async function load(symbol) {
  return JSON.parse(await readFile(new URL(`../data/${symbol}.json`, import.meta.url)));
}

function exchangeFor(symbol) {
  return symbol.endsWith(".SZ") ? "SZSE" : "SSE";
}

for (const expected of cases) {
  const data = await load(expected.symbol);
  const result = analyze(
    data.bars,
    { symbol: expected.symbol, exchange: exchangeFor(expected.symbol) },
    { now: NOW },
  );
  const current = result.current;

  assert.equal(current.asOf, LAST_COMPLETE_WEEK, `${expected.symbol}: 必须只使用完整周线`);
  assert.equal(current.usesCompletedWeek, true, `${expected.symbol}: 缺少完整周线标志`);
  assert.equal(current.stage, expected.stage, `${expected.symbol}: 当前阶段回归失败`);
  assert.equal(current.status, expected.status, `${expected.symbol}: 转换状态回归失败`);
  assert.equal(current.evidence.length, 4, `${expected.symbol}: 应输出4条核心阶段证据`);
  assert.equal(new Set(current.evidence.map((item) => item.label)).size, 4, `${expected.symbol}: 阶段证据不得重复`);
  assert.ok(current.explanation.length > 10, `${expected.symbol}: 缺少阶段解释结论`);
  current.evidence.forEach((item) => {
    assert.ok(["support", "neutral", "warning"].includes(item.state), `${expected.symbol}: 非法证据状态`);
    assert.ok(item.label && item.value && item.detail, `${expected.symbol}: 阶段证据字段不完整`);
  });

  if (current.stage === 2) {
    assert.equal(
      current.evidence[0].state,
      current.distance > 0 ? "support" : "warning",
      `${expected.symbol}: S2价格位置证据与完整周线不一致`,
    );
  }
  if (current.stage === 4) {
    assert.equal(
      current.evidence[0].state,
      current.distance < 0 ? "support" : "warning",
      `${expected.symbol}: S4价格位置证据与完整周线不一致`,
    );
  }

  if (expected.transition) {
    assert.ok(current.transition, `${expected.symbol}: 应存在阶段转换`);
    assert.deepEqual(
      [
        current.transition.from,
        current.transition.to,
        current.transition.type,
        current.transition.confirmationWeeks,
        current.transition.requiredWeeks,
      ],
      expected.transition,
      `${expected.symbol}: 阶段转换方向错误`,
    );
  } else {
    assert.equal(current.transition, null, `${expected.symbol}: 不应存在阶段转换`);
  }

  for (const bar of result.bars.filter((item) => item.stage)) {
    assert.ok(
      !(bar.stage === 2 && bar.distance <= -0.05),
      `${expected.symbol} ${bar.time}: S2 不得与显著跌破MA30同时成立`,
    );
    assert.ok(
      !(bar.stage === 4 && bar.distance >= 0.05),
      `${expected.symbol} ${bar.time}: S4 不得与显著站上MA30同时成立`,
    );
  }
}

const incompleteWeekSource = await load("512100.SH");
const baseline = analyze(
  incompleteWeekSource.bars,
  { symbol: "512100.SH", exchange: "SSE" },
  { now: NOW },
);
const withIncompleteWeek = analyze(
  [
    ...incompleteWeekSource.bars,
    {
      date: "2026-07-23",
      open: 2.9,
      high: 9.9,
      low: 0.1,
      close: 9.5,
      volume: 999999999,
    },
  ],
  { symbol: "512100.SH", exchange: "SSE" },
  { now: NOW },
);

for (const key of ["stage", "status", "transition", "close", "ma30", "slope", "distance", "confidence", "evidence", "explanation", "asOf"]) {
  assert.deepEqual(
    withIncompleteWeek.current[key],
    baseline.current[key],
    `未完成周线不得改变阶段字段 current.${key}`,
  );
}
assert.equal(withIncompleteWeek.current.latestAsOf, "2026-07-23", "K线应展示最新未完成周线");
assert.equal(withIncompleteWeek.current.latestClose, 9.5, "最新价格应来自最新未完成周线");
assert.equal(withIncompleteWeek.current.hasProvisionalBar, true, "应标记存在展示用未完成周线");
assert.equal(withIncompleteWeek.bars.at(-1).provisional, true, "最新K线应标记为展示数据");
assert.equal(withIncompleteWeek.bars.at(-1).time, "2026-07-23", "最新K线日期错误");

const nextCompleteBreakdown = analyze(
  [
    ...incompleteWeekSource.bars,
    {
      date: "2026-07-24",
      open: 2.9,
      high: 2.94,
      low: 2.75,
      close: 2.8,
      volume: 100000000,
    },
  ],
  { symbol: "512100.SH", exchange: "SSE" },
  { now: "2026-07-25T23:00:00Z" },
);

assert.equal(nextCompleteBreakdown.current.stage, 4, "连续破位周线应确认S4");
assert.equal(nextCompleteBreakdown.current.status, "confirmed", "第二根有效完整周线后应结束转换状态");
assert.equal(nextCompleteBreakdown.current.transition, null, "确认S4后不应继续显示待确认转换");

const invalidatedBreakdown = analyze(
  [
    ...incompleteWeekSource.bars,
    {
      date: "2026-07-24",
      open: 2.9,
      high: 3.7,
      low: 2.85,
      close: 3.6,
      volume: 100000000,
    },
  ],
  { symbol: "512100.SH", exchange: "SSE" },
  { now: "2026-07-25T23:00:00Z" },
);

assert.equal(invalidatedBreakdown.current.stage, 2, "重新站回MA30应取消S2到S4转换");
assert.equal(invalidatedBreakdown.current.status, "confirmed", "转换失效后应恢复原确认阶段");
assert.equal(invalidatedBreakdown.current.transition, null, "失效转换不应残留");

const aggregatedWeeks = aggregateDailyToWeekly([
  { date: "2026-07-13", open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { date: "2026-07-14", open: 11, high: 13, low: 10, close: 12, volume: 120 },
  { date: "2026-07-17", open: 12, high: 14, low: 8, close: 9, volume: 140 },
  { date: "2026-07-20", open: 9, high: 10, low: 8, close: 9.5, volume: 160 },
  { date: "2026-07-23", open: 9.5, high: 11, low: 9, close: 10.5, volume: 180 },
]);

assert.deepEqual(
  aggregatedWeeks,
  [
    { time: "2026-07-17", open: 10, high: 14, low: 8, close: 9, volume: 360 },
    { time: "2026-07-23", open: 9, high: 11, low: 8, close: 10.5, volume: 340 },
  ],
  "日线必须正确聚合为包含本周最新交易日的周K",
);

console.log(`Stage regression passed: ${cases.length} assets + evidence checks + 5 transition/data guards`);
