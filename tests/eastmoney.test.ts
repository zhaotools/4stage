import { describe, expect, it } from "vitest";
import { parseEastmoneyKlines } from "../scripts/eastmoney";

describe("Eastmoney kline parser", () => {
  it("parses and sorts daily OHLCV rows", () => {
    expect(parseEastmoneyKlines([
      "2026-07-21,4.677,4.787,4.789,4.617,27388321",
      "2026-07-20,4.630,4.650,4.685,4.577,40104538",
    ])).toEqual([
      { date: "2026-07-20", open: 4.63, high: 4.685, low: 4.577, close: 4.65, volume: 40104538 },
      { date: "2026-07-21", open: 4.677, high: 4.789, low: 4.617, close: 4.787, volume: 27388321 },
    ]);
  });

  it("rejects impossible OHLC relationships", () => {
    expect(() => parseEastmoneyKlines([
      "2026-07-21,4.677,4.787,4.700,4.617,27388321",
    ])).toThrow("Invalid OHLC relationship");
  });
});
