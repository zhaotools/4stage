import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyze } from "../backend/stage-engine.mjs";

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

assert.deepEqual(
  withIncompleteWeek.current,
  baseline.current,
  "未完成周线不得改变当前阶段判断",
);

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

console.log(`Stage regression passed: ${cases.length} assets + 3 transition guards`);
