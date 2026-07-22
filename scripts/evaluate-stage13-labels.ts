import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { AssetAnalysis, CoreStage, StageFeatures, StageScores } from "../src/domain/types";

type HumanLabel = "stage_1" | "stage_3" | "uncertain" | "skip";
interface LabelRow { candidateId: string; label: HumanLabel; labeledAt: string }
interface LabelFile { schemaVersion: number; exportedAt: string; sourceGeneratedAt: string; labels: LabelRow[] }
interface EvaluationRow {
  candidateId: string;
  symbol: string;
  date: string;
  human: "stage_1" | "stage_3";
  predicted: "stage_1" | "stage_3";
  correct: boolean;
  margin: number;
  scores: Pick<StageScores, 1 | 3>;
  features: Pick<StageFeatures, "normalizedSlope" | "previousSlope" | "consolidationScore" | "priorTrend" | "priorTrendSlope" | "priorTrendReturn26" | "rangePosition52" | "priceDistance">;
}

const labelsPath = process.argv[2] ? resolve(process.argv[2]) : null;
if (!labelsPath) throw new Error("Usage: labels:evaluate -- /path/to/stage13-labels.json");
const labelFile = JSON.parse(await readFile(labelsPath, "utf8")) as LabelFile;
if (labelFile.schemaVersion !== 1 || !Array.isArray(labelFile.labels)) {
  throw new Error("Unsupported or malformed label file");
}

const distribution: Record<HumanLabel, number> = { stage_1: 0, stage_3: 0, uncertain: 0, skip: 0 };
for (const label of labelFile.labels) distribution[label.label] += 1;
const usableLabels = labelFile.labels.filter(
  (row): row is LabelRow & { label: "stage_1" | "stage_3" } => row.label === "stage_1" || row.label === "stage_3",
);

const analyses = new Map<string, AssetAnalysis>();
const rows: EvaluationRow[] = [];
for (const label of usableLabels) {
  const separator = label.candidateId.indexOf("-");
  const symbol = label.candidateId.slice(0, separator);
  const date = label.candidateId.slice(separator + 1);
  if (!analyses.has(symbol)) {
    analyses.set(symbol, JSON.parse(
      await readFile(join(process.cwd(), "public", "data", `${symbol}.json`), "utf8"),
    ) as AssetAnalysis);
  }
  const point = analyses.get(symbol)!.stages.find((stage) => stage.date === date);
  if (!point?.scores) throw new Error(`No model score for ${label.candidateId}`);
  const predicted = point.scores[1] >= point.scores[3] ? "stage_1" : "stage_3";
  rows.push({
    candidateId: label.candidateId,
    symbol,
    date,
    human: label.label,
    predicted,
    correct: predicted === label.label,
    margin: Math.abs(point.scores[1] - point.scores[3]),
    scores: { 1: point.scores[1], 3: point.scores[3] },
    features: {
      normalizedSlope: point.features.normalizedSlope,
      previousSlope: point.features.previousSlope,
      consolidationScore: point.features.consolidationScore,
      priorTrend: point.features.priorTrend,
      priorTrendSlope: point.features.priorTrendSlope,
      priorTrendReturn26: point.features.priorTrendReturn26,
      rangePosition52: point.features.rangePosition52,
      priceDistance: point.features.priceDistance,
    },
  });
}

const confusion = {
  stage_1: { stage_1: 0, stage_3: 0 },
  stage_3: { stage_1: 0, stage_3: 0 },
};
for (const row of rows) confusion[row.human][row.predicted] += 1;
const correct = rows.filter((row) => row.correct).length;
const stage1Recall = confusion.stage_1.stage_1 / Math.max(1, distribution.stage_1);
const stage3Recall = confusion.stage_3.stage_3 / Math.max(1, distribution.stage_3);

function groupMeans(label: "stage_1" | "stage_3") {
  const group = rows.filter((row) => row.human === label);
  const mean = (getter: (row: EvaluationRow) => number | null) => {
    const values = group.map(getter).filter((value): value is number => value !== null);
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  };
  return {
    count: group.length,
    previousSlope: mean((row) => row.features.previousSlope),
    consolidationScore: mean((row) => row.features.consolidationScore),
    priorTrendSlope: mean((row) => row.features.priorTrendSlope),
    priorTrendReturn26: mean((row) => row.features.priorTrendReturn26),
    rangePosition52: mean((row) => row.features.rangePosition52),
    priceDistance: mean((row) => row.features.priceDistance),
    normalizedSlope: mean((row) => row.features.normalizedSlope),
  };
}

const report = {
  schemaVersion: 1,
  evaluatedAt: new Date().toISOString(),
  sourceFile: basename(labelsPath),
  completeness: { labeled: labelFile.labels.length, expected: 59 },
  distribution,
  usable: rows.length,
  accuracy: correct / Math.max(1, rows.length),
  balancedAccuracy: (stage1Recall + stage3Recall) / 2,
  recall: { stage_1: stage1Recall, stage_3: stage3Recall },
  confusion,
  groupMeans: { stage_1: groupMeans("stage_1"), stage_3: groupMeans("stage_3") },
  disagreements: rows.filter((row) => !row.correct).sort((a, b) => b.margin - a.margin),
};

const reportDirectory = join(process.cwd(), "reports");
await mkdir(reportDirectory, { recursive: true });
const reportPath = join(reportDirectory, "stage13-evaluation.json");
await writeFile(reportPath, JSON.stringify(report, null, 2));
const annotationDirectory = join(process.cwd(), "annotations");
await mkdir(annotationDirectory, { recursive: true });
const archivedLabelsPath = join(annotationDirectory, "stage13-labels.json");
await writeFile(archivedLabelsPath, JSON.stringify(labelFile, null, 2));

console.log(`Labels: ${labelFile.labels.length}/59; usable Stage 1/3: ${rows.length}`);
console.log(`Distribution: S1=${distribution.stage_1}, S3=${distribution.stage_3}, uncertain=${distribution.uncertain}, skip=${distribution.skip}`);
console.log(`Accuracy: ${(report.accuracy * 100).toFixed(1)}%; balanced: ${(report.balancedAccuracy * 100).toFixed(1)}%`);
console.log("Confusion matrix (human rows, model columns):");
console.table(confusion);
console.log("Human-label feature means:");
console.table(report.groupMeans);
console.log(`Disagreements: ${report.disagreements.length}; report: ${reportPath}`);
console.log(`Archived labels: ${archivedLabelsPath}`);
