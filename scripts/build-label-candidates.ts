import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssetAnalysis, AssetSummary, StagePoint, WeeklyBar } from "../src/domain/types";

type SamplingBucket = "decline_to_flat" | "advance_to_flat" | "mixed_flat";

export interface Stage13Candidate {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  date: string;
  samplingBucket: SamplingBucket;
  bars: WeeklyBar[];
  features: Pick<StagePoint["features"], "consolidationScore" | "priorTrend" | "priorTrendQuality" | "priorTrendSlope" | "priorTrendReturn13" | "priorTrendReturn26" | "priorTrendReturn39" | "rangePosition52">;
}

interface CandidateFile {
  schemaVersion: 1;
  generatedAt: string;
  protocol: string;
  candidates: Stage13Candidate[];
}

const inputDirectory = join(process.cwd(), "public", "data");
const outputPath = join(inputDirectory, "stage13-candidates.json");
const validationOutputPath = join(inputDirectory, "stage13-validation-candidates.json");
const validationV3OutputPath = join(inputDirectory, "stage13-validation-v3-candidates.json");
const perAssetPerBucket = Number(process.env.LABEL_CANDIDATES_PER_ASSET ?? 3);
const spacingWeeks = Number(process.env.LABEL_CANDIDATE_SPACING_WEEKS ?? 20);

function candidateBucket(point: StagePoint): SamplingBucket | null {
  const { consolidationScore, priorTrend } = point.features;
  if (consolidationScore === null || consolidationScore < 58) return null;
  if (priorTrend === "down") return "decline_to_flat";
  if (priorTrend === "up") return "advance_to_flat";
  return "mixed_flat";
}

function candidatesForAsset(analysis: AssetAnalysis) {
  const byBucket: Record<SamplingBucket, Stage13Candidate[]> = {
    decline_to_flat: [],
    advance_to_flat: [],
    mixed_flat: [],
  };
  const lastIndex: Record<SamplingBucket, number> = { decline_to_flat: -Infinity, advance_to_flat: -Infinity, mixed_flat: -Infinity };

  for (let index = 103; index < analysis.stages.length; index += 1) {
    const point = analysis.stages[index];
    const bucket = candidateBucket(point);
    if (!bucket || index - lastIndex[bucket] < spacingWeeks) continue;
    byBucket[bucket].push({
      id: `${analysis.symbol}-${point.date}`,
      symbol: analysis.symbol,
      name: analysis.name,
      exchange: analysis.exchange,
      date: point.date,
      samplingBucket: bucket,
      bars: analysis.bars.slice(Math.max(0, index - 103), index + 1),
      features: {
        consolidationScore: point.features.consolidationScore,
        priorTrend: point.features.priorTrend,
        priorTrendQuality: point.features.priorTrendQuality,
        priorTrendSlope: point.features.priorTrendSlope,
        priorTrendReturn13: point.features.priorTrendReturn13,
        priorTrendReturn26: point.features.priorTrendReturn26,
        priorTrendReturn39: point.features.priorTrendReturn39,
        rangePosition52: point.features.rangePosition52,
      },
    });
    lastIndex[bucket] = index;
  }

  return [
    ...byBucket.decline_to_flat.slice(-perAssetPerBucket),
    ...byBucket.advance_to_flat.slice(-perAssetPerBucket),
    ...byBucket.mixed_flat.slice(-perAssetPerBucket),
  ];
}

const assets = JSON.parse(
  await readFile(join(inputDirectory, "assets.json"), "utf8"),
) as AssetSummary[];
const candidates: Stage13Candidate[] = [];
for (const asset of assets) {
  const analysis = JSON.parse(
    await readFile(join(inputDirectory, `${asset.symbol}.json`), "utf8"),
  ) as AssetAnalysis;
  candidates.push(...candidatesForAsset(analysis));
}
candidates.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

const output: CandidateFile = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  protocol: "仅依据候选周及此前77周数据，判断底部构筑(Stage 1)、高位震荡(Stage 3)、不确定或跳过。",
  candidates,
};
await mkdir(inputDirectory, { recursive: true });
await writeFile(outputPath, JSON.stringify(output));
console.log(`Generated ${candidates.length} Stage 1/3 annotation candidates at ${outputPath}`);

let priorIds = new Set<string>();
try {
  const archived = JSON.parse(
    await readFile(join(process.cwd(), "annotations", "stage13-labels.json"), "utf8"),
  ) as { labels: { candidateId: string }[] };
  priorIds = new Set(archived.labels.map((label) => label.candidateId));
} catch {
  console.warn("No archived first-round labels found; validation set cannot exclude them");
}

function roundRobin(items: Stage13Candidate[], limit: number) {
  const bySymbol = new Map<string, Stage13Candidate[]>();
  for (const item of items) bySymbol.set(item.symbol, [...(bySymbol.get(item.symbol) ?? []), item]);
  const symbols = [...bySymbol.keys()].sort();
  const selected: Stage13Candidate[] = [];
  while (selected.length < limit) {
    let added = false;
    for (const symbol of symbols) {
      const next = bySymbol.get(symbol)?.shift();
      if (next) { selected.push(next); added = true; }
      if (selected.length === limit) break;
    }
    if (!added) break;
  }
  return selected;
}

const independent = candidates.filter((candidate) => !priorIds.has(candidate.id));
const validationCandidates = [
  ...roundRobin(independent.filter((item) => item.samplingBucket === "decline_to_flat"), 15),
  ...roundRobin(independent.filter((item) => item.samplingBucket === "advance_to_flat"), 15),
].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
const validationOutput: CandidateFile = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  protocol: "样本外结构化标注：分别判断横盘状态、前置趋势和信心等级，不直接标注Stage。",
  candidates: validationCandidates,
};
await writeFile(validationOutputPath, JSON.stringify(validationOutput));
console.log(`Generated ${validationCandidates.length} independent validation candidates at ${validationOutputPath}`);

const usedIds = new Set(priorIds);
try {
  const archived = JSON.parse(
    await readFile(join(process.cwd(), "annotations", "stage13-structured-validation.json"), "utf8"),
  ) as { labels: { candidateId: string }[] };
  for (const label of archived.labels) usedIds.add(label.candidateId);
} catch {
  console.warn("No archived second-round labels found; V3 cannot exclude them");
}

const independentV3 = candidates.filter((candidate) => !usedIds.has(candidate.id));
const validationV3Candidates = [
  ...roundRobin(independentV3.filter((item) => item.samplingBucket === "decline_to_flat"), 8),
  ...roundRobin(independentV3.filter((item) => item.samplingBucket === "advance_to_flat"), 8),
  ...roundRobin(independentV3.filter((item) => item.samplingBucket === "mixed_flat"), 8),
].sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));
const validationV3Output: CandidateFile = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  protocol: "第三轮盲测：横盘状态、前置趋势和信心等级；三类模型候选各8条，且排除前两轮全部样本。",
  candidates: validationV3Candidates,
};
await writeFile(validationV3OutputPath, JSON.stringify(validationV3Output));
console.log(`Generated ${validationV3Candidates.length} V3 validation candidates at ${validationV3OutputPath}`);
