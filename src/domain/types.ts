export type CoreStage = 1 | 2 | 3 | 4;

export type StageState =
  | "stage_1"
  | "stage_1_to_2"
  | "stage_2"
  | "stage_2_to_3"
  | "stage_3"
  | "stage_3_to_4"
  | "stage_4"
  | "stage_4_to_1"
  | "stage_4_to_2"
  | "unclear"
  | "insufficient_data";

export interface WeeklyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface StageScores {
  1: number;
  2: number;
  3: number;
  4: number;
}

export interface StageFeatures {
  sma30: number | null;
  atr20: number | null;
  normalizedSlope: number | null;
  previousSlope: number | null;
  consolidationScore: number | null;
  priorTrend: "up" | "down" | "mixed" | null;
  priorTrendQuality: number | null;
  priorTrendSlope: number | null;
  priorTrendReturn13: number | null;
  priorTrendReturn26: number | null;
  priorTrendReturn39: number | null;
  priceDistance: number | null;
  rangePosition52: number | null;
  momentum13: number | null;
  breakout26: boolean;
  breakdown26: boolean;
  volumeRatio: number | null;
  volatilityRatio: number | null;
}

export interface StageReason {
  tone: "positive" | "warning" | "neutral";
  text: string;
}

export interface StagePoint {
  date: string;
  state: StageState;
  stableStage: CoreStage | null;
  candidateStage: CoreStage | null;
  matchScore: number | null;
  scores: StageScores | null;
  features: StageFeatures;
  reasons: StageReason[];
}

export interface AssetSummary {
  symbol: string;
  name: string;
  assetType: "stock" | "etf" | "index" | "crypto" | "crypto_stock" | "us_stock" | "us_etf";
  exchange: "SSE" | "SZSE" | "CRYPTO" | "NASDAQ" | "NYSE" | "NYSEARCA";
  benchmark: string;
  category?: string;
  industry?: string;
  indexMemberships?: string[];
  listDate?: string;
  searchTerms?: string[];
  dataStatus: "sample" | "live";
  dataSource?: "eastmoney" | "tushare" | "yahoo" | "sample";
}

export interface AssetAnalysis extends AssetSummary {
  generatedAt: string;
  bars: WeeklyBar[];
  stages: StagePoint[];
}

export type StageHistoryPoint = Pick<StagePoint, "date" | "state">;

export interface PublishedAssetAnalysis extends Omit<AssetAnalysis, "stages"> {
  stages: Array<StageHistoryPoint | StagePoint>;
}
