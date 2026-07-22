import { describe, expect, it } from "vitest";
import { aggregateWeekly, type DailyBar } from "../src/data/weekly";

const bar = (date: string, close: number): DailyBar => ({
  date,
  open: close - 0.2,
  high: close + 0.3,
  low: close - 0.4,
  close,
  volume: 100,
});

describe("daily to weekly aggregation", () => {
  it("uses the first open, last close, extrema and summed volume", () => {
    const result = aggregateWeekly(
      [bar("2026-07-13", 10), bar("2026-07-14", 11), bar("2026-07-17", 12)],
      new Date("2026-07-18T12:00:00Z"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ date: "2026-07-17", open: 9.8, close: 12, high: 12.3, low: 9.6, volume: 300 });
  });

  it("drops the current partial week on a weekday", () => {
    const result = aggregateWeekly(
      [bar("2026-07-13", 10), bar("2026-07-20", 11), bar("2026-07-21", 12)],
      new Date("2026-07-21T06:00:00Z"),
    );
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-07-13");
  });
});
