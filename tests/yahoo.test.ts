import { describe, expect, it } from "vitest";
import { parseYahooChart } from "../scripts/yahoo";

describe("Yahoo chart adapter", () => {
  it("uses adjusted close consistently across OHLC and skips null rows", () => {
    const bars = parseYahooChart({
      chart: {
        result: [{
          timestamp: [1_704_067_200, 1_704_153_600],
          indicators: {
            quote: [{
              open: [100, null], high: [110, null], low: [90, null], close: [105, null], volume: [20, null],
            }],
            adjclose: [{ adjclose: [52.5, null] }],
          },
        }],
      },
    });
    expect(bars).toEqual([{
      date: "2024-01-01", open: 50, high: 55, low: 45, close: 52.5, volume: 20,
    }]);
  });
});
