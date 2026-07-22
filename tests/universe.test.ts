import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface ConfigAsset { symbol: string; name: string }

async function config(name: string) {
  return JSON.parse(await readFile(new URL(`../config/${name}.json`, import.meta.url), "utf8")) as ConfigAsset[];
}

describe("first expansion universe", () => {
  it("contains unique, well-formed ETF and index symbols", async () => {
    const assets = [...await config("etfs"), ...await config("indexes")];
    expect(assets.length).toBe(50);
    expect(new Set(assets.map((asset) => asset.symbol)).size).toBe(assets.length);
    expect(assets.every((asset) => /^\d{6}\.(SH|SZ)$/.test(asset.symbol))).toBe(true);
    expect(assets.every((asset) => asset.name.length > 0)).toBe(true);
  });
});
