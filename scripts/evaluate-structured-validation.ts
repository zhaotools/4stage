import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AssetAnalysis, StageFeatures } from "../src/domain/types";

type Consolidation = "yes" | "no" | "uncertain";
type PriorTrend = "up" | "down" | "mixed";
type Confidence = "high" | "medium" | "low";
interface StructuredLabel {
  candidateId: string;
  consolidation: Consolidation;
  priorTrend: PriorTrend;
  confidence: Confidence;
  derivedLabel: "stage_1" | "stage_3" | "uncertain";
  labeledAt: string;
}
interface StructuredFile {
  schemaVersion: 2;
  exportedAt: string;
  sourceGeneratedAt: string;
  labels: StructuredLabel[];
}
const labelsPath = process.argv[2] ? resolve(process.argv[2]) : null;
if (!labelsPath) throw new Error("Usage: labels:evaluate-v2 -- /path/to/structured-validation.json");
const labels = JSON.parse(await readFile(labelsPath, "utf8")) as StructuredFile;
if (labels.schemaVersion !== 2 || !Array.isArray(labels.labels)) throw new Error("Invalid structured validation file");
const modelFeatures = new Map<string, StageFeatures>();
const analyses = new Map<string, AssetAnalysis>();
for (const label of labels.labels) {
  const separator = label.candidateId.indexOf("-");
  const symbol = label.candidateId.slice(0, separator);
  const date = label.candidateId.slice(separator + 1);
  if (!analyses.has(symbol)) {
    analyses.set(symbol, JSON.parse(
      await readFile(join(process.cwd(), "public", "data", `${symbol}.json`), "utf8"),
    ) as AssetAnalysis);
  }
  const point = analyses.get(symbol)!.stages.find((stage) => stage.date === date);
  if (!point) throw new Error(`Historical model point not found: ${label.candidateId}`);
  modelFeatures.set(label.candidateId, point.features);
}

const trendConfusion: Record<PriorTrend, Record<PriorTrend, number>> = {
  up: { up: 0, down: 0, mixed: 0 },
  down: { up: 0, down: 0, mixed: 0 },
  mixed: { up: 0, down: 0, mixed: 0 },
};
let trendExact = 0;
let humanClear = 0;
let clearCorrect = 0;
let highConfidenceClear = 0;
let highConfidenceCorrect = 0;
const disagreements: object[] = [];

for (const label of labels.labels) {
  const features = modelFeatures.get(label.candidateId)!;
  const modelTrend = features.priorTrend ?? "mixed";
  trendConfusion[label.priorTrend][modelTrend] += 1;
  if (modelTrend === label.priorTrend) trendExact += 1;
  if (label.priorTrend !== "mixed") {
    humanClear += 1;
    if (modelTrend === label.priorTrend) clearCorrect += 1;
    if (label.confidence === "high") {
      highConfidenceClear += 1;
      if (modelTrend === label.priorTrend) highConfidenceCorrect += 1;
    }
  }
  if (modelTrend !== label.priorTrend) {
    disagreements.push({
      candidateId: label.candidateId,
      humanConsolidation: label.consolidation,
      humanTrend: label.priorTrend,
      humanConfidence: label.confidence,
      modelTrend,
      features: {
        consolidationScore: features.consolidationScore,
        priorTrend: features.priorTrend,
        priorTrendQuality: features.priorTrendQuality,
        priorTrendSlope: features.priorTrendSlope,
        priorTrendReturn13: features.priorTrendReturn13,
        priorTrendReturn26: features.priorTrendReturn26,
        priorTrendReturn39: features.priorTrendReturn39,
        rangePosition52: features.rangePosition52,
      },
    });
  }
}

const distribution = <T extends string>(getter: (label: StructuredLabel) => T) =>
  Object.fromEntries([...new Set(labels.labels.map(getter))].map((value) => [value, labels.labels.filter((label) => getter(label) === value).length]));
const confirmedSideways = labels.labels.filter((label) => label.consolidation === "yes").length;
const report = {
  schemaVersion: 2,
  evaluatedAt: new Date().toISOString(),
  completeness: { labeled: labels.labels.length, expected: 30, missing: [] as string[] },
  distribution: {
    consolidation: distribution((label) => label.consolidation),
    priorTrend: distribution((label) => label.priorTrend),
    confidence: distribution((label) => label.confidence),
    derivedLabel: distribution((label) => label.derivedLabel),
  },
  consolidationCandidatePrecisionStrict: confirmedSideways / Math.max(1, labels.labels.length),
  humanClearTrendCoverage: humanClear / Math.max(1, labels.labels.length),
  priorTrendExactAgreement: trendExact / Math.max(1, labels.labels.length),
  priorTrendAccuracyWhenHumanClear: clearCorrect / Math.max(1, humanClear),
  priorTrendAccuracyHighConfidenceClear: highConfidenceCorrect / Math.max(1, highConfidenceClear),
  trendConfusion,
  disagreements,
};

const reportDirectory = join(process.cwd(), "reports");
const annotationDirectory = join(process.cwd(), "annotations");
await mkdir(reportDirectory, { recursive: true });
await mkdir(annotationDirectory, { recursive: true });
const reportPath = join(reportDirectory, "stage13-structured-validation.json");
const archivePath = join(annotationDirectory, "stage13-structured-validation.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));
await writeFile(archivePath, JSON.stringify(labels, null, 2));

console.log(`Completeness: ${labels.labels.length}/30; missing: ${labels.labels.length === 30 ? "none" : 30 - labels.labels.length}`);
console.log(`Confirmed sideways precision (strict): ${(report.consolidationCandidatePrecisionStrict * 100).toFixed(1)}%`);
console.log(`Human clear-trend coverage: ${(report.humanClearTrendCoverage * 100).toFixed(1)}%`);
console.log(`Prior-trend exact agreement: ${(report.priorTrendExactAgreement * 100).toFixed(1)}%`);
console.log(`Prior-trend accuracy when human is clear: ${(report.priorTrendAccuracyWhenHumanClear * 100).toFixed(1)}%`);
console.log(`High-confidence clear-trend accuracy: ${(report.priorTrendAccuracyHighConfidenceClear * 100).toFixed(1)}%`);
console.table(trendConfusion);
console.log(`Report: ${reportPath}`);
