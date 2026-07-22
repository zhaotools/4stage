import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { analyzeStages } from "../src/domain/stageEngine";
import type { AssetAnalysis, AssetSummary } from "../src/domain/types";
import { toPublishedAnalysis } from "./publish-analysis";

const dataDirectory = join(process.cwd(), "public", "data");
const assets = JSON.parse(await readFile(join(dataDirectory, "assets.json"), "utf8")) as AssetSummary[];

for (const asset of assets) {
  const path = join(dataDirectory, `${asset.symbol}.json`);
  const analysis = JSON.parse(await readFile(path, "utf8")) as AssetAnalysis;
  analysis.stages = analyzeStages(analysis.bars);
  analysis.generatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(toPublishedAnalysis(analysis)));
}

console.log(`Recomputed stage analysis for ${assets.length} assets from cached weekly bars`);
