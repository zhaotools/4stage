import type { WeeklyBar } from "../domain/types";

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

function mondayKey(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function currentChinaWeekKey(now: Date) {
  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return mondayKey(chinaNow.toISOString().slice(0, 10));
}

export function aggregateWeekly(
  dailyBars: DailyBar[],
  now = new Date(),
  options: { continuousMarket?: boolean; includeIncompleteWeek?: boolean } = {},
): WeeklyBar[] {
  const sorted = [...dailyBars].sort((a, b) => a.date.localeCompare(b.date));
  const groups = new Map<string, DailyBar[]>();
  for (const bar of sorted) {
    const key = mondayKey(bar.date);
    const group = groups.get(key) ?? [];
    group.push(bar);
    groups.set(key, group);
  }

  const result: WeeklyBar[] = [];
  for (const [key, bars] of groups) {
    const first = bars[0];
    const last = bars.at(-1)!;
    result.push({
      date: last.date,
      open: first.open,
      high: Math.max(...bars.map((bar) => bar.high)),
      low: Math.min(...bars.map((bar) => bar.low)),
      close: last.close,
      volume: bars.some((bar) => bar.volume !== null)
        ? bars.reduce((sum, bar) => sum + (bar.volume ?? 0), 0)
        : null,
    });
    void key;
  }

  const chinaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const chinaDay = chinaNow.getUTCDay();
  if (
    !options.includeIncompleteWeek
    && (options.continuousMarket || (chinaDay >= 1 && chinaDay <= 5))
    && result.length > 0
  ) {
    const latest = result.at(-1)!;
    if (mondayKey(latest.date) === currentChinaWeekKey(now)) result.pop();
  }
  return result;
}
